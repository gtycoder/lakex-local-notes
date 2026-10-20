/** 双击进入单元格编辑时的光标落点换算。
 *
 * Univer 的画布可能在 CSS 上被缩放（rect 与 canvas 的 style 宽高不同），而
 * `DocSelectionRenderService.setCursorManually()` 吃的是画布本地坐标。这里只做纯算术，
 * 方便单测覆盖缩放、边界夹取和非法尺寸。
 */
export interface CanvasRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function editorCaretPoint(
  clientX: number,
  clientY: number,
  rect: CanvasRectLike,
  cssWidth: number,
  cssHeight: number,
): { x: number; y: number } {
  const width = cssWidth > 0 ? cssWidth : rect.width;
  const height = cssHeight > 0 ? cssHeight : rect.height;
  const scaleX = rect.width > 0 ? width / rect.width : 1;
  const scaleY = rect.height > 0 ? height / rect.height : 1;
  return {
    x: Math.max(0, Math.min(width, (clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(height, (clientY - rect.top) * scaleY)),
  };
}

/** 只有双击落在表格主画布上时才接管光标落点。Univer 会在原生 dblclick 派发前
 *  就由 pointerdown 手势打开编辑器，因此这里不能再按 `isCellEditing()` 拦截；
 *  编辑区内部的双击目标是 `univer-doc-main-canvas`，靠画布 id 即可区分。
 */
export function shouldPlaceCaretAfterDoubleClick(canvasId: string | null | undefined): boolean {
  return typeof canvasId === "string" && canvasId.startsWith("univer-sheet-main-canvas_");
}
