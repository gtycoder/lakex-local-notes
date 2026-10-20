import { describe, expect, it } from "vitest";
import { editorCaretPoint, shouldPlaceCaretAfterDoubleClick } from "./usheetCellEdit";

describe("usheet desktop cell editing", () => {
  it("把双击的屏幕坐标换算成编辑器画布坐标（含 CSS 缩放）", () => {
    const point = editorCaretPoint(260, 240, { left: 200, top: 200, width: 100, height: 50 }, 200, 100);
    expect(point).toEqual({ x: 120, y: 80 });
  });

  it("把落点夹在画布内，异常尺寸退回 1:1", () => {
    expect(editorCaretPoint(100, 100, { left: 120, top: 140, width: 0, height: 0 }, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(editorCaretPoint(999, 999, { left: 10, top: 20, width: 80, height: 24 }, 80, 24)).toEqual({ x: 80, y: 24 });
  });

  it("只接管表格主画布双击；编辑器内画布仍走内核选词", () => {
    expect(shouldPlaceCaretAfterDoubleClick("univer-sheet-main-canvas_workbook")).toBe(true);
    expect(shouldPlaceCaretAfterDoubleClick("univer-doc-main-canvas")).toBe(false);
    expect(shouldPlaceCaretAfterDoubleClick(undefined)).toBe(false);
  });
});
