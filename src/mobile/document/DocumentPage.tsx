/** 文档页：LakeEditor viewer/editor + blob 注入 + 保存。Phase 1 复用 MobilePocApp 的注入/还原逻辑。 */
import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { LakeEditor } from "../../features/editor/LakeEditor";
import { injectAssetBlobs } from "../blobInject";
import { createCardBlobInjector } from "../cardBlobInject";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
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
              let attempts = 0;
              const tryInject = () => {
                const n = cardInjector.inject(editor);
                if (n === 0 && attempts < 4) {
                  attempts++;
                  window.setTimeout(tryInject, 400);
                }
              };
              window.setTimeout(tryInject, 800);
            }
          }}
          prefs={{ fontSize: 18, showToolbar: true }}
        />
      </section>
    </div>
  );
}
