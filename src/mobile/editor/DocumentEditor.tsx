/**
 * 文档编辑器主体（可嵌入）：从 DocumentPage 拆出的「编辑器 body + 底部 dock + 插入文件 + 大纲/文档列表面板」。
 * 供两类宿主复用：单文档页 DocumentPage（自带顶栏），以及第二层工作区 NotebookWorkspace（包 tab + 左右抽屉）。
 * 大纲/文档列表的开关状态由宿主控制（传入 outlineOpen/docListOpen + onToggle*），宿主不传则内部自管。
 */
import { EditorDock } from "./EditorDock";
import "lakex-editor-react-component/style.css";
import { OutlineSheet } from "./OutlineSheet";
import { DocListSheet, type DocListItem } from "./DocListSheet";
import { lakeBridge } from "../../features/editor/lakeRuntime";
import { useEffect, useMemo, useRef, useState } from "react";
import { LakeEditor } from "../../features/editor/LakeEditor";
import type { LakeEditorInstance, LakeEditorPrefs } from "../../features/editor/lakeRuntime";
import type { AttachmentPreviewItem } from "../../features/attachment/attachmentPreviewController";
import type { LocalAssetRef } from "../../core/assetUrl.js";
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import { mediaKindOfFilename } from "../../core/assetNaming.js";
import { registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import type { POCNote } from "../bridge";

/** 原生 OpenFile 插件（android/.../OpenFilePlugin.java）：系统默认应用打开本地文件。 */
const OpenFile = registerPlugin<{ open: (opts: { path: string }) => Promise<void> }>("OpenFile");

export interface DocumentEditorProps {
  note: POCNote;
  content: string;
  title: string;
  editing: boolean;
  onContentChange: (content: string) => void;
  onToggleEdit: () => void;
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
}

export function DocumentEditor(props: DocumentEditorProps) {
  const {
    note, content, title, editing, onContentChange, onToggleEdit, onOpenDocument, documents,
    outlineOpen: outlineOpenProp, onToggleOutline, docListOpen: docListOpenProp, onToggleDocList,
    hidePanels, onEditorInstance,
  } = props;
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [outlineOpenS, setOutlineOpenS] = useState(false);
  const [docListOpenS, setDocListOpenS] = useState(false);
  const outlineOpen = outlineOpenProp ?? outlineOpenS;
  const docListOpen = docListOpenProp ?? docListOpenS;
  const toggleOutline = onToggleOutline ?? (() => setOutlineOpenS((v) => !v));
  const toggleDocList = onToggleDocList ?? (() => setDocListOpenS((v) => !v));

  const insertFileViaInput = (accept: string) => {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.value = "";
    input.click();
  };
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // 附件能力（移动端注入 LakeEditor）：canonical URL 本地可达（AssetServer），
  // 点击附件卡片直接系统应用打开本地文件（OpenFile 原生插件，跳过 WebView 预览弹窗）
  const attachmentPrefs = useMemo<NonNullable<LakeEditorPrefs["attachment"]>>(() => ({
    directOpen: true,
    onOpenAttachment: async (item: AttachmentPreviewItem) => {
      let ref: LocalAssetRef | null = item.ref;
      if (!ref && typeof item.src === "string") ref = parseLocalAssetUrl(item.src);
      if (!ref) { setToast("附件未同步到本机"); return; }
      try {
        const uri = await Filesystem.getUri({ path: `note-assets/${ref.noteId}/${ref.filename}`, directory: Directory.Data });
        await OpenFile.open({ path: uri.uri.replace(/^file:\/\//, "") });
      } catch {
        setToast("没有可打开此文件的应用");
      }
    },
  }), []);

  return (
    <>
      <section className="mobile-doc-body">
        <LakeEditor
          noteId={note.id}
          content={content}
          mode={editing ? "editor" : "viewer"}
          tocEnabled={false}
          onChange={(c) => onContentChange(c)}
          onEditorReady={(noteId, editor) => {
            (window as unknown as Record<string, unknown>).__mobileEditor = editor;
            editorRef.current = editor;
            onEditorInstance?.(editor);
          }}
          prefs={{ fontSize: 18, showToolbar: !editing, disableVirtualRendering: true, attachment: attachmentPrefs }}
        />
      </section>
      {/* 编辑态底部 dock（app 化工具栏，悬浮输入法上方；替代 Lake 桌面样式原生工具栏） */}
      <EditorDock
        editor={editorRef.current}
        editing={editing}
        onToggleEdit={onToggleEdit}
        onInsertImage={() => insertFileViaInput("image/*")}
        onInsertAttachment={() => insertFileViaInput("")}
        onInsertAudio={() => insertFileViaInput("audio/*")}
        onInsertVideo={() => insertFileViaInput("video/*")}
        onInsertTable={() => {
          try { lakeBridge(editorRef.current ?? undefined)?.renderer?.execCommand?.("table" as never); } catch { /* 忽略 */ }
        }}
      />
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
      {toast && <div className="mobile-toast">{toast}</div>}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const ed = editorRef.current;
          if (!file || !ed) return;
          const kind = mediaKindOfFilename(file.name);
          const opts = kind ? { category: kind, from: "ui" } : undefined;
          try { lakeBridge(ed)?.renderer?.execCommand?.("insertFiles" as never, [file], opts as never); } catch { /* 忽略 */ }
        }}
      />
    </>
  );
}
