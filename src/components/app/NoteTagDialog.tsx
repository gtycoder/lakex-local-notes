import { X } from "lucide-react";
import { Dialog } from "../ui/Overlay";
import { NoteTagRow } from "./NoteTagRow";

/**
 * 目录右键「打标签…」弹层（261105 P1 三修）：内容**复用属性面板的标签编辑行**（NoteTagRow，
 * 内含 chips + 添加（QuickNoteTagPicker 语汇）/移除/新建）。
 *
 * 只由 Sidebar 的 note 行右键菜单打开（分组/笔记本没有标签）。保存后通过 onChanged 通知宿主
 * 刷新目录树/标签空间数据（与 NoteInfoDialog 的 onTagsChanged 同一条通路）。
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
  if (!open) return null;
  return (
    <Dialog open onDismiss={onClose} label={"给“" + (title || "无标题") + "”打标签"} className="note-tag-dialog">
      <div className="ln-dialog__body">
        <header className="ln-dialog__head">
          <span className="ln-dialog__title">打标签</span>
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭打标签" onClick={onClose}><X size={14} /></button>
        </header>
        <p className="note-tag-dialog__doc ln-ellipsis">{title || "无标题"}</p>
        <NoteTagRow noteId={noteId} onChanged={onChanged} />
      </div>
      <footer className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--secondary" onClick={onClose}>完成</button>
      </footer>
    </Dialog>
  );
}
