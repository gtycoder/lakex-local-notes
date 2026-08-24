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
