import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** 261021：Univer 移动公式栏 FormulaEditor 写死 disableSelectionOnClick:true，点文字不落光标；
 *  宿主在 pointerup 后对公式栏 render unit 调 setCursorManually 恢复。这里钉住接线与作用域。 */
const SRC = readFileSync(new URL("./MobileUsheetViewer.tsx", import.meta.url), "utf8");

describe("移动公式栏点击落点（261021）", () => {
  it("只接公式栏编辑器，pointerup 后按坐标落光标", () => {
    expect(SRC).toContain('data-u-comp="formula-editor"');
    expect(SRC).toContain("DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY");
    expect(SRC).toContain("IRenderManagerService");
    expect(SRC).toContain("editorCaretPoint");
    expect(SRC).toMatch(/setCursorManually\(point\.x, point\.y, true, true, \{ strict: false \}\)/);
  });
});
