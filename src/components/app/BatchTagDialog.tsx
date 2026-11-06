
/**
 * 批量「打标签…」弹层（261106 task-81）：批量**追加**或**移除**二选一（单选标签）。
 *
 * 为什么不用单条 NoteTagDialog：它是「一条文档的标签 chips + 新建标签」的编辑器；批量场景需要
 * 「选一个标签 + 选追加/移除」。这里复用同一份**标签目录数据**（调用方 listQuickNoteTags 注入）
 * 与 kit 原语（Dialog / .ln-row / .ln-btn），不另造标签数据源。
 */
import { useEffect, useState } from "react";
import { Dialog } from "../ui/Overlay";
import { Tag as TagIcon } from "lucide-react";
import type { QuickNoteTag } from "../../lib/types";

export type BatchTagMode = "tag-add" | "tag-remove";

export interface BatchTagDialogProps {
  open: boolean;
  /** 选中的文档条数（标题里给个量级）。 */
  count: number;
  tags: readonly QuickNoteTag[];
  loading?: boolean;
  error?: string | null;
  busy?: boolean;
  onConfirm(mode: BatchTagMode, tagId: string): void;
  onClose(): void;
}

export function BatchTagDialog({ open, count, tags, loading = false, error = null, busy = false, onConfirm, onClose }: BatchTagDialogProps) {
  const [mode, setMode] = useState<BatchTagMode>("tag-add");
  const [tagId, setTagId] = useState<string | null>(null);
  // 每次打开重置（避免上次选的标签/模式残留）
  useEffect(() => {
    if (open) {
      setMode("tag-add");
      setTagId(null);
    }
  }, [open]);
  if (!open) return null;
  const canConfirm = !!tagId && !busy;
  return (
    <Dialog open onDismiss={() => { if (!busy) onClose(); }} label={"批量" + (mode === "tag-add" ? "打标签" : "移除标签")} className="batch-tag-dialog">
      <div className="ln-dialog__head"><span className="ln-dialog__title">给 {count} 项{mode === "tag-add" ? "追加标签" : "移除标签"}</span></div>
      <div className="ln-dialog__body">
        <div className="batch-tag-dialog__modes" role="group" aria-label="操作方式">
          <button type="button" className={"ln-btn ln-btn--secondary" + (mode === "tag-add" ? " is-selected" : "")}
            aria-pressed={mode === "tag-add"} onClick={() => setMode("tag-add")} disabled={busy}>追加标签</button>
          <button type="button" className={"ln-btn ln-btn--secondary" + (mode === "tag-remove" ? " is-selected" : "")}
            aria-pressed={mode === "tag-remove"} onClick={() => setMode("tag-remove")} disabled={busy}>移除标签</button>
        </div>
        {loading && <p className="ln-empty">正在读取标签目录…</p>}
        {!loading && tags.length === 0 && <p className="ln-empty">还没有标签。先在小记或标签空间里建一个。</p>}
        {!loading && tags.length > 0 && (
          <div className="batch-tag-dialog__list" role="listbox" aria-label="选择标签">
            {tags.map((tag) => (
              <button key={tag.id} type="button" role="option" aria-selected={tagId === tag.id}
                className={"ln-row batch-tag-dialog__item" + (tagId === tag.id ? " is-selected" : "")}
                disabled={busy} onClick={() => setTagId(tag.id)}>
                <TagIcon size={14} aria-hidden="true" />
                <span className="ln-ellipsis">{tag.name}</span>
              </button>
            ))}
          </div>
        )}
        {error && <p className="batch-tag-dialog__error" role="alert">{error}</p>}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={!canConfirm}
          onClick={() => { if (tagId) onConfirm(mode, tagId); }}>{busy ? "处理中…" : mode === "tag-add" ? "追加" : "移除"}</button>
      </div>
    </Dialog>
  );
}
