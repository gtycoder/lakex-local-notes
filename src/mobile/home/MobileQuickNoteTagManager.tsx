/**
 * 移动端标签管理（261105）：重命名 / 删除 / 合并 / 拖拽排序。
 *
 * 用户定稿：**标签顺序是设备本地视图**（不参与 S3 同步，不同端可以不同）；置顶功能已整体删除。
 * 拖拽交互与移动端目录栏同口径：长按 350ms 进入拖拽、跟手找落点（行前/行后）、松手提交一次 reorder。
 * 未手动排序时由仓库层给默认顺序（新的在前 → 名称）；首次拖拽后本机记「已手动排序」，新标签追加末尾。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Merge, MoreHorizontal, Pencil, Trash } from "lucide-react";
import { bridge } from "../bridge";
import { moveQuickNoteTagOrder, normalizeQuickNoteTag, type QuickNoteTagSummary } from "../../core/quickNoteTags";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { confirmMobile } from "../ui/ConfirmDialog";
import { MobileSheet } from "../ui/MobileSheet";
import { useLongPress } from "../ui/useLongPress";
import { showToast } from "../ui/toastBus";

export interface MobileQuickNoteTagManagerProps {
  open: boolean;
  /** 完整目录（含 0 条小记的标签）+ 计数；顺序 = 本机展示顺序。 */
  tags: readonly QuickNoteTagSummary[];
  onClose(): void;
  /** 任一写操作完成后刷新目录与小记列表（关系可能变了）。 */
  onChanged(): Promise<void>;
}

interface DragState { id: string; overId: string | null; after: boolean }

export function MobileQuickNoteTagManager({ open, tags, onClose, onChanged }: MobileQuickNoteTagManagerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const pressedId = useRef<string | null>(null);

  const order = useMemo(() => tags.map((tag) => tag.id), [tags]);
  const mergeSource = useMemo(() => tags.find((tag) => tag.id === mergeSourceId) ?? null, [tags, mergeSourceId]);
  const mergeTargets = useMemo(() => tags.filter((tag) => tag.id !== mergeSourceId), [tags, mergeSourceId]);

  const run = useCallback(async (task: () => Promise<void>): Promise<void> => {
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
  }, [busy, onChanged]);

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

  const startPoint = useRef<{ clientX: number; clientY: number } | null>(null);

  /** 长按进入拖拽（与目录栏同一手势语义）；按钮上的触摸不参与拖拽。 */
  const longPress = useLongPress((touch) => {
    const id = pressedId.current;
    if (!id) return;
    setDrag({ id, overId: null, after: false });
    setExpandedId(null);
    setEditingId(null);
    // 记录起手点，供落点计算（touch 事件里现算，不依赖 React 状态）
    startPoint.current = touch;
  }, { moveCancelPx: 0 });

  // 拖拽期间：跟手找落点（行前/行后），松手提交一次 reorder。
  useEffect(() => {
    if (!drag) return;
    const compute = (clientY: number): { overId: string | null; after: boolean } => {
      const hit = document.elementFromPoint(startPoint.current?.clientX ?? 0, clientY) as HTMLElement | null;
      const row = hit?.closest("[data-tag-id]") as HTMLElement | null;
      const overId = row?.getAttribute("data-tag-id") ?? null;
      if (!overId || overId === dragRef.current?.id) return { overId: null, after: false };
      const rect = row!.getBoundingClientRect();
      return { overId, after: clientY > rect.top + rect.height / 2 };
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      const next = compute(touch.clientY);
      const current = dragRef.current;
      if (!current) return;
      if (current.overId === next.overId && current.after === next.after) return;
      setDrag({ ...current, ...next });
    };
    const finish = () => {
      const current = dragRef.current;
      setDrag(null);
      startPoint.current = null;
      if (!current?.overId) return;
      const nextOrder = moveQuickNoteTagOrder(order, current.id, current.overId, current.after ? "after" : "before");
      if (nextOrder.join("\u0000") === order.join("\u0000")) return;
      void run(async () => { await bridge.reorderQuickNoteTags(nextOrder); });
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", finish);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
    };
  }, [drag !== null, order, run]);

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
          {tags.length > 0 && <div className="qn-tag-manager__hint">长按拖动可排序（只在本机生效）</div>}
          {tags.map((tag) => (
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
                <div
                  className={"qn-tag-manager__row"
                    + (drag?.id === tag.id ? " is-dragging" : "")
                    + (drag?.overId === tag.id && !drag.after ? " is-drop-before" : "")
                    + (drag?.overId === tag.id && drag.after ? " is-drop-after" : "")}
                  data-tag-id={tag.id}
                  onTouchStart={(event) => {
                    if ((event.target as HTMLElement).closest("button")) return;
                    pressedId.current = tag.id;
                    longPress.onTouchStart(event);
                  }}
                  onTouchMove={longPress.onTouchMove}
                  onTouchEnd={longPress.onTouchEnd}
                  onTouchCancel={longPress.onTouchCancel}
                >
                  <span className="qn-tag-manager__handle" aria-hidden="true"><GripVertical size={14} /></span>
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
