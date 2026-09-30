import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { placePopoverAtPoint, placePopoverBeside, placePopoverPosition } from "./topMenuPosition";

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
}: UsePopoverPositionOptions): { surfaceRef: (el: HTMLElement | null) => void; style: CSSProperties | null } {
  const elRef = useRef<HTMLElement | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const atX = at?.x; const atY = at?.y;

  const place = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const next = atX !== undefined && atY !== undefined
      ? placePopoverAtPoint({ x: atX, y: atY }, viewport, size, margin)
      : anchor
        ? side === "right"
          ? placePopoverBeside(anchor.getBoundingClientRect(), viewport, size, gap, { margin })
          : placePopoverPosition(anchor.getBoundingClientRect(), viewport, size, gap, { align, margin })
        : null;
    if (!next) return;
    setStyle({ left: next.left, top: next.top, width });
  }, [anchor, atX, atY, align, side, gap, margin, width]);

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
  return { surfaceRef, style: style ?? provisional };
}
