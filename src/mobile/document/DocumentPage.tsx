/** 文档页：LakeEditor viewer/editor + blob 注入 + 保存。Phase 1 复用 MobilePocApp 的注入/还原逻辑。 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { LakeEditor } from "../../features/editor/LakeEditor";
import { injectAssetBlobs } from "../blobInject";
import { createCardBlobInjector } from "../cardBlobInject";
import type { LakeEditorInstance, LakeEditorPrefs } from "../../features/editor/lakeRuntime";
import type { AttachmentPreviewItem } from "../../features/attachment/attachmentPreviewController";
import type { LocalAssetRef } from "../../core/assetUrl.js";
import { mimeTypeForFilename } from "../../core/assetNaming.js";
import { bridge } from "../bridge";
import type { POCNote } from "../bridge";

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
}

export function DocumentPage(props: DocumentPageProps) {
  const { note, content, title, editing, onTitleChange, onContentChange, onToggleEdit, onBack, onDelete } = props;
  const editorRef = useRef<LakeEditorInstance | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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

  // 附件能力（移动端注入 LakeEditor）：本地字节 → blob URL 预览；打开 = 系统分享面板
  const attachmentPrefs = useMemo<NonNullable<LakeEditorPrefs["attachment"]>>(() => {
    const bytesFor = (ref: LocalAssetRef): Uint8Array | null => bridge.getAssetBytes(ref.noteId, ref.filename);
    return {
      resolveDisplayUrl: (ref) => {
        const bytes = bytesFor(ref);
        if (!bytes) return null;
        const type = mimeTypeForFilename(ref.filename);
        return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
      },
      onOpenAttachment: async (item: AttachmentPreviewItem) => {
        const ref = item.ref;
        if (!ref) { setToast("附件未同步到本机"); return; }
        const bytes = bytesFor(ref);
        if (!bytes) { setToast("附件未同步到本机，请先同步"); return; }
        const file = new File([bytes as unknown as BlobPart], item.name, { type: mimeTypeForFilename(ref.filename) });
        try {
          if (typeof navigator.share === "function") {
            await navigator.share({ files: [file], title: item.name });
          } else {
            setToast("当前环境不支持文件分享");
          }
        } catch (e) {
          // 用户取消分享不算错误
          if ((e as { name?: string })?.name !== "AbortError") setToast("分享失败");
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
              <button className="mobile-icon-btn" onClick={onToggleEdit} aria-label="编辑"><Pencil size={20} /></button>
              <button className="mobile-icon-btn" onClick={onDelete} aria-label="删除"><Trash2 size={19} /></button>
            </>
          ) : (
            <button className="mobile-done-btn" onClick={onToggleEdit}>完成</button>
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
            editorRef.current = editor;
            if (editor && cardInjector) {
              // 每次编辑器重建（viewer↔editor 切换/重开）重置幂等集：injectedIds 只限同一实例内去重，
              // 否则重建后的新卡片 DOM 会被上一次注入的 canonicalSrc 挡住，永不注入（图片破裂修复的回归）。
              cardInjector.reset();
              // 图片破裂优化：注入时机从"800ms 后"提前到"卡片 DOM 出现即注入"——
              // 立即尝试一次（DOM 可能已就绪）+ MutationObserver 监听 NE-CARD 出现 + 短间隔兜底重试。
              // inject 幂等（cardBlobInject 内按 canonicalSrc 去重），Observer/重试重复触发无副作用。
              let attempts = 0;
              const tryInject = (): number => {
                attempts++;
                const n = cardInjector.inject(editor);
                if (n === 0 && attempts < 20) window.setTimeout(tryInject, 120);
                return n;
              };
              let observer: MutationObserver | null = null;
              if (typeof MutationObserver !== "undefined") {
                observer = new MutationObserver(() => {
                  const n = cardInjector.inject(editor);
                  if (n > 0 && observer) { observer.disconnect(); observer = null; }
                });
                observer.observe(document.body, { childList: true, subtree: true });
              }
              tryInject();
              // 兜底：3s 后停掉 Observer 与重试（防止残留监听）
              window.setTimeout(() => {
                if (observer) { observer.disconnect(); observer = null; }
                cardInjector.inject(editor);
              }, 3000);
            }
          }}
          prefs={{ fontSize: 18, showToolbar: true, disableVirtualRendering: true, attachment: attachmentPrefs }}
        />
      </section>
      {toast && <div className="mobile-toast">{toast}</div>}
    </div>
  );
}
