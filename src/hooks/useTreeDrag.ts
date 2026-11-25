/**
 * 目录树拖拽（指针事件、无外部依赖）：按下 → 越过 5px 阈值出 ghost → 落点判定 →
 * 释放后 FLIP 归位动画（250ms ease）+ 900ms 兜底清理。
 *
 * D-04③（261125 审计终审批次）：从 components/app/Sidebar.tsx 纯搬家（零行为变化）。
 * 语义指针：拖拽视觉（源行变灰）只在越过阈值后出现（261123「打开都会闪烁一下」的根因）；
 * 落点 = 先排除源行、命中失败才回退就近行（避免每帧全表几何测量，实测 28ms/帧）；
 * 目标不支持 inside（笔记本只排序）时退化上下半区 before/after；释放后一次 click 被吞掉。
 * ghost 由 components/model/treeDrag 创建（DOM 层，pointer-events:none）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { escapeId } from "../lib/cssEscape";
import type { TreeNode } from "../lib/types";
import type { TreeIndex } from "../core/treeIndex";
import { computeDropPosition, createDragGhost, isValidTreeDrop, moveDragGhost, removeDragGhost, type DragGhost } from "../components/model/treeDrag";
import type { DropPosition } from "../components/app/sidebar/treeRowProps";

export interface UseTreeDragOptions {
  nodes: TreeNode[];
  /** 完整树索引（不受标签筛选收窄）：拖拽排序的兄弟集合以它为准。 */
  treeIndex: TreeIndex;
  onMoveNode: (id: string, targetId: string, position: DropPosition) => void;
  /** 目录滚动容器（ghost 定位取源行、拖拽边缘自动滚动都用它）。 */
  treeRef: { current: HTMLElement | null };
  /** 落点 inside 时展开目标节点。 */
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
}

