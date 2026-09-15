import { History, RotateCcw, Trash, X } from "lucide-react";
import type { DraftJournalEntry } from "../lib/types";

export function DraftRecoveryDialog({ entries, onRestore, onDiscard, onClose }: {
  entries: DraftJournalEntry[];
  onRestore: (entry: DraftJournalEntry) => void;
  onDiscard: (noteId: string) => void;
  onClose: () => void;
}) {
  if (entries.length === 0) return null;
  return (
    /* 浮层统一用 .ln-dialog + .modal-backdrop（AGENTS §3 #14：不再自造一套表面/圆角/阴影） */
    <div className="modal-backdrop" role="presentation">
      <section className="ln-dialog draft-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="draft-recovery-title">
        <header className="ln-dialog__head">
          <History size={16} />
          <h2 className="ln-dialog__title" id="draft-recovery-title">发现未保存草稿</h2>
          <button className="ln-close" type="button" onClick={onClose} aria-label="稍后处理"><X size={15} /></button>
        </header>
        <div className="ln-dialog__body">
          <p className="draft-recovery-hint">应用上次退出前发现了未保存的本地草稿。你可以恢复它们，或稍后在本机处理。</p>
          <div className="draft-recovery-list b3-list b3-list--background">
            {entries.slice(0, 5).map((entry) => (
              <div className="b3-list-item draft-recovery-row" key={entry.noteId}>
                <div className="b3-list-item__text ln-row2__main">
                  <span className="ln-row2__title">{entry.title || "无标题"}</span>
                  <span className="ln-row2__meta">{new Date(entry.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                </div>
                <button type="button" className="b3-list-item__action draft-recovery-restore" title="恢复这份草稿" aria-label="恢复这份草稿" onClick={() => onRestore(entry)}><RotateCcw size={14} /></button>
                <button type="button" className="b3-list-item__action b3-list-item__action--warning draft-recovery-discard" title="丢弃这份草稿" aria-label="丢弃这份草稿" onClick={() => onDiscard(entry.noteId)}><Trash size={14} /></button>
              </div>
            ))}
          </div>
          {entries.length > 5 && <p className="draft-recovery-more">还有 {entries.length - 5} 个草稿待处理</p>}
        </div>
      </section>
    </div>
  );
}
