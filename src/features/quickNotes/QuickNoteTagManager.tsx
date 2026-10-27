import { useEffect, useMemo, useState } from "react";
import { Check, GripVertical, Merge, Pencil, Pin, PinOff, Search, Trash, X } from "lucide-react";
import { Dialog } from "../../components/ui/Overlay";
import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";

interface QuickNoteTagManagerProps {
  open: boolean;
  tags: readonly QuickNoteTagSummary[];
  onClose(): void;
  /** 任一写操作完成后刷新目录与列表（工作区提供）。 */
  onChanged(): Promise<void>;
  onError(message: string): void;
}

/**
 * 标签管理（桌面）：重命名 / 合并 / 删除 / 置顶 / 拖拽排序。
 * 标签表是唯一来源；删除只从所有小记移除引用，不删除小记（用户 261024 定稿）。
 */
export function QuickNoteTagManager({ open, tags, onClose, onChanged, onError }: QuickNoteTagManagerProps) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [mergeSource, setMergeSource] = useState<QuickNoteTagSummary | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setEditingId(null);
    setMergeSource(null);
    setDragId(null);
  }, [open]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return tags;
    return tags.filter((tag) => tag.name.toLocaleLowerCase().includes(needle));
  }, [tags, query]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (reason) {
      onError(getNativeErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(tag: QuickNoteTagSummary): Promise<void> {
    const name = editName.trim();
    if (!name || name === tag.name) { setEditingId(null); return; }
    await run(() => native.updateQuickNoteTag(tag.id, { name }));
    setEditingId(null);
  }

  async function remove(tag: QuickNoteTagSummary): Promise<void> {
    if (!window.confirm(`删除标签“${tag.name}”？将从 ${tag.count} 条小记移除该标签，不会删除小记。`)) return;
    await run(() => native.deleteQuickNoteTag(tag.id));
    if (mergeSource?.id === tag.id) setMergeSource(null);
  }

  async function merge(source: QuickNoteTagSummary, target: QuickNoteTagSummary): Promise<void> {
    if (!window.confirm(`把“${source.name}”合并到“${target.name}”？合并后源标签消失，受影响的小记保留。`)) return;
    await run(() => native.mergeQuickNoteTags(source.id, target.id));
    setMergeSource(null);
  }

  function drop(targetId: string): void {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const order = tags.map((tag) => tag.id);
    const from = order.indexOf(dragId);
    const to = order.indexOf(targetId);
    setDragId(null);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    void run(() => native.reorderQuickNoteTags(order));
  }

  return (
    <Dialog open={open} onDismiss={onClose} label="标签管理" className="quick-note-tag-manager">
      <div className="ln-dialog__body">
        <header className="quick-note-tag-manager__head">
          <h3>标签管理</h3>
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭" onClick={onClose}><X size={15} /></button>
        </header>

        {mergeSource ? (
          <div className="quick-note-tag-manager__merge">
            <p>把“{mergeSource.name}”合并到：</p>
            <div className="quick-note-tag-manager__list">
              {tags.filter((tag) => tag.id !== mergeSource.id).map((tag) => (
                <button key={tag.id} type="button" className="ln-row" disabled={busy} onClick={() => void merge(mergeSource, tag)}>
                  <span className="ln-ellipsis">{tag.name}</span>
                  <span className="quick-note-tag-manager__count">({tag.count})</span>
                </button>
              ))}
              {tags.length <= 1 && <span className="ln-empty">没有其他标签可合并。</span>}
            </div>
            <footer className="quick-note-tag-manager__footer">
              <button type="button" className="ln-btn ln-btn--ghost" onClick={() => setMergeSource(null)}>取消</button>
            </footer>
          </div>
        ) : (
          <>
            <span className="ln-input quick-note-tag-manager__search">
              <Search size={14} />
              <input
                className="ln-input__field"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标签"
                aria-label="搜索标签"
              />
            </span>
            <div className="quick-note-tag-manager__list">
              {visible.map((tag) => (
                <div
                  key={tag.id}
                  className={"quick-note-tag-manager__row" + (tag.pinned ? " is-pinned" : "")}
                  draggable
                  onDragStart={() => setDragId(tag.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => drop(tag.id)}
                >
                  <span className="quick-note-tag-manager__grip" title="拖拽排序"><GripVertical size={14} /></span>
                  <button
                    type="button" className="ln-iconbtn ln-iconbtn--compact" disabled={busy}
                    aria-label={tag.pinned ? `取消置顶 ${tag.name}` : `置顶 ${tag.name}`}
                    title={tag.pinned ? "取消置顶" : "置顶"}
                    onClick={() => void run(() => native.updateQuickNoteTag(tag.id, { pinned: !tag.pinned }))}
                  >{tag.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
                  {editingId === tag.id ? (
                    <input
                      className="ln-input__field quick-note-tag-manager__rename"
                      autoFocus
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveRename(tag);
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      aria-label={`重命名标签 ${tag.name}`}
                    />
                  ) : (
                    <span className="quick-note-tag-manager__name ln-ellipsis">{tag.name}</span>
                  )}
                  <span className="quick-note-tag-manager__count">({tag.count})</span>
                  {editingId === tag.id ? (
                    <button type="button" className="ln-iconbtn ln-iconbtn--compact" disabled={busy} aria-label="保存名称" onClick={() => void saveRename(tag)}><Check size={14} /></button>
                  ) : (
                    <button type="button" className="ln-iconbtn ln-iconbtn--compact" disabled={busy} aria-label={`重命名 ${tag.name}`} title="重命名" onClick={() => { setEditingId(tag.id); setEditName(tag.name); }}><Pencil size={14} /></button>
                  )}
                  <button type="button" className="ln-iconbtn ln-iconbtn--compact" disabled={busy} aria-label={`合并 ${tag.name}`} title="合并到…" onClick={() => setMergeSource(tag)}><Merge size={14} /></button>
                  <button type="button" className="ln-iconbtn ln-iconbtn--compact quick-note-tag-manager__danger" disabled={busy} aria-label={`删除 ${tag.name}`} title="删除标签（保留小记）" onClick={() => void remove(tag)}><Trash size={14} /></button>
                </div>
              ))}
              {visible.length === 0 && (
                <span className="ln-empty ln-empty--idle">{tags.length === 0 ? "还没有标签。在写作卡或卡片上添加标签后会出现在这里。" : "没有匹配的标签。"}</span>
              )}
            </div>
            <footer className="quick-note-tag-manager__footer">
              <span className="quick-note-tag-manager__hint">排序与置顶随小记清单同步；删除标签不会删除小记。</span>
              <button type="button" className="ln-btn ln-btn--secondary" onClick={onClose}>完成</button>
            </footer>
          </>
        )}
      </div>
    </Dialog>
  );
}
