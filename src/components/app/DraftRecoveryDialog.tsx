import { History, RotateCcw, Trash, X } from "lucide-react";
import type { DraftJournalEntry } from "../../lib/types";
import { Dialog } from "../ui/Overlay";

export function DraftRecoveryDialog({ entries, onRestore, onDiscard, onClose }: {
  entries: DraftJournalEntry[];
  onRestore: (entry: DraftJournalEntry) => void;
  onDiscard: (noteId: string) => void;
  onClose: () => void;
}) {
  if (entries.length === 0) return null;
  // 浮层统一走标准 <Dialog>（.ln-scrim + .ln-dialog 表面 + 外点/Esc/焦点），不再手写遮罩。
  return (
    <Dialog onDismiss={onClose} label="发现未保存草稿" className="draft-recovery-dialog">
      <header className="ln-dialog__head">
        <History size={16} />
        <h2 className="ln-dialog__title">发现未保存草稿</h2>
        <button className="ln-close" type="button" onClick={onClose} aria-label="稍后处理"><X size={15} /></button>
      </header>
      <div className="ln-dialog__body">
        <p className="draft-recovery-hint">应用上次退出前发现了未保存的本地草稿。你可以恢复它们，或稍后在本机处理。</p>
        <div className="draft-recovery-list ln-list-panel ln-list-panel--background">
          {entries.slice(0, 5).map((entry) => (
            <div className="ln-list-item draft-recovery-row" key={entry.noteId}>
              <div className="ln-list-item__text ln-row2__main ln-ellipsis">
                <span className="ln-row2__title">{entry.title || "无标题"}</span>
                <span className="ln-row2__meta">{new Date(entry.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span>
              </div>
              <button type="button" className="ln-list-item__action draft-recovery-restore" title="恢复这份草稿" aria-label="恢复这份草稿" onClick={() => onRestore(entry)}><RotateCcw size={14} /></button>
              <button type="button" className="ln-list-item__action ln-list-item__action--warning draft-recovery-discard" title="丢弃这份草稿" aria-label="丢弃这份草稿" onClick={() => onDiscard(entry.noteId)}><Trash size={14} /></button>
            </div>
          ))}
        </div>
        {entries.length > 5 && <p className="draft-recovery-more">还有 {entries.length - 5} 个草稿待处理</p>}
      </div>
    </Dialog>
  );
}
