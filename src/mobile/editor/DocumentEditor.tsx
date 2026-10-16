/**
 * 文档编辑器主体（可嵌入）：「编辑器 body + 底部 dock + 插入文件 + 大纲/文档列表面板」。
 * 宿主 = 第二层工作区 NotebookWorkspace（包 tab + 左右抽屉 + 底部胶囊栏）；
 * 原单文档页 DocumentPage 已删除——同一文档不允许有两种外壳（260908 UI 审计 A1）。
 * 大纲/文档列表的开关状态由宿主控制（传入 outlineOpen/docListOpen + onToggle*），宿主不传则内部自管。
 */
import { EditorDockHost } from "./EditorDockHost";
import { MobileFindBar } from "./MobileFindBar";
import { useCaretIntoView } from "../hooks/useCaretIntoView";
import { showToast } from "../ui/toastBus";
import "@dlient/lakex-doc-react/style.css";
import "../../styles/fonts/font-overrides.css"; // 字体接线：须晚于内核 style.css（移动端无 @layer，靠顺序生效）
import { OutlineSheet } from "./OutlineSheet";
import { DocListSheet, type DocListItem } from "./DocListSheet";
import { loadSettings } from "../../lib/settings";
import { useCallback, useMemo, useRef, useState } from "react";
import { LakeEditor } from "../../features/editor/LakeEditor";
import type { LakeEditorInstance, LakeEditorPrefs } from "../../features/editor/lakeRuntime";
import type { AttachmentPreviewItem } from "../../features/attachment/attachmentPreviewController";
import type { LocalAssetRef } from "../../core/assetUrl.js";
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import { isSafeShellOpenFilename } from "../../core/assetNaming.js";
import { registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import type { LocalNote } from "../data/noteRepository";

/** 原生 OpenFile 插件（android/.../OpenFilePlugin.java）：系统默认应用打开本地文件。 */
const OpenFile = registerPlugin<{ open: (opts: { path: string }) => Promise<void> }>("OpenFile");

/** 从 lakex 实例取纯文本（编辑器未就绪/getDocument 不可用时返回 undefined，保存侧回退 lakeHtmlToPlain）。 */
function plainFromEditor(editor: unknown): string | undefined {
  try {
    const fn = (editor as { getDocument?: (mime: string) => unknown } | null)?.getDocument;
    if (typeof fn !== "function") return undefined;
    const value = fn.call(editor, "text/plain");
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface DocumentEditorProps {
  note: LocalNote;
  content: string;
  editing: boolean;
  onContentChange: (content: string, plain?: string) => void;
  /** 打开/切换到另一个文档（工作区加 tab；单文档页接管） */
  onOpenDocument?: (id: string) => void;
  /** 当前笔记本文档列表（快捷切换目录用） */
  documents?: DocListItem[];
  /** 大纲面板（右）：受控开关；不传则内部自管 */
  outlineOpen?: boolean;
  onToggleOutline?: () => void;
  /** 文档列表面板（左）：受控开关；不传则内部自管 */
  docListOpen?: boolean;
  onToggleDocList?: () => void;
  /** 隐藏内置大纲/文档列表面板（工作区自行渲染左右抽屉） */
  hidePanels?: boolean;
  /** 编辑器实例回调（工作区用它给右大纲渲 TOC） */
  onEditorInstance?: (editor: LakeEditorInstance | null) => void;
  /** 文档内查找条（入口在工作区顶栏右上角） */
  findOpen?: boolean;
  onCloseFind?: () => void;
}

export function DocumentEditor(props: DocumentEditorProps) {
  const {
    note, content, editing, onContentChange, onOpenDocument, documents,
    outlineOpen: outlineOpenProp, onToggleOutline, docListOpen: docListOpenProp, onToggleDocList,
    hidePanels, onEditorInstance, findOpen = false, onCloseFind,
  } = props;
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const [outlineOpenS, setOutlineOpenS] = useState(false);
  const [docListOpenS, setDocListOpenS] = useState(false);
  const outlineOpen = outlineOpenProp ?? outlineOpenS;
  const docListOpen = docListOpenProp ?? docListOpenS;
  const toggleOutline = onToggleOutline ?? (() => setOutlineOpenS((v) => !v));
  const toggleDocList = onToggleDocList ?? (() => setDocListOpenS((v) => !v));

  // 插入通道（隐藏 file input + insertFiles / table）已抽到 EditorDockHost —— 与小记编辑器共用同一份。
  // 附件能力（移动端注入 LakeEditor）：canonical URL 本地可达（AssetServer），
  // 点击附件卡片直接系统应用打开本地文件（OpenFile 原生插件，跳过 WebView 预览弹窗）
  const attachmentPrefs = useMemo<NonNullable<LakeEditorPrefs["attachment"]>>(() => ({
    directOpen: true,
    onOpenAttachment: async (item: AttachmentPreviewItem) => {
      let ref: LocalAssetRef | null = item.ref;
      if (!ref && typeof item.src === "string") ref = parseLocalAssetUrl(item.src);
      if (!ref) { showToast("附件未同步到本机", { type: "error" }); return; }
      try {
        const uri = await Filesystem.getUri({ path: `note-assets/${ref.noteId}/${ref.filename}`, directory: Directory.Data });
        if (!isSafeShellOpenFilename(ref.filename)) {
          showToast("该附件类型不允许用系统应用打开");
          return;
        }
        await OpenFile.open({ path: uri.uri.replace(/^file:\/\//, "") });
      } catch {
        showToast("没有可打开此文件的应用", { type: "error" });
      }
    },
  }), []);

  const bodyRef = useRef<HTMLElement | null>(null);
  /**
   * 正文容器同时以 state 暴露给查找条：ref 变化不触发重渲染，查找条首帧会拿到 null。
   * 回调 ref 必须稳定（useCallback），否则每次渲染都会 setState 形成死循环。
   */
  const [findRoot, setFindRoot] = useState<HTMLElement | null>(null);
  const setBody = useCallback((el: HTMLElement | null) => {
    bodyRef.current = el;
    setFindRoot(el);
  }, []);
  /**
   * 编辑器实例必须是**状态**而不只是 ref：`EditorDockHost` 通过 prop 拿它，
   * 而 ref 变化不会触发重渲染 —— 编辑器就绪后父组件若不重渲染，dock 会一直拿到 null，
   * 于是工具栏 B/列表/待办 与面板里的命令全部静默失效（只有用户打字触发一次重渲染后才"活"过来）。
   * editorRef 仍保留给命令式路径（插入文件/表格/大纲）使用。
   */
  const [editorInstance, setEditorInstance] = useState<LakeEditorInstance | null>(null);
  // 点了可视区外的表格单元格 / 光标跑到屏外 → 自动把它滚进可视区（移动端表格必然横向溢出）
  useCaretIntoView(bodyRef, true);

  return (
    <>
      {/* 文档内查找条（移动端；入口 = 工作区顶栏右上角） */}
      {findOpen && <MobileFindBar root={findRoot} revision={content} onClose={() => onCloseFind?.()} />}
      {/* data-mb-edit-host / data-mb-kernel：编辑面契约（内核几何收口见 edit-surface-kernel.css） */}
      <section className="mobile-doc-body" ref={setBody} data-mb-edit-host data-mb-kernel="doc">
        <LakeEditor
          noteId={note.id}
          content={content}
          mode={editing ? "editor" : "viewer"}
          tocEnabled={false}
          onChange={(c) => onContentChange(c, plainFromEditor(editorRef.current))}
          onEditorReady={(_noteId, editor) => {
            (window as unknown as Record<string, unknown>).__mobileEditor = editor;
            editorRef.current = editor;
            setEditorInstance(editor);
            onEditorInstance?.(editor);
          }}
          prefs={{ fontSize: loadSettings().fontSize, showToolbar: !editing, disableVirtualRendering: true, attachment: attachmentPrefs }}
        />
      </section>
      {/* 编辑态底部 dock（app 化工具栏，悬浮输入法上方；替代 Lake 桌面样式原生工具栏）。
          插入接线（隐藏 file input + insertFiles / table）在 EditorDockHost 里 —— 与小记编辑器共用同一份。 */}
      <EditorDockHost editor={editorInstance} editing={editing} />
      {!hidePanels && (
        <>
          <OutlineSheet open={outlineOpen} editor={editorRef.current} onClose={toggleOutline} />
          <DocListSheet
            open={docListOpen}
            documents={documents ?? []}
            activeId={note.id}
            onPick={(id) => { toggleDocList(); onOpenDocument?.(id); }}
            onClose={toggleDocList}
          />
        </>
      )}
    </>
  );
}
