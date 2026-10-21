import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { emptyUsheetWorkbook } from "../../core/usheetDoc";

const EDITOR = readFileSync(new URL("./UniverSheetEditor.tsx", import.meta.url), "utf8");
// 261022：createUniver 配置抽到唯一入口 usheetUniverFactory.ts ⇒ footer 配置断言落在工厂里。
const FACTORY = readFileSync(new URL("./usheetUniverFactory.ts", import.meta.url), "utf8");
const CONTRACT = readFileSync(new URL("./usheetKernelContract.ts", import.meta.url), "utf8");

describe("新建表格 / 工作表的默认尺寸（用户 261010：默认 50 行 × 16 列）", () => {
  it("新建「表格」文档：50 行 × 16 列", () => {
    const sheet = emptyUsheetWorkbook().sheets?.s1 as { rowCount?: number; columnCount?: number } | undefined;
    expect(sheet?.rowCount).toBe(50);
    expect(sheet?.columnCount).toBe(16);
  });

  it("工作表标签「＋」：footer 配置用同一组常量（单一来源）", () => {
    // 内核默认 1000×20；只能从 preset 的 footer 配置改（SheetBar 读 SHEETS_UI_PLUGIN_CONFIG_KEY）
    expect(CONTRACT).toContain("defaultRowCount: USHEET_DEFAULT_ROWS");
    expect(CONTRACT).toContain("defaultColumnCount: USHEET_DEFAULT_COLUMNS");
    expect(CONTRACT).toContain("addSheetButtonConfig");
    // footer 的四个开关要一起给全，避免把默认（sheetBar/统计条/菜单/缩放）覆盖没了
    for (const key of ["sheetBar: true", "statisticBar: true", "menus: true", "zoomSlider: true"]) {
      expect(CONTRACT).toContain(key);
    }
    // 唯一创建入口必须引用这份配置（而不是自己再写一份）；编辑器只允许走这个入口。
    expect(FACTORY).toContain("footer: USHEET_FOOTER_CONFIG");
    expect(EDITOR).toContain("createUsheetUniver(");
    expect(EDITOR).not.toContain("UniverSheetsCorePreset(");
  });
});
