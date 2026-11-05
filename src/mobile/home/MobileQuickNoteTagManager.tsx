/**
 * 移动端标签管理（261105）：重命名 / 删除 / 合并 / 置顶 / 排序。
 *
 * 与桌面 `QuickNoteTagManager` 同能力（桌面拖拽排序 → 移动端「上移/下移」，触屏点按更稳）。
 * 标签目录是唯一来源；删除只移除关联、不删除小记（用户口径）。版式复用 qn-tag-sheet 面板骨架 + mb-* 原语。
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Merge, MoreHorizontal, Pencil, Pin, PinOff, Trash } from "lucide-react";
import { bridge } from "../bridge";
import { normalizeQuickNoteTag, type QuickNoteTagSummary } from "../../core/quickNoteTags";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { confirmMobile } from "../ui/ConfirmDialog";
import { MobileSheet } from "../ui/MobileSheet";
import { showToast } from "../ui/toastBus";

export interface MobileQuickNoteTagManagerProps {
  open: boolean;
  /** 完整目录（含 0 条小记的标签）+ 计数；顺序 = 目录展示顺序（置顶 → sortOrder → 名称）。 */
  tags: readonly QuickNoteTagSummary[];
  onClose(): void;
  /** 任一写操作完成后刷新目录与小记列表（关系可能变了）。 */
  onChanged(): Promise<void>;
}

