export type TreeDragDropPosition = "before" | "inside" | "after";

/**
 * Calculate the temporary single-row displacement for siblings while the
 * dragged row keeps its original DOM slot. The returned offsets are in px:
 * negative means move up, positive means move down.
 */
export function computeSiblingDragOffsets(
  siblingIds: string[],
  draggingId: string,
  targetId: string | null,
  position: TreeDragDropPosition | null,
  rowHeight: number,
): Record<string, number> {
  const offsets: Record<string, number> = {};
  if (!targetId || !position || position === "inside" || rowHeight <= 0) return offsets;
  const sourceIndex = siblingIds.indexOf(draggingId);
  const targetIndex = siblingIds.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return offsets;

  const insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  if (sourceIndex < insertionIndex) {
    for (let index = sourceIndex + 1; index < Math.min(insertionIndex, siblingIds.length); index += 1) {
      if (siblingIds[index] !== draggingId) offsets[siblingIds[index]] = -rowHeight;
    }
  } else if (sourceIndex > insertionIndex) {
    for (let index = insertionIndex; index < sourceIndex; index += 1) {
      if (siblingIds[index] !== draggingId) offsets[siblingIds[index]] = rowHeight;
    }
  }
  return offsets;
}

export function isCrossingSibling(
  draggingId: string | null,
  targetId: string | null,
  position: TreeDragDropPosition | null,
  sameParent = true,
): boolean {
  return Boolean(sameParent && draggingId && targetId && draggingId !== targetId && position && position !== "inside");
}


export interface TreeDropNode {
  id: string;
  nodeType: "notebook" | "group" | "note";
  parentId: string | null;
}

/** Root-level before/after drops are valid only for notebooks. */
export function isValidTreeDrop(
  moving: TreeDropNode | null,
  target: TreeDropNode | null,
  position: TreeDragDropPosition | null,
): boolean {
  if (!moving || !target || moving.id === target.id || !position) return false;
  if (moving.nodeType === "notebook") return position !== "inside" && target.parentId === null;
  if (position === "inside") return target.nodeType !== "notebook" || target.id !== moving.id;
  return target.parentId !== null;
}


export function getDropIndicator(position: TreeDragDropPosition | null): "line" | "parent" | null {
  if (!position) return null;
  return position === "inside" ? "parent" : "line";
}

/** 按指针在行内的纵向比例判定落点（before/after/inside）。
 * 阈值随行高自适应：小行收窄插入区，避免 38px 固定阈值在小行上误判为 inside。
 * @returns 无有效行高时返回 null（调用方维持原落点）。 */
export function computeDropPosition(rect: { top: number; height: number }, clientY: number): TreeDragDropPosition | null {
  if (rect.height <= 0) return null;
  const ratio = (clientY - rect.top) / rect.height;
  // 插入区宽度：至少 6px、最多 12px（大行用 25%，小行用固定下限）
  const threshold = Math.min(12, Math.max(6, rect.height * 0.25));
  const zone = threshold / rect.height;
  // 半开区间：边界像素归入插入区（<=），避免精确落在阈值上时落入 inside 的死区
  if (ratio <= zone) return "before";
  if (ratio >= 1 - zone) return "after";
  return "inside";
}

// ---- 拖拽浮层（对齐思源 dragTipGhost：克隆源行跟随指针，源行留在原位只降透明度）----

export interface DragGhost {
  element: HTMLElement;
  offsetX: number;
  offsetY: number;
}

/** 克隆源行生成跟随指针的浮层；源行不可见时返回 null。 */
export function createDragGhost(source: HTMLElement, clientX: number, clientY: number): DragGhost | null {
  const rect = source.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-tree-node-id");
  ghost.removeAttribute("data-node-id");
  ghost.querySelectorAll("[data-tree-node-id], [data-node-id], [id]").forEach((el) => {
    el.removeAttribute("data-tree-node-id");
    el.removeAttribute("data-node-id");
    el.removeAttribute("id");
  });
  ghost.classList.remove("dragging", "nb-dragging", "drop-line-before", "drop-line-after", "drop-parent");
  ghost.setAttribute("data-drag-ghost", "");
  ghost.style.width = rect.width + "px";
  ghost.style.height = rect.height + "px";
  document.body.appendChild(ghost);
  const result: DragGhost = { element: ghost, offsetX: clientX - rect.left, offsetY: clientY - rect.top };
  moveDragGhost(result, clientX, clientY);
  return result;
}

/** 让浮层跟手：transform 走 GPU，直接改 DOM，不触发 React 重渲染。 */
export function moveDragGhost(ghost: DragGhost | null, clientX: number, clientY: number): void {
  if (!ghost) return;
  ghost.element.style.transform = "translate3d(" + (clientX - ghost.offsetX) + "px," + (clientY - ghost.offsetY) + "px,0)";
}

export function removeDragGhost(ghost: DragGhost | null): void {
  ghost?.element.remove();
}
