/**
 * 文档编辑器主体（可嵌入）：「编辑器 body + 底部 dock + 插入文件 + 大纲/文档列表面板」。
 * 宿主 = 第二层工作区 NotebookWorkspace（包 tab + 左右抽屉 + 底部胶囊栏）；
 * 原单文档页 DocumentPage 已删除——同一文档不允许有两种外壳（260908 UI 审计 A1）。
 * 大纲/文档列表的开关状态由宿主控制（传入 outlineOpen/docListOpen + onToggle*），宿主不传则内部自管。
 */
import { EditorDockHost } from "./EditorDockHost";
import { DOC_LIMITS } from "./snapshotUndoModel";
import { MobileFindBar } from "./MobileFindBar";
import { useCaretIntoView } from "../hooks/useCaretIntoView";
import { showToast } from "../ui/toastBus";
import "@dlient/lakex-doc-react/style.css";
import "../../styles/fonts/font-overrides.css"; // 字体接线：须晚于内核 style.css（移动端无 @layer，靠顺序生效）
import { OutlineSheet } from "./OutlineSheet";
import { DocListSheet, type DocListItem } from "./DocListSheet";
import { loadSettings } from "../../lib/settings";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clampScrollTop } from "./scrollPosition";
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
  /**
   * R1（261027）：阅读 ⇄ 编辑切换时 LakeEditor 会 destroy + `host.replaceChildren()`（effect deps 含 mode/showToolbar），
   * 滚动容器内容先被清空 ⇒ scrollHeight 归零 ⇒ Chrome 把 scrollTop 钳到 0（实测 790 → 0，进出都一样）。
   * 同一篇文档的模式切换 = 同一个阅读位置 ⇒ 切换前记下、切换后按新内容 clamp 回写一次。
   * 位置取「本次手势按下时」的值（pointerdown 早于收键盘把光标滚进视口）——直接读切换瞬间的值会被那次滚动带偏。
   * 只在 editing 变化时触发：切到另一篇 / 新建 / 重新打开被淘汰的标签都不经过这里（新文档仍从顶）。
   */
  const scrollAtPointerRef = useRef<number | null>(null);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const prevEditingRef = useRef(editing);
  useEffect(() => {
    const onPointerDown = () => {
      const el = bodyRef.current;
      const pane = el?.closest(".doc-pane");
      if (!el || !pane?.classList.contains("active")) return;
      scrollAtPointerRef.current = el.scrollTop;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);
  useLayoutEffect(() => {
    if (prevEditingRef.current === editing) return;
    prevEditingRef.current = editing;
    const el = bodyRef.current;
    if (!el) return;
    pendingScrollRestoreRef.current = scrollAtPointerRef.current ?? el.scrollTop;
  }, [editing]);
  useEffect(() => {
    const saved = pendingScrollRestoreRef.current;
    if (saved === null) return;
    pendingScrollRestoreRef.current = null;
    const el = bodyRef.current;
    if (!el) return;
    const apply = () => {
      el.scrollTop = clampScrollTop(saved, el.scrollHeight, el.clientHeight);
    };
    apply();
    // 内核 setDocument 后可能再锚定/聚焦一次 ⇒ 下一帧按同一判据再纠一次（只纠一次，用户随后的滚动不再干预）
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [editing]);
  // 点了可视区外的表格单元格 / 光标跑到屏外 → 自动把它滚进可视区（移动端表格必然横向溢出）。
  // 只在**编辑态**开启：阅读态没有光标，残留的 DOM 选区/容器级选区一旦被当成光标，
  // 会在切文档、开目录抽屉、退出编辑后被滚到文档末尾（261027；判据见 caretIntoViewTarget）。
  useCaretIntoView(bodyRef, editing);

  return (
    <>
      {/* 文档内查找条（移动端；入口 = 工作区顶栏右上角） */}
      {findOpen && <MobileFindBar root={findRoot} revision={content} editor={editorInstance} onClose={() => onCloseFind?.()} />}
      {/* data-mb-edit-host / data-mb-kernel：编辑面契约（内核几何收口见 edit-surface-kernel.css） */}
      <section className="mobile-doc-body" ref={setBody} data-mb-edit-host data-mb-kernel="doc">
        <LakeEditor
          noteId={note.id}
          content={content}
          mode={editing ? "editor" : "viewer"}
          tocEnabled={false}
          // 内核虚拟渲染/大纲定位要真实滚动容器；bodyRef 首帧才有值 ⇒ 传 getter（resolveScrollNode 每次测量时调用）。
          scrollNode={() => bodyRef.current}
          onChange={(c) => onContentChange(c, plainFromEditor(editorRef.current))}
          onEditorReady={(_noteId, editor) => {
            (window as unknown as Record<string, unknown>).__mobileEditor = editor;
            editorRef.current = editor;
            setEditorInstance(editor);
            onEditorInstance?.(editor);
          }}
          // MOB-04（261029 切换）：查找已接内核（不依赖全量 DOM）⇒ 编辑态开内核虚拟渲染；
          // 只保留视口附近节点（实测 500 块文档编辑节点 5552→2202、进编辑 5117→2102ms）。
          prefs={{ fontSize: loadSettings().fontSize, showToolbar: !editing, disableVirtualRendering: false, attachment: attachmentPrefs }}
        />
      </section>
      {/* 编辑态底部 dock（app 化工具栏，悬浮输入法上方；替代 Lake 桌面样式原生工具栏）。
          插入接线（隐藏 file input + insertFiles / table）在 EditorDockHost 里 —— 与小记编辑器共用同一份。 */}
      {/* 文档也用前端快照栈：kernel history 会把连续输入合并成一帧（"一次撤一段、再撤没有"），
          用户 261017 要求文档也能逐步撤销；DOC_LIMITS 更保守（25 条 / 4M 字符）。 */}
      <EditorDockHost editor={editorInstance} editing={editing} undoBackend="snapshot" undoLimits={DOC_LIMITS} />
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
