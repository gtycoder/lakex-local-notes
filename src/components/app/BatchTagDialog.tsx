/**
 * 桌面多选「添加标签…」弹层（261108 重做）：**只追加**，可现场新建标签。
 *
 * 明确不做：移除/改名/编辑已有标签图标/批量移除。标签目录仍只来自 quick-notes tags（单一来源）。
 * 纯选择逻辑在 features/tags/batchTagging.ts；这里只负责 UI 与异步新建。
 */
import { useMemo, useState } from "react";
import { Plus, Tag as TagIcon } from "lucide-react";
import { Dialog } from "../ui/Overlay";
import type { QuickNoteTag } from "../../lib/types";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { isValidBatchTagName, normalizeBatchTagName, toggleBatchTagSelection } from "../../core/batchTagging";

export interface BatchTagDialogProps {
  open: boolean;
  count: number;
  tags: QuickNoteTag[];
  loading?: boolean;
  error?: string | null;
  busy?: boolean;
  /** 新建标签；成功返回创建的标签（父级同时刷新目录）。 */
  onCreateTag(name: string): Promise<QuickNoteTag>;
  onConfirm(tagIds: string[]): void;
  onClose(): void;
}

export function BatchTagDialog({ open, count, tags, loading = false, error = null, busy = false, onCreateTag, onConfirm, onClose }: BatchTagDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [created, setCreated] = useState<QuickNoteTag[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const catalog = useMemo(() => {
    const seen = new Set<string>();
    return [...tags, ...created].filter((tag) => (seen.has(tag.id) ? false : (seen.add(tag.id), true)));
  }, [tags, created]);
  if (!open) return null;

  const create = async () => {
    if (creating || busy) return;
    let value: string;
    try { value = normalizeBatchTagName(name); } catch { return; }
    setCreating(true);
    setCreateError(null);
    try {
      const tag = await onCreateTag(value);
      setCreated((current) => current.some((item) => item.id === tag.id) ? current : [...current, tag]);
      setSelected((current) => current.includes(tag.id) ? current : [...current, tag.id]);
      setName("");
    } catch (cause) {
      setCreateError(getNativeErrorMessage(cause) || "新建标签失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open onDismiss={() => { if (!busy) onClose(); }} label={"给 " + count + " 项添加标签"} className="batch-tag-dialog">
      <div className="ln-dialog__head">
        <span className="ln-dialog__title">给 {count} 项添加标签</span>
      </div>
      <div className="ln-dialog__body">
        <p className="batch-tag-dialog__hint">只追加标签，不会移除已有标签，也不会修改已有标签。</p>
        <div className="batch-tag-dialog__create">
          <span className="ln-input">
            <TagIcon size={14} className="ln-input__icon" aria-hidden="true" />
            <input className="ln-input__field" value={name} placeholder="新建标签" maxLength={40} disabled={busy || creating}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void create(); } }} />
          </span>
          <button type="button" className="ln-btn ln-btn--secondary" disabled={!isValidBatchTagName(name) || busy || creating} onClick={() => void create()}>
            <Plus size={14} aria-hidden="true" />{creating ? "新建中…" : "新建"}
          </button>
        </div>
        {loading ? <p className="batch-tag-dialog__hint">读取标签…</p> : catalog.length === 0 ? <p className="batch-tag-dialog__hint">还没有标签，先新建一个。</p> : (
          <div className="batch-tag-dialog__list" role="listbox" aria-label="选择标签" aria-multiselectable="true">
            {catalog.map((tag) => {
              const active = selected.includes(tag.id);
              return (
                <button key={tag.id} type="button" role="option" aria-selected={active}
                  className={"ln-row batch-tag-dialog__item" + (active ? " is-selected" : "")}
                  disabled={busy} onClick={() => setSelected((current) => toggleBatchTagSelection(current, tag.id))}>
                  <TagIcon size={14} aria-hidden="true" />
                  <span className="ln-ellipsis">{tag.name}</span>
                </button>
              );
            })}
          </div>
        )}
        {(error || createError) && <p className="batch-tag-dialog__error" role="alert">{createError ?? error}</p>}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={busy || selected.length === 0}
          onClick={() => onConfirm(selected)}>{busy ? "处理中…" : "添加"}</button>
      </div>
    </Dialog>
  );
}