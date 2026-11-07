/**
 * 标签页长按拖拽排序（261107 架构收敛：从 TagsHomeTab 抽出，行为/判据不变）。
 *
 * 判据（与 261105 定稿一致）：长按 350ms 进入、document.elementFromPoint 命中 [data-tag-id]、
 * 过半判定 before/after、松手 reorderQuickNoteTags（设备本地顺序）、拖拽过的那次 click 吞掉。
 * 只负责拖拽状态与 touch 监听；排序落库后由调用方 reloadAll + busy 收尾。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { moveQuickNoteTagOrder, type QuickNoteTag } from "../../core/quickNoteTags";
import { bridge } from "../bridge";
import { toastActionError } from "../lib/actionError";
import { useLongPress } from "../ui/useLongPress";

export interface TagDragState {
  id: string;
  overId: string | null;
  after: boolean;
}

export interface UseTagDragSortOptions {
  tags: readonly QuickNoteTag[];
  /** 排序落库后刷新目录/关系。 */
  reloadAll: () => Promise<void>;
  /** 排序请求期间的全局 busy（与其它标签动作共用）。 */
  setBusy: (busy: boolean) => void;
}

export function useTagDragSort({ tags, reloadAll, setBusy }: UseTagDragSortOptions) {
  const order = useMemo(() => tags.map((tag) => tag.id), [tags]);
  const [drag, setDrag] = useState<TagDragState | null>(null);
  const dragRef = useRef<TagDragState | null>(null);
  dragRef.current = drag;
  const pressedId = useRef<string | null>(null);
  const startPoint = useRef<{ clientX: number; clientY: number } | null>(null);
  /** 长按过 ⇒ 松手后的 click 不进详情。 */
  const suppressClick = useRef(false);

  const longPress = useLongPress((touch) => {
    const id = pressedId.current;
    if (!id) return;
    suppressClick.current = true;
    setDrag({ id, overId: null, after: false });
    startPoint.current = touch;
  }, { moveCancelPx: 0 });

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
      setBusy(true);
      void bridge.reorderQuickNoteTags(nextOrder)
        .then(reloadAll)
        .catch((error: unknown) => toastActionError("排序", error))
        .finally(() => setBusy(false));
    };
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", finish);
    document.addEventListener("touchcancel", finish);
    return () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
    };
  }, [drag !== null, order, reloadAll, setBusy]);

  return { drag, setDrag, pressedId, startPoint, suppressClick, longPress };
}
