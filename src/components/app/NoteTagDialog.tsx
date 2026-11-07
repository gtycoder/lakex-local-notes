import { useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "../ui/Overlay";
import { NoteTagRow } from "./NoteTagRow";

/**
 * 目录右键「打标签…」弹窗（261105 用户验收：与「重命名 / 新建」弹窗同一视觉口径）。
 *
 * 结构：Dialog > `.ln-dialog__head`（标题 + 关闭，head 与 body 同级）→ `.ln-dialog__body`
 * （文档标题弱化说明行 + 标签 chips 区）→ `.ln-dialog__actions`（右对齐主按钮「完成」）。
 * 宽度与其它弹窗一致（styles/dialog.css 里与 .rename-dialog 并列复用 460 规则，不复制）。
 * 标签编辑逻辑本身不变：内容仍是 NoteTagRow（属性面板同一行）。
 */
export interface NoteTagDialogProps {
  open: boolean;
  /** 文档 id（= note id，tag_links.target_id）。 */
  noteId: string;
  /** 文档标题（弹层里展示，便于确认在给哪一篇打标签）。 */
  title: string;
  onClose(): void;
  /** 标签关系变化后通知宿主（刷新标签空间/侧栏筛选数据）。 */
  onChanged?: () => void;
}

export function NoteTagDialog({ open, noteId, title, onClose, onChanged }: NoteTagDialogProps) {
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  return (
    <Dialog open onDismiss={onClose} label={"给“" + (title || "无标题") + "”设置标签"} className="note-tag-dialog">
      <div className="ln-dialog__head note-tag-dialog__head">
        <span className="ln-dialog__title">标签</span>
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭标签" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="ln-dialog__body">
        <p className="note-tag-dialog__doc ln-ellipsis" title={title || "无标题"}>{title || "无标题"}</p>
        <section className="note-tag-dialog__chips" aria-label="当前标签">
          <NoteTagRow
            noteId={noteId}
            onChanged={onChanged}
            onError={(message) => setError(message)}
            emptyHint="还没有标签，点「添加标签」创建一个。"
          />
        </section>
        {error && <p className="note-tag-dialog__error" role="alert">{error}</p>}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--primary" onClick={onClose}>完成</button>
      </div>
    </Dialog>
  );
}