export function useTreeDrag({ nodes, treeIndex, onMoveNode, treeRef, setExpanded }: UseTreeDragOptions) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // 真拖拽已开始（越过 5px 阈值）：拖拽视觉（源行变灰 .38）只在真拖时出现 ——
  // 旧实现按下即 setDraggingId ⇒ 每次点击/展开都「闪一下灰」（261123 用户报「打开都会闪烁一下」的根因）。
  const [dragMoved, setDragMoved] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);
  const [releaseState, setReleaseState] = useState<{
    id: string;
    target: { id: string; position: DropPosition };
    expectedParentId: string | null;
    expectedOrder: string[];
    positions: Record<string, number>;
  } | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null);
  const ghostRef = useRef<DragGhost | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const dropTargetRef = useRef<{ id: string; position: DropPosition } | null>(null);
  const suppressClickRef = useRef(false);

  const buildExpectedOrder = (movingId: string, target: { id: string; position: DropPosition }): { parentId: string | null; order: string[] } | null => {
    const moving = nodes.find((node) => node.id === movingId);
    const targetNode = nodes.find((node) => node.id === target.id);
    if (!moving || !targetNode) return null;
    const parentId = target.position === "inside" ? targetNode.id : targetNode.parentId;
    const siblings = (treeIndex.childrenByParent.get(parentId) ?? []).map((node) => node.id).filter((id) => id !== movingId);
    if (target.position === "inside") return { parentId, order: [...siblings, movingId] };
    const targetIndex = siblings.indexOf(target.id);
    if (targetIndex < 0) return { parentId, order: [...siblings, movingId] };
    siblings.splice(target.position === "after" ? targetIndex + 1 : targetIndex, 0, movingId);
    return { parentId, order: siblings };
  };

  useEffect(() => {
    if (!draggingId || releaseState) return;
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 5) return;
        drag.moved = true;
        setDragMoved(true);
        const sourceEl = treeRef.current?.querySelector<HTMLElement>(`[data-tree-node-id="${escapeId(drag.id)}"]`);
        ghostRef.current = sourceEl ? createDragGhost(sourceEl, event.clientX, event.clientY) : null;
      }
      pointerRef.current = { x: event.clientX, y: event.clientY };
      moveDragGhost(ghostRef.current, event.clientX, event.clientY);
      // 被拖动项本身会随指针移动，elementFromPoint 可能持续命中它，
      // 尤其是向上越过兄弟项时会导致永远无法得到真实落点。先排除源行，
      // 再从当前可见行中选出指针所在/最近的一行。
      // 浮层 pointer-events:none，elementFromPoint 直接命中真实行；只有命中失败才回退到就近行，
      // 避免每次 pointermove 对全表做 getClientRects/getBoundingClientRect（实测 28ms/帧）。
      const hit = document.elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest<HTMLElement>("[data-tree-node-id]"))
        .find((candidate) => candidate && candidate.dataset.treeNodeId !== drag.id);
      let row = hit ?? null;
      if (!row) {
        let bestDist = Infinity;
        document.querySelectorAll<HTMLElement>("[data-tree-node-id]").forEach((candidate) => {
          if (candidate.dataset.treeNodeId === drag.id) return;
          const box = candidate.getBoundingClientRect();
          if (box.height <= 0) return;
          const distance = Math.abs(box.top + box.height / 2 - event.clientY);
          if (distance < bestDist) { bestDist = distance; row = candidate; }
        });
      }
      if (!row) {
        dropTargetRef.current = null;
        setDropTarget(null);
        return;
      }
      const rowNodeId = row.dataset.treeNodeId;
      const rect = row.getBoundingClientRect();
      let position = computeDropPosition(rect, event.clientY) ?? (dropTargetRef.current?.position ?? "inside");
      const movingNode = nodes.find((node) => node.id === drag.id) ?? null;
      const targetNode = nodes.find((node) => node.id === rowNodeId) ?? null;
      // 目标不支持 inside（如笔记本只能排序）→ 退化为上下半区 before/after，避免中段无落点（对齐思源根节点）
      if (position === "inside" && !isValidTreeDrop(movingNode, targetNode, "inside")) {
        position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      }
      const nextTarget = { id: rowNodeId!, position };
      if (!isValidTreeDrop(movingNode, targetNode, nextTarget.position)) {
        dropTargetRef.current = null;
        setDropTarget(null);
        return;
      }
      if (dropTargetRef.current?.id === nextTarget.id && dropTargetRef.current?.position === nextTarget.position) return;
      dropTargetRef.current = nextTarget;
      setDropTarget(nextTarget);
    };
    const up = () => {
      removeDragGhost(ghostRef.current);
      ghostRef.current = null;
      const drag = dragRef.current;
      const finalDropTarget = dropTargetRef.current;
      if (drag?.moved && finalDropTarget) {
        const expected = buildExpectedOrder(drag.id, finalDropTarget);
        if (expected) {
          const positions: Record<string, number> = {};
          document.querySelectorAll<HTMLElement>("[data-tree-node-id]").forEach((row) => {
            const id = row.dataset.treeNodeId;
            if (id) positions[id] = row.getBoundingClientRect().top;
          });
          setReleaseState({ id: drag.id, target: finalDropTarget, expectedParentId: expected.parentId, expectedOrder: expected.order, positions });
          if (finalDropTarget.position === "inside") {
            setExpanded((current) => {
              const next = new Set(current);
              next.add(finalDropTarget.id);
              return next;
            });
          }
          suppressClickRef.current = true;
          onMoveNode(drag.id, finalDropTarget.id, finalDropTarget.position);
          window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        }
      }
      if (!drag?.moved || !finalDropTarget) {
        setDraggingId(null);
        setDragMoved(false);
      }
      dragRef.current = null;
      dropTargetRef.current = null;
      setDropTarget(null);
    };
    // 拖拽中边缘自动滚动（对齐思源 dragOverScroll）
    let scrollRaf = 0;
    const tick = () => {
      const scroller = treeRef.current;
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        const y = pointerRef.current.y;
        const edge = 44;
        if (y > 0 && y < box.top + edge) scroller.scrollTop -= 8;
        else if (y > box.bottom - edge) scroller.scrollTop += 8;
      }
      scrollRaf = window.requestAnimationFrame(tick);
    };
    scrollRaf = window.requestAnimationFrame(tick);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.cancelAnimationFrame(scrollRaf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [draggingId, releaseState, onMoveNode, nodes]);

  // 组件卸载时清掉可能残留的拖拽浮层
  useEffect(() => () => { removeDragGhost(ghostRef.current); ghostRef.current = null; }, []);

  const beginTreeDrag = useCallback((event: React.PointerEvent, id: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("input")) return;
    dragRef.current = { id, startX: event.clientX, startY: event.clientY, moved: false };
    setDragMoved(false);
    setReleaseState(null);
    dropTargetRef.current = null;
    setDropTarget(null);
    setDraggingId(id);
  }, []);
  const consumeSuppressedClick = useCallback(() => suppressClickRef.current, []);

  useLayoutEffect(() => {
    if (!releaseState) return;
    const rows = [...document.querySelectorAll<HTMLElement>("[data-tree-node-id]")];
    const currentOrder = nodes
      .filter((item) => item.parentId === releaseState.expectedParentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => item.id);
    const settled = currentOrder.join("|") === releaseState.expectedOrder.join("|");
    if (!settled) return;

    // 先读后写：一次性读取所有行位置（单次布局），再统一写 transform。
    // 原实现边写 style 边读 getBoundingClientRect → 每行强制重排一次，500+ 行时拖一次要 2s+。
    const currentTops: Array<{ row: HTMLElement; top: number }> = [];
    rows.forEach((row) => {
      const id = row.dataset.treeNodeId;
      if (!id || releaseState.positions[id] === undefined) return;
      currentTops.push({ row, top: row.getBoundingClientRect().top });
    });
    const animated: HTMLElement[] = [];
    currentTops.forEach(({ row, top }) => {
      const id = row.dataset.treeNodeId!;
      const delta = releaseState.positions[id] - top;
      if (Math.abs(delta) < 1) return;
      row.style.transition = "none";
      row.style.transform = `translateY(${delta}px)`;
      animated.push(row);
    });
    const frame = window.requestAnimationFrame(() => {
      animated.forEach((row) => {
        row.style.transition = "transform 250ms ease";
        row.style.transform = "translateY(0px)";
      });
    });
    const clear = () => {
      rows.forEach((row) => { row.style.transition = ""; row.style.transform = ""; });
      setReleaseState(null);
      setDraggingId(null);
      setDragMoved(false);
      setDropTarget(null);
    };
    const timer = window.setTimeout(clear, 280);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [nodes, releaseState]);

  useEffect(() => {
    if (!releaseState) return;
    const timer = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>("[data-tree-node-id]").forEach((row) => { row.style.transition = ""; row.style.transform = ""; });
      setReleaseState(null);
      setDraggingId(null);
      setDragMoved(false);
      setDropTarget(null);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [releaseState]);

  const draggedNode = draggingId ? nodes.find((node) => node.id === draggingId) ?? null : null;

  const dropNode = dropTarget ? nodes.find((node) => node.id === dropTarget.id) ?? null : null;
  const dropParentId = dropTarget && dropNode
    ? dropTarget.position === "inside" ? dropNode.id : dropNode.parentId
    : null;
  const draggedParentId = draggedNode?.parentId ?? null;

  return {
    draggingId,
    dragMoved,
    dropTarget,
    dropParentId,
    draggedParentId,
    releasingId: releaseState?.id ?? null,
    beginTreeDrag,
    consumeSuppressedClick,
  };
}
