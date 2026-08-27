/** 文档页：LakeEditor viewer/editor + 保存。图片/附件走本地资源服务（AssetServer，http://127.0.0.1:19876），
 * canonical URL 本机可达 → Lake 原生渲染，无 blob 注入/还原。 */
import { EditorDock } from "../editor/EditorDock";
import { OutlineSheet } from "../editor/OutlineSheet";
import { DocListSheet, type DocListItem } from "../editor/DocListSheet";
import { lakeBridge } from "../../features/editor/lakeRuntime";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pencil, Trash2, ListTree, Files } from "lucide-react";
import { LakeEditor } from "../../features/editor/LakeEditor";
import type { LakeEditorInstance, LakeEditorPrefs } from "../../features/editor/lakeRuntime";
import type { AttachmentPreviewItem } from "../../features/attachment/attachmentPreviewController";
import type { LocalAssetRef } from "../../core/assetUrl.js";
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import { registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import type { POCNote } from "../bridge";

/** 原生 OpenFile 插件（android/.../OpenFilePlugin.java）：系统默认应用打开本地文件。 */
const OpenFile = registerPlugin<{ open: (opts: { path: string }) => Promise<void> }>("OpenFile");

export interface DocumentPageProps {
  note: POCNote;
  content: string;
  title: string;
  editing: boolean;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onToggleEdit: () => void;
  onBack: () => void;
  onDelete: () => void;
  /** 当前笔记本文档列表（快捷切换目录用） */
  documents?: DocListItem[];
  /** 切换打开另一个文档 */
  onOpenDocument?: (id: string) => void;
}

export function DocumentPage(props: DocumentPageProps) {
  const { note, content, title, editing, onTitleChange, onContentChange, onToggleEdit, onBack, onDelete, documents, onOpenDocument } = props;
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [docListOpen, setDocListOpen] = useState(false);

  // 插入图片/附件：隐藏 file input 选文件 → Lake insertFiles 命令（走 createUploadPromise 上传 + 插入卡片）
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
      // item.src 是 canonical（http://127.0.0.1:19876/{noteId}/{file}，本地可达）
      let ref: LocalAssetRef | null = item.ref;
      if (!ref && typeof item.src === "string") ref = parseLocalAssetUrl(item.src);
      if (!ref) { setToast("附件未同步到本机"); return; }
      try {
        // 直接打开本地持久化的资产文件（note-assets/{noteId}/{filename}）
        const uri = await Filesystem.getUri({
          path: `note-assets/${ref.noteId}/${ref.filename}`,
          directory: Directory.Data,
        });
        await OpenFile.open({ path: uri.uri.replace(/^file:\/\//, "") });
      } catch {
        setToast("没有可打开此文件的应用");
      }
    },
  }), []);

  return (
    <div className="mobile-document">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <input className="mobile-title-input" value={title} onChange={(e) => onTitleChange(e.target.value)} readOnly={!editing} />
        <div className="mobile-topbar-actions">
          {!editing ? (
            <>
              <button className="mobile-icon-btn" onClick={() => setOutlineOpen(true)} aria-label="大纲"><ListTree size={20} /></button>
              <button className="mobile-icon-btn" onClick={() => setDocListOpen(true)} aria-label="目录"><Files size={20} /></button>
              <button className="mobile-icon-btn" onClick={onToggleEdit} aria-label="编辑"><Pencil size={20} /></button>
              <button className="mobile-icon-btn" onClick={onDelete} aria-label="删除"><Trash2 size={19} /></button>
            </>
          ) : (
            <>
              <button className="mobile-icon-btn" onClick={() => setDocListOpen(true)} aria-label="目录"><Files size={20} /></button>
              <button className="mobile-done-btn" onClick={onToggleEdit}>完成</button>
            </>
          )}
        </div>
      </header>
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
          }}
          prefs={{ fontSize: 18, showToolbar: !editing, disableVirtualRendering: true, attachment: attachmentPrefs }}
        />
      </section>
      {/* 编辑态底部 dock（app 化工具栏，悬浮输入法上方；替代 Lake 桌面样式原生工具栏） */}
      <EditorDock
        editor={editorRef.current}
        editing={editing}
        onInsertImage={() => insertFileViaInput("image/*")}
        onInsertAttachment={() => insertFileViaInput("")}
        onInsertTable={() => {
          try { lakeBridge(editorRef.current ?? undefined)?.renderer?.execCommand?.("table" as never); } catch { /* 忽略 */ }
        }}
      />
      <OutlineSheet open={outlineOpen} editor={editorRef.current} onClose={() => setOutlineOpen(false)} />
      <DocListSheet
        open={docListOpen}
        documents={documents ?? []}
        activeId={note.id}
        onPick={(id) => { setDocListOpen(false); onOpenDocument?.(id); }}
        onClose={() => setDocListOpen(false)}
      />
      {toast && <div className="mobile-toast">{toast}</div>}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          const ed = editorRef.current;
          if (!file || !ed) return;
          // 上传走 Lake createUploadPromise（bridge.uploadResource 落盘 note-assets + 返回 canonical URL）
          try { lakeBridge(ed)?.renderer?.execCommand?.("insertFiles" as never, [file]); } catch { /* 忽略 */ }
        }}
      />
    </div>
  );
}
