/** 文档页：LakeEditor viewer/editor + blob 注入 + 保存。Phase 1 复用 MobilePocApp 的注入/还原逻辑。 */
import { EditorDock } from "../editor/EditorDock";
import { OutlineSheet } from "../editor/OutlineSheet";
import { DocListSheet, type DocListItem } from "../editor/DocListSheet";
import { lakeBridge } from "../../features/editor/lakeRuntime";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pencil, Trash2, ListTree, Files } from "lucide-react";
import { LakeEditor } from "../../features/editor/LakeEditor";
import { injectAssetBlobs } from "../blobInject";
import { createCardBlobInjector } from "../cardBlobInject";
import type { LakeEditorInstance, LakeEditorPrefs } from "../../features/editor/lakeRuntime";
import type { AttachmentPreviewItem } from "../../features/attachment/attachmentPreviewController";
import type { LocalAssetRef } from "../../core/assetUrl.js";
import { mimeTypeForFilename } from "../../core/assetNaming.js";
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import { registerPlugin } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { canonicalForBlob } from "../cardBlobInject.js";
import { bridge } from "../bridge";
import type { POCNote } from "../bridge";

/** 原生 OpenFile 插件（android/.../OpenFilePlugin.java）：系统默认应用打开本地文件。 */
const OpenFile = registerPlugin<{ open: (opts: { path: string }) => Promise<void> }>("OpenFile");

/** Uint8Array → base64（Capacitor Filesystem 写入用；分块避免参数栈溢出）。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

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
  /** 编辑态持久注入观察者（编辑器销毁时断开；见 onEditorReady） */
  const injectObserver = useRef<MutationObserver | null>(null);
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
  // viewer 内容 = 注入 blob 后的显示内容（setDocument 前改 src=blob → 挂载即用 blob）
  const { displayContent, revoke, restore } = useMemo(() => injectAssetBlobs(note.content), [note.id, note.content]);
  const cardInjector = useMemo(() => createCardBlobInjector(note.content), [note.content]);
  // blob 生命周期：组件卸载时 revoke（URL 引用释放；cachePort 注册表同步注销）
  useEffect(() => () => { revoke(); cardInjector?.revoke(); }, [revoke, cardInjector]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // 附件能力（移动端注入 LakeEditor）：本地字节 → blob URL 预览；打开 = 系统应用打开（OpenFile 原生插件）
  const attachmentPrefs = useMemo<NonNullable<LakeEditorPrefs["attachment"]>>(() => {
    const bytesFor = (ref: LocalAssetRef): Uint8Array | null => bridge.getAssetBytes(ref.noteId, ref.filename);
    return {
      // 移动端：点击附件卡片直接系统应用打开（跳过 WebView 预览弹窗）
      directOpen: true,
      resolveDisplayUrl: (ref) => {
        const bytes = bytesFor(ref);
        if (!bytes) return null;
        const type = mimeTypeForFilename(ref.filename);
        return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
      },
      onOpenAttachment: async (item: AttachmentPreviewItem) => {
        // item.src 可能是 canonical（未注入）或 blob URL（cardBlobInject 注入后）。
        // 优先解析出 ref（blob 经全局映射反查 canonical）→ 直接打开**本地持久化的资产文件**
        // （note-assets/{noteId}/{filename}，不复制 cache——复制会偶发 cache 清理/文件名/MIME 问题）。
        let ref: LocalAssetRef | null = item.ref;
        if (!ref && typeof item.src === "string" && item.src.startsWith("blob:")) {
          const canonical = canonicalForBlob(item.src);
          if (canonical) ref = parseLocalAssetUrl(canonical);
        }
        if (!ref) { setToast("附件未同步到本机"); return; }
        try {
          const uri = await Filesystem.getUri({
            path: `note-assets/${ref.noteId}/${ref.filename}`,
            directory: Directory.Data,
          });
          await OpenFile.open({ path: uri.uri.replace(/^file:\/\//, "") });
        } catch (e) {
          const msg = (e as { message?: string })?.message ?? "";
          console.log("[attach-open] failed:", msg);
          // 兜底：本地资产文件缺失（未持久化）→ 写 cache 副本再打开
          try {
            const bytes = bytesFor(ref);
            if (!bytes) { setToast("附件未同步到本机"); return; }
            const written = await Filesystem.writeFile({
              path: `open/${ref.filename}`,
              data: bytesToBase64(bytes),
              directory: Directory.Cache,
              recursive: true,
            });
            await OpenFile.open({ path: written.uri.replace(/^file:\/\//, "") });
          } catch {
            setToast("没有可打开此文件的应用");
          }
        }
      },
    };
  }, []);

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
          content={editing ? content : displayContent}
          mode={editing ? "editor" : "viewer"}
          tocEnabled={false}
          onChange={(c) => {
            // 保存前还原：blob → canonical
            const restored = cardInjector ? cardInjector.restore(restore(c)) : restore(c);
            onContentChange(restored);
          }}
          onEditorReady={(noteId, editor) => {
            (window as unknown as Record<string, unknown>).__mobileEditor = editor;
            editorRef.current = editor;
            // 编辑器销毁（viewer↔editor 切换/卸载）：断开持久注入观察者
            if (!editor) {
              if (injectObserver.current) { injectObserver.current.disconnect(); injectObserver.current = null; }
              return;
            }
            if (!cardInjector) return;
            cardInjector.reset();
            // 图片破裂优化：注入时机从"800ms 后"提前到"卡片 DOM 出现即注入"——
            // 立即尝试一次（DOM 可能已就绪）+ 短间隔兜底重试（卡片懒渲染未就绪）。
            // inject 幂等（cardBlobInject 内按元素当前 src 判定），重复触发无副作用。
            let attempts = 0;
            const tryInject = (): number => {
              attempts++;
              const n = cardInjector.inject(editor);
              if (n === 0 && attempts < 20) window.setTimeout(tryInject, 120);
              return n;
            };
            tryInject();
            // 编辑态持久观察：新卡片出现（childList）或 Lake 重写卡片 value（attributes，
            // 上传完成会把 src 从 blob/临时值写回 canonical）→ 重新注入。live-src 幂等保证
            // 注入后（src=blob）不再触发，不会死循环。viewer 不挂观察者（displayContent 已注入）。
            // 此前 Observer 首次注入成功就断开 + 3s 兜底，导致"上传完成后 Lake 重写 canonical"
            // 无人再注入 → 图片空白；现在观察者跟随编辑生命周期（onEditorReady(null) 断开）。
            if (editing) {
              if (injectObserver.current) { injectObserver.current.disconnect(); injectObserver.current = null; }
              const obs = new MutationObserver(() => {
                try { cardInjector.inject(editor); } catch { /* 注入失败不阻断 */ }
              });
              // 监听 value（Lake 重写卡片值）+ src（上传完成 img 变成 canonical）属性变化
              obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "src"] });
              injectObserver.current = obs;
            }
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
          try { lakeBridge(ed)?.renderer?.execCommand?.("insertFiles" as never, [file]); } catch { /* 忽略 */ }
          // 上传/插入后卡片异步出现 + Lake 上传完成重写 canonical → 编辑态持久 Observer
          // （onEditorReady 挂载，监听 childList + value 属性）会自动重新注入；这里只兜底一次，
          // 防 Observer 尚未就绪的边界（inject 按元素当前 src 幂等，重复调用无副作用）。
          window.setTimeout(() => { try { cardInjector.inject(ed); } catch { /* 忽略 */ } }, 800);
        }}
      />
    </div>
  );
}
