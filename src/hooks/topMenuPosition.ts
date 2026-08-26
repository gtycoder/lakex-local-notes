export interface AnchorRectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width?: number;
  height?: number;
}

export interface AnchorLike {
  getBoundingClientRect: () => AnchorRectLike;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

function hasVisibleRect(element: AnchorLike | null | undefined): element is AnchorLike {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return (rect.width ?? rect.right - rect.left) > 0 && (rect.height ?? rect.bottom - rect.top) > 0;
}

/**
 * Keep-alive workspaces can leave a shared ref pointing at a hidden copy.
 * Prefer that ref when it is usable, otherwise use the first visible candidate.
 */
export function chooseVisibleAnchor<T extends AnchorLike>(primary: T | null | undefined, candidates: readonly T[]): T | null {
  if (hasVisibleRect(primary)) return primary;
  return candidates.find((candidate) => hasVisibleRect(candidate)) ?? null;
}

export function clampPopoverPosition(
  anchor: Pick<AnchorRectLike, "top" | "bottom" | "left" | "right">,
  viewport: ViewportSize,
  popover: PopoverSize,
  gap: number,
): { top: number; left: number } {
  const maxLeft = Math.max(gap, viewport.width - popover.width - gap);
  const maxTop = Math.max(gap, viewport.height - popover.height - gap);
  return {
    top: Math.round(Math.max(gap, Math.min(anchor.bottom + gap, maxTop))),
    left: Math.round(Math.max(gap, Math.min(anchor.left, maxLeft))),
  };
}