export function MobileQuickNoteTagManager({ open, tags, onClose, onChanged }: MobileQuickNoteTagManagerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);

  const mergeSource = useMemo(() => tags.find((tag) => tag.id === mergeSourceId) ?? null, [tags, mergeSourceId]);
  const mergeTargets = useMemo(() => tags.filter((tag) => tag.id !== mergeSourceId), [tags, mergeSourceId]);
  const order = useMemo(() => tags.map((tag) => tag.id), [tags]);

  const run = async (task: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await task();
      await onChanged();
    } catch (reason) {
      const message = getNativeErrorMessage(reason);
      setError(message);
      showToast("标签操作失败：" + message, { type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const togglePin = (tag: QuickNoteTagSummary): Promise<void> => run(async () => {
    await bridge.updateQuickNoteTag(tag.id, { pinned: !tag.pinned });
  });

  const startRename = (tag: QuickNoteTagSummary): void => {
    setExpandedId(null);
    setEditingId(tag.id);
    setEditName(tag.name);
  };

  const saveRename = (tag: QuickNoteTagSummary): Promise<void> => {
    const name = editName.trim();
    if (!name || name === tag.name) { setEditingId(null); return Promise.resolve(); }
    return run(async () => {
      await bridge.updateQuickNoteTag(tag.id, { name: normalizeQuickNoteTag(name) });
      setEditingId(null);
    });
  };

  const remove = (tag: QuickNoteTagSummary): Promise<void> => run(async () => {
    const ok = await confirmMobile({
      title: "删除标签「" + tag.name + "」？",
      body: "将从 " + tag.count + " 条小记移除该标签，不会删除小记。",
      confirmText: "删除标签",
      danger: true,
    });
    if (!ok) return;
    await bridge.deleteQuickNoteTag(tag.id);
    setExpandedId(null);
  });

  const merge = (source: QuickNoteTagSummary, target: QuickNoteTagSummary): Promise<void> => run(async () => {
    const ok = await confirmMobile({
      title: "把「" + source.name + "」合并到「" + target.name + "」？",
      body: "合并后源标签消失，受影响的小记保留。",
      confirmText: "合并",
    });
    if (!ok) return;
    await bridge.mergeQuickNoteTags(source.id, target.id);
    setMergeSourceId(null);
  });

  const move = (tag: QuickNoteTagSummary, delta: -1 | 1): Promise<void> => {
    const from = order.indexOf(tag.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return Promise.resolve();
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return run(async () => { await bridge.reorderQuickNoteTags(next); });
  };

  const footer = (
    <div className="mb-sheet__foot">
      <button type="button" className="mb-btn mb-btn--primary" onClick={onClose}>完成</button>
    </div>
  );

  return (
    <MobileSheet
      open={open}
      title="标签管理"
      onClose={onClose}
      className="qn-tag-sheet"
      bodyClassName="qn-tag-sheet__body mb-sheet__body--form"
      footer={footer}
    >
      {mergeSource ? (
        <div className="qn-tag-sheet__list">
          <div className="qn-tag-sheet__section"><Merge size={14} /><span>把「{mergeSource.name}」合并到：</span></div>
          {mergeTargets.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="qn-tag-sheet__item"
              disabled={busy}
              onClick={() => void merge(mergeSource, tag)}
            >
              <span className="mb-ellipsis">{tag.name}</span>
              <span className="qn-tag-sheet__count">{tag.count}</span>
            </button>
          ))}
          {mergeTargets.length === 0 && <div className="qn-tag-sheet__empty">没有其他标签可合并</div>}
          <div className="qn-tag-manager__actions">
            <button type="button" className="mb-btn mb-btn--secondary" onClick={() => setMergeSourceId(null)}>取消</button>
          </div>
        </div>
      ) : (
        <div className="qn-tag-sheet__list">
          {tags.length === 0 && <div className="qn-tag-sheet__empty">还没有标签。在写作卡或小记卡片上添加标签后会出现在这里</div>}
          {tags.map((tag, index) => (
            <div key={tag.id} className="qn-tag-manager__block">
              {editingId === tag.id ? (
                <div className="qn-tag-sheet__input-row">
                  <span className="mb-input qn-tag-sheet__input">
                    <input
                      value={editName}
                      autoFocus
                      aria-label="标签名"
                      onChange={(event) => { setEditName(event.target.value); setError(null); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") { event.preventDefault(); void saveRename(tag); }
                        else if (event.key === "Escape") { setEditingId(null); }
                      }}
                    />
                  </span>
                  <button type="button" disabled={busy} onClick={() => void saveRename(tag)}>保存</button>
                </div>
              ) : (
                <div className="qn-tag-manager__row">
                  <button
                    type="button"
                    className="mb-iconbtn"
                    disabled={busy}
                    aria-label={(tag.pinned ? "取消置顶 " : "置顶 ") + tag.name}
                    onClick={() => void togglePin(tag)}
                  >
                    {tag.pinned ? <Pin size={16} /> : <PinOff size={16} />}
                  </button>
                  <span className="qn-tag-manager__name">{tag.name}</span>
                  <span className="qn-tag-sheet__count">{tag.count}</span>
                  <button
                    type="button"
                    className="mb-iconbtn"
                    disabled={busy}
                    aria-label={"更多操作 " + tag.name}
                    aria-expanded={expandedId === tag.id}
                    onClick={() => setExpandedId(expandedId === tag.id ? null : tag.id)}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              )}
              {expandedId === tag.id && editingId !== tag.id && (
                <div className="qn-tag-manager__actions">
                  <button type="button" className="mb-btn mb-btn--secondary" disabled={busy} onClick={() => startRename(tag)}>
                    <Pencil size={14} />重命名
                  </button>
                  <button type="button" className="mb-btn mb-btn--secondary" disabled={busy || index === 0} onClick={() => void move(tag, -1)}>
                    <ArrowUp size={14} />上移
                  </button>
                  <button type="button" className="mb-btn mb-btn--secondary" disabled={busy || index === tags.length - 1} onClick={() => void move(tag, 1)}>
                    <ArrowDown size={14} />下移
                  </button>
                  <button type="button" className="mb-btn mb-btn--secondary" disabled={busy || tags.length < 2} onClick={() => setMergeSourceId(tag.id)}>
                    <Merge size={14} />合并到…
                  </button>
                  <button type="button" className="mb-btn mb-btn--secondary" disabled={busy} onClick={() => void remove(tag)}>
                    <Trash size={14} />删除
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <div className="qn-tag-sheet__error" role="alert">{error}</div>}
    </MobileSheet>
  );
}
