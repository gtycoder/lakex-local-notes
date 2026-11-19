import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { USHEET_DEFAULT_FONT_SIZE, emptyUsheetWorkbook } from "../../core/usheetDoc";

const EDITOR = readFileSync(new URL("./UniverSheetEditor.tsx", import.meta.url), "utf8");
// 261022：createUniver 配置抽到唯一入口 usheetUniverFactory.ts ⇒ footer 配置断言落在工厂里。
const FACTORY = readFileSync(new URL("./usheetUniverFactory.ts", import.meta.url), "utf8");
const CONTRACT = readFileSync(new URL("./usheetKernelContract.ts", import.meta.url), "utf8");
// 默认字号落点在 core 的 normalize（两端共用）⇒ 源码钉法要覆盖 usheetDoc 与移动端宿主。
const DOC = readFileSync(new URL("../../core/usheetDoc.ts", import.meta.url), "utf8");
const MOBILE = readFileSync(new URL("../../mobile/usheet/MobileUsheetViewer.tsx", import.meta.url), "utf8");

describe("新建表格 / 工作表的默认尺寸（用户 261103：默认 35 行 × 16 列；261010 起曾为 50）", () => {
  it("新建「表格」文档：35 行 × 16 列", () => {
    const sheet = emptyUsheetWorkbook().sheets?.s1 as { rowCount?: number; columnCount?: number } | undefined;
    expect(sheet?.rowCount).toBe(35);
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

describe("表格默认字号 = 11（Excel 11pt 口径，用户 261119）", () => {
  it("值的单一来源常量 = 11（core/usheetDoc.ts）", () => {
    expect(USHEET_DEFAULT_FONT_SIZE).toBe(11);
    expect(DOC).toContain("export const USHEET_DEFAULT_FONT_SIZE = 11;");
  });

  it("新建「表格」文档：workbook 与工作表的默认样式都落 11", () => {
    const wb = emptyUsheetWorkbook() as {
      defaultStyle?: { fs?: number };
      sheets?: Record<string, { defaultStyle?: { fs?: number } }>;
    };
    expect(wb.defaultStyle?.fs).toBe(11);
    expect(wb.sheets?.s1?.defaultStyle?.fs).toBe(11);
  });

  it("落点：normalize 把默认字号写进 workbook 与每张工作表的 defaultStyle（源码钉法）", () => {
    // 工作表级 defaultStyle 是 Univer 1.0.3 实际消费的渲染底；workbook 级是序列化面（见 CONTRACT 注释）
    expect(DOC).toContain("base.fs = USHEET_DEFAULT_FONT_SIZE");
    expect(DOC).toContain("sheetBase.fs = USHEET_DEFAULT_FONT_SIZE");
    expect(CONTRACT).toContain("USHEET_DEFAULT_FONT_SIZE");
    expect(CONTRACT).toContain("getDefaultCellStyleInternal");
  });

  it("两端同一落点：桌面与移动宿主都走 core 的 normalizeUsheetWorkbook", () => {
    for (const [name, src] of [["EDITOR", EDITOR], ["MOBILE", MOBILE]] as const) {
      expect(src, name + " 必须走 core 规范化落默认字号").toContain("normalizeUsheetWorkbook(workbook)");
    }
  });

  it("内核兜底 DEFAULT_STYLES.fs 漂移哨兵（1.0.3 = 11；不作为落点，升级改了要复核）", () => {
    const core = readFileSync(process.cwd() + "/node_modules/@univerjs/core/lib/es/index.js", "utf8");
    const fallback = /const DEFAULT_STYLES = \{[\s\S]{0,200}?fs: (\d+),/.exec(core)?.[1];
    expect(fallback, "内核 DEFAULT_STYLES.fs 变了：确认未设式样单元格仍由我们的 defaultStyle.fs=11 兜住").toBe("11");
  });
});
