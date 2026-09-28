import { useEffect, type RefObject } from "react";

/**
 * Embedded canvases must not steal the document wheel while the reader is only
 * passing over them. A click explicitly enters canvas interaction mode; a
 * click elsewhere returns wheel control to the document.
 */
export function shouldBlockCanvasWheel(active: boolean): boolean {
  return !active;
}

/** Selection-only updates do not rebuild the Lake card and must not arm the
 * document scroll restoration path. */
export function shouldRestoreDocumentScrollAfterBoardChange(elementsChanged: boolean): boolean {
  return elementsChanged;
}

/** Once a board is activated, clicks inside its canvas should not re-focus the
 * outer Lake card on every shape selection. */
export function shouldSkipBoardCardFocus(insideBoard: boolean, canvasActive: boolean): boolean {
  return insideBoard && canvasActive;
}

export function useClickActivatedWheelGate(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let active = false;
    const setActive = (value: boolean) => {
      active = value;
      root.classList.toggle("canvas-interaction-active", value);
      root.setAttribute("data-canvas-interaction", value ? "active" : "passive");
    };
    const onClick = () => setActive(true);
    const onWheelCapture = (event: WheelEvent) => {
      // Stop the embedded canvas' own wheel listener, but do not preventDefault:
      // the surrounding editor scroll container must still perform its normal
      // document scroll while the canvas is passive.
      if (shouldBlockCanvasWheel(active)) event.stopPropagation();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) setActive(false);
    };
    setActive(false);
    root.addEventListener("click", onClick, true);
    root.addEventListener("wheel", onWheelCapture, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("wheel", onWheelCapture, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      root.classList.remove("canvas-interaction-active");
      root.removeAttribute("data-canvas-interaction");
    };
  }, [rootRef]);
}
