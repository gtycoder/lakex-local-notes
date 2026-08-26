/** 文档页：LakeEditor viewer/editor + blob 注入 + 保存。Phase 1 复用 MobilePocApp 的注入/还原逻辑。 */
import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { LakeEditor } from "../../features/editor/LakeEditor";
import { injectAssetBlobs } from "../blobInject";
import { createCardBlobInjector } from "../cardBlobInject";
import { registerRuntimeBlob } from "../cachePort.js";
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import { bridge } from "../bridge";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import type { POCNote } from "../bridge";

/**
 * 图片首帧显示（generateDisplayUrl）：Lake 图片组件渲染时经此回调把 canonical 资源 URL
 * 解析为 blob URL——卡片创建即拿到 src，无需等 setCardValue 注入，消除"先破图后恢复"。
 * module 级缓存（canonical → blob）+ cachePort 注册（清缓存时统一 revoke）。
 */
const displayUrlCache = new Map<string, string>();
function mobileDisplayUrl(url: string): string {
  const cached = displayUrlCache.get(url);
  if (cached) return cached;
  const ref = parseLocalAssetUrl(url);
  if (!ref) return url;
  const bytes = bridge.getAssetBytes(ref.noteId, ref.filename);
  if (!bytes) return url;
  const blobUrl = URL.createObjectURL(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]));
  displayUrlCache.set(url, blobUrl);
  registerRuntimeBlob(blobUrl);
  return blobUrl;
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
}

export function DocumentPage(props: DocumentPageProps) {
  const { note, content, title, editing, onTitleChange, onContentChange, onToggleEdit, onBack, onDelete } = props;
  const editorRef = useRef<LakeEditorInstance | null>(null);
  // viewer 内容 = 注入 blob 后的显示内容（setDocument 前改 src=blob → 挂载即用 blob）
  const { displayContent, revoke, restore } = useMemo(() => injectAssetBlobs(note.content), [note.id, note.content]);
  const cardInjector = useMemo(() => createCardBlobInjector(note.content), [note.content]);
  // blob 生命周期：组件卸载时 revoke（URL 引用释放；cachePort 注册表同步注销）
  useEffect(() => () => { revoke(); cardInjector?.revoke(); }, [revoke, cardInjector]);

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
          prefs={{ fontSize: 18, showToolbar: true, disableVirtualRendering: true, generateDisplayUrl: mobileDisplayUrl }}
        />
      </section>
    </div>
  );
}
