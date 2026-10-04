import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { placePopoverAtPoint, placePopoverAtPointBelow, placePopoverBeside, placePopoverPosition } from "./topMenuPosition";

export interface UsePopoverPositionOptions {
  open: boolean;
  /** 锚点元素（与 at 二选一；at 优先）。 */
  anchor?: HTMLElement | null;
  /** 坐标锚点（右键菜单这类没有稳定锚点元素的场景）。 */
  at?: { x: number; y: number } | null;
  /** 固定宽度：首帧就要写进 style，否则量到的是收缩后的宽度。 */
  width?: number;
  align?: "start" | "end";
  /** 默认在下方；right = 作为点击子菜单贴锚点右侧展开。 */
  side?: "below" | "right";
  gap?: number;
  margin?: number;
  /**
   * 坐标锚点（at）时是否允许「下方放不下就翻到锚点上方」。默认 true（右键菜单等要「至少完整可见」）。
   * 贴选区的 AI 弹窗必须传 false：翻上去会盖住选区（用户 261004 明确禁止）。
   */
  allowFlip?: boolean;
}

/**
 * 浮层定位（260929 收口）：**先把表面挂到屏外量真实尺寸，再按「下方优先、放不下翻上方、最后夹进视口」定位**。
 *
 * 为什么必须量：历史上各处用**猜的高度**去夹视口（48 / 90 / 300 …），猜小了就会
 * 「贴底被裁掉且不翻转」——多维表日期选择器就是这么坏的（单元格贴底时日历被切）。
 * 目录栏右键菜单是唯一做对的地方（先量 offsetHeight 再决定朝上/朝下），这里把同一条逻辑收敛成共用实现。
 *
 * 首帧用 visibility:hidden 而不是 display:none：前者仍参与布局，才量得到尺寸；
 * useLayoutEffect 在绘制前完成定位，用户看不到这一帧。
 */
export function usePopoverPosition({
  open,
  anchor,
  at,
  width,
  align = "start",
  side = "below",
  gap = 4,
  margin = 8,
  allowFlip = true,
}: UsePopoverPositionOptions): { surfaceRef: (el: HTMLElement | null) => void; style: CSSProperties | null; placed: boolean } {
  const elRef = useRef<HTMLElement | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const atX = at?.x; const atY = at?.y;

  const place = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    // 调用方给了目标宽度就**先落到元素再量**：宽度变化时 style state 还停在旧值，
    // 直接量 offsetWidth 会拿到旧宽 ⇒ 横向夹取用错宽度、左缘会偏（AI 弹窗跟随正文栏时实测到）。
    // 高度照旧实测（翻转全靠它）。写在 useLayoutEffect 里，绘制前完成，无视觉影响。
    if (width !== undefined) el.style.width = `${width}px`;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const next = atX !== undefined && atY !== undefined
      ? (allowFlip ? placePopoverAtPoint : placePopoverAtPointBelow)({ x: atX, y: atY }, viewport, size, margin)
      : anchor
        ? side === "right"
          ? placePopoverBeside(anchor.getBoundingClientRect(), viewport, size, gap, { margin })
          : placePopoverPosition(anchor.getBoundingClientRect(), viewport, size, gap, { align, margin })
        : null;
    if (!next) return;
    setStyle({ left: next.left, top: next.top, width });
  }, [anchor, atX, atY, align, side, gap, margin, width, allowFlip]);

  useLayoutEffect(() => {
    if (!open) { setStyle(null); return; }
    place();
    const el = elRef.current;
    // 内容尺寸变化（选项变多、面板换行）也要重新定位，否则同样会溢出视口
    const observer = el ? new ResizeObserver(() => place()) : null;
    if (el && observer) observer.observe(el);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const surfaceRef = useCallback((el: HTMLElement | null) => { elRef.current = el; }, []);
  const provisional: CSSProperties | null = open ? { left: -9999, top: -9999, width, visibility: "hidden" } : null;
  // `placed` = 定位已算完（首帧的 visibility:hidden 占位已换掉）。调用方若要「打开就聚焦」必须等它：
  // 占位帧的元素不可聚焦，此刻 focus() 会被浏览器静默忽略（AI 弹窗实测踩到）。
  return { surfaceRef, style: style ?? provisional, placed: style !== null };
}
