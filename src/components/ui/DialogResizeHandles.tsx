import type { PointerEvent as ReactPointerEvent } from "react";
import type { ResizeDirection } from "../hooks/useFloatingDialog";

const DIRECTIONS: ResizeDirection[] = ["r", "l", "t", "d", "rd", "rt", "ld", "lt"];

/** 8 向缩放手柄（对齐思源 dialog 的 .resize__r/l/t/d/rd/rt/ld/lt）。放在弹窗根元素内。 */
export function DialogResizeHandles({ onResize }: {
  onResize: (event: ReactPointerEvent<HTMLElement>, direction: ResizeDirection) => void;
}) {
  return (
    <>
      {DIRECTIONS.map((direction) => (
        <span
          key={direction}
          className={`floating-dialog-resize floating-dialog-resize--${direction}`}
          aria-hidden="true"
          onPointerDown={(event) => onResize(event, direction)}
        />
      ))}
    </>
  );
}
