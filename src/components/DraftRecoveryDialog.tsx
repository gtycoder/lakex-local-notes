import { FileClock, RotateCcw, Trash2, X } from "lucide-react";
import type { DraftJournalEntry } from "../lib/types";

export function DraftRecoveryDialog({ entries, onRestore, onDiscard, onClose }: {
  entries: DraftJournalEntry[];
  onRestore: (entry: DraftJournalEntry) => void;
  onDiscard: (noteId: string) => void;
  onClose: () => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="draft-recovery-backdrop" role="presentation">
      <section className="draft-recovery-dialog" role="dialog" aria-modal="true" aria-labelledby="draft-recovery-title">
        <header><FileClock size={17} /><strong id="draft-recovery-title">发现未保存草稿</strong><button type="button" onClick={onClose} aria-label="稍后处理"><X size={15} /></button></header>
        <p>应用上次退出前发现了未保存的本地草稿。你可以恢复它们，或稍后在本机处理。</p>
        <div className="draft-recovery-list">
          {entries.slice(0, 5).map((entry) => (
            <div className="draft-recovery-row" key={entry.noteId}>
              <div><strong>{entry.title || "无标题"}</strong><span>{new Date(entry.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span></div>
              <div><button type="button" className="draft-recovery-restore" onClick={() => onRestore(entry)}><RotateCcw size={13} />恢复</button><button type="button" className="draft-recovery-discard" onClick={() => onDiscard(entry.noteId)} title="丢弃草稿"><Trash2 size={13} /></button></div>
            </div>
          ))}
        </div>
        {entries.length > 5 && <small>还有 {entries.length - 5} 个草稿待处理</small>}
      </section>
    </div>
  );
}
