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

export interface PopoverPlacementOptions {
  /** 水平对齐：start = 与锚点左缘对齐（默认），end = 与锚点右缘对齐（贴右展开）。 */
  align?: "start" | "end";
  /** 视口四边至少留出的间距（默认 = gap）。 */
  margin?: number;
}

/**
 * **垂直方向的唯一口径**（260929 收口，修「贴底被裁/不翻转」这一反复出现的问题）：
 * 「先量真实尺寸 → 优先放锚点下方 → 放不下翻到上方 → 两边都放不下才夹进视口」。
 * 与目录栏右键菜单同一条逻辑；调用方**必须**传真实尺寸（量出来的），不要用估算高度，
 * 否则压不住裁切（历史上就是靠猜高度：48 / 90 / 300 …）。
 */
export function placeVertical(anchorTop: number, anchorBottom: number, viewportHeight: number, height: number, gap: number, margin: number): number {
  const below = anchorBottom + gap;
  if (below + height + margin <= viewportHeight) return below;
  const above = anchorTop - gap - height;
  if (above >= margin) return above;
  return Math.max(margin, Math.min(below, viewportHeight - height - margin));
}

/** 锚定定位（含翻转）：优先锚点下方，放不下翻上方，再不行夹进视口。 */
export function placePopoverPosition(
  anchor: Pick<AnchorRectLike, "top" | "bottom" | "left" | "right">,
  viewport: ViewportSize,
  popover: PopoverSize,
  gap: number,
  options: PopoverPlacementOptions = {},
): { top: number; left: number } {
  const margin = options.margin ?? gap;
  const maxLeft = Math.max(margin, viewport.width - popover.width - margin);
  const rawLeft = options.align === "end" ? anchor.right - popover.width : anchor.left;
  return {
    top: Math.round(placeVertical(anchor.top, anchor.bottom, viewport.height, popover.height, gap, margin)),
    left: Math.round(Math.max(margin, Math.min(rawLeft, maxLeft))),
  };
}

/** 坐标锚点定位（右键菜单：没有稳定锚点元素）：点当作「零高度锚点」，同样优先下方、放不下翻上方。 */
export function placePopoverAtPoint(
  point: { x: number; y: number },
  viewport: ViewportSize,
  popover: PopoverSize,
  margin = 8,
): { top: number; left: number } {
  return {
    top: Math.round(placeVertical(point.y, point.y, viewport.height, popover.height, 0, margin)),
    left: Math.round(Math.max(margin, Math.min(point.x, Math.max(margin, viewport.width - popover.width - margin)))),
  };
}

/**
 * 兼容入口（原有 5 处调用）：现已是 placePopoverPosition 的薄封装，
 * 因此也获得「下方放不下就向上翻」的行为；margin 取 gap 保持原语义。
 */
export function clampPopoverPosition(
  anchor: Pick<AnchorRectLike, "top" | "bottom" | "left" | "right">,
  viewport: ViewportSize,
  popover: PopoverSize,
  gap: number,
): { top: number; left: number } {
  return placePopoverPosition(anchor, viewport, popover, gap, { margin: gap });
}
