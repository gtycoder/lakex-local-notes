/**
 * 标签条拖拽排序（pointer 事件，无外部依赖）：按下 → 越过 6px 阈值 → 按**槽位**移动 →
 * 展开成真实顺序（分屏合并标签 = 整组落回同一槽位，expandTabSlots）+ FLIP 归位动画（180ms）。
 *
 * D-10（261125 审计终审批次）：从 features/editor/MultiTabEditor.tsx 纯搬家（零行为变化）。
 * 语义指针：261012 分屏组期间**也允许拖拽**（合并标签带 data-note-id = 组内靠前那页，整体作为一个
 * 槽位移动）；关闭标签时清掉 FLIP 位置记忆（P2-6，防长会话残留 + 重开同笔记误播滑入动画）；
 * 拖过 6px 后的那次 click 被吞掉（suppressClick）。
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { expandTabSlots, moveSlot } from "../features/editor/tabOrder";

export interface UseTabStripDragOptions {
  /** 只用到 noteId（FLIP 记忆键 + 分屏组成员集合）；完整标签对象留给渲染层。 */
  tabs: ReadonlyArray<{ noteId: string }>;
  onTabClose: (noteId: string) => void;
  /** 拖拽排序：给出新的 noteId 顺序。 */
  onTabsReorder?: (noteIds: string[]) => void;
  /** 分屏组（合并标签代表整组；拖拽排序按槽位展开成整组）。 */
  splitPair?: { left: string; right: string } | null;
  /** 分屏组内更靠前那页（合并标签的槽位 id）。 */
  splitFirstNote: string | null;
}

export function useTabStripDrag({ tabs, onTabClose, onTabsReorder, splitPair = null, splitFirstNote }: UseTabStripDragOptions) {
  const tabItemsRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; active: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const flipRects = useRef<Map<string, number>>(new Map());

  // P2-6：关闭标签时清掉 FLIP 位置记忆，防残留（长会话累积 + 重开同笔记时误播滑入动画）
  const handleTabClose = useCallback((noteId: string) => {
    flipRects.current.delete(noteId);
    onTabClose(noteId);
  }, [onTabClose]);

  // FLIP：顺序变化时让标签从旧位置滑到新位置（deps 用 memo 化的 orderKey，
  // tabs 引用不变时跳过拼接与比较）
  const tabOrderKey = useMemo(() => tabs.map((t) => t.noteId).join("|"), [tabs]);
  useLayoutEffect(() => {
    const strip = tabItemsRef.current;
    if (!strip) return;
    const els = [...strip.querySelectorAll<HTMLElement>(".tab-item")];
    for (const el of els) {
      const id = el.dataset.noteId;
      if (!id) continue;
      const prev = flipRects.current.get(id);
      const next = el.getBoundingClientRect().left;
      flipRects.current.set(id, next);
      if (prev != null && Math.abs(prev - next) > 1) {
        el.animate(
          [{ transform: `translateX(${prev - next}px)` }, { transform: "translateX(0)" }],
          { duration: 180, easing: "cubic-bezier(.22, 1, .36, 1)" }
        );
      }
    }
  }, [tabOrderKey]);

  const beginTabDrag = (event: React.PointerEvent<HTMLButtonElement>, noteId: string) => {
    // 261012：分屏组期间**也允许拖拽**（合并标签带 data-note-id = 组内靠前那页，整体作为一个槽位移动）。
    if (event.button !== 0 || !onTabsReorder) return;
    if ((event.target as HTMLElement).closest(".tab-close")) return;
    dragRef.current = { id: noteId, startX: event.clientX, startY: event.clientY, active: false };
  };

  const moveTabDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      drag.active = true;
      suppressClickRef.current = true;
      setDraggingId(drag.id);
    }
    const strip = tabItemsRef.current;
    if (!strip) return;
    // **槽位** = 标签栏实际渲染出的项（分屏组只占一个槽：合并标签的 data-note-id = 组内靠前那页）。
    // 先按槽位算移动（用户看到的就是槽位），再展开成真实顺序 —— 组内两页整块落回该槽位（见 tabOrder.ts）。
    const items = [...strip.querySelectorAll<HTMLElement>(".tab-item")]
      .map((el) => ({ id: el.dataset.noteId ?? "", el }))
      .filter((item) => item.id);
    const slots = items.map((item) => item.id);
    const from = slots.indexOf(drag.id);
    if (from < 0) return;
    // 以指针 x 与各标签中心比较，确定插入位置
    let to = from;
    for (let i = 0; i < slots.length; i += 1) {
      if (i === from) continue;
      const r = items[i].el.getBoundingClientRect();
      const center = r.left + r.width / 2;
      if (i < from && event.clientX < center) { to = i; break; }
      if (i > from && event.clientX > center) to = i;
    }
    const nextSlots = moveSlot(slots, from, to);
    if (nextSlots === slots) return;
    const groupMembers = splitPair
      ? tabs.map((t) => t.noteId).filter((id) => id === splitPair.left || id === splitPair.right)
      : [];
    onTabsReorder?.(expandTabSlots(nextSlots, splitFirstNote, groupMembers));
  };

  const endTabDrag = () => {
    if (dragRef.current?.active) {
      // 让 click 事件（切换标签）被抑制一次
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    } else {
      suppressClickRef.current = false;
    }
    dragRef.current = null;
    setDraggingId(null);
  };

  return {
    tabItemsRef,
    draggingId,
    suppressClickRef,
    beginTabDrag,
    moveTabDrag,
    endTabDrag,
    handleTabClose,
  };
}
