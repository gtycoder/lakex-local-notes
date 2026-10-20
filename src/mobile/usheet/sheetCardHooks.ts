/**
 * 锚定卡片的两个共用 hook（261021 P1/P2）：
 * - useAnchoredCardStyle：把触发按钮的视口坐标换算成宿主内坐标（卡片 position:absolute，不 portal、不用 fixed）；
 * - useCardDismiss：点外部 / Esc 关闭（capture，避开 Univer 内部 stopPropagation；点触发按钮不关闭）。
 */
import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";

const EDGE = 6;

export function useAnchoredCardStyle(host: HTMLElement | null, anchor: HTMLElement | null, width: number): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ top: 0, left: EDGE, width });
  useLayoutEffect(() => {
    const place = () => {
      const hostRect = host?.getBoundingClientRect();
      const anchorRect = anchor?.getBoundingClientRect();
      if (!hostRect || !anchorRect) return;
      const top = Math.round(anchorRect.bottom - hostRect.top + 2);
      const maxLeft = Math.max(EDGE, hostRect.width - width - EDGE);
      const left = Math.min(Math.max(EDGE, Math.round(anchorRect.left - hostRect.left)), maxLeft);
      const maxHeight = Math.max(160, Math.round(hostRect.height - top - 8));
      setStyle({ top, left, width, maxHeight });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [host, anchor, width]);
  return style;
}

export function useCardDismiss(
  cardRef: React.RefObject<HTMLElement | null>,
  anchor: HTMLElement | null,
  onClose: () => void,
): void {
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [cardRef, anchor, onClose]);
}
