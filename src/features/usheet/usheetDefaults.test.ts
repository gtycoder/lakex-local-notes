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

describe("表格默认居中 / 自动换行 / 自动行高（用户 261121）", () => {
  it("常量单一来源：居中 2 / 换行 3 / 自动行高 1 / 上限 500 行", async () => {
    const core = await import("../../core/usheetDoc");
    expect(core.USHEET_DEFAULT_HORIZONTAL_ALIGN).toBe(2); // HorizontalAlign.CENTER
    expect(core.USHEET_DEFAULT_WRAP_STRATEGY).toBe(3); // WrapStrategy.WRAP
    expect(core.USHEET_ROW_IS_AUTO_HEIGHT).toBe(1); // BooleanNumber.TRUE
    expect(core.USHEET_AUTO_ROW_HEIGHT_MAX_ROWS).toBe(500);
  });

  it("新建表格：workbook 与工作表 defaultStyle 都落 ht/tb，且 35 行都标自动行高", () => {
    const wb = emptyUsheetWorkbook() as {
      defaultStyle?: { ht?: number; tb?: number };
      sheets?: Record<string, { defaultStyle?: { ht?: number; tb?: number }; rowData?: Record<string, { ia?: number; h?: number }> }>;
    };
    expect(wb.defaultStyle?.ht).toBe(2);
    expect(wb.defaultStyle?.tb).toBe(3);
    expect(wb.sheets?.s1?.defaultStyle?.ht).toBe(2);
    expect(wb.sheets?.s1?.defaultStyle?.tb).toBe(3);
    const rowData = wb.sheets?.s1?.rowData ?? {};
    expect(Object.keys(rowData)).toHaveLength(35);
    expect(rowData["0"]).toEqual({ ia: 1 });
    expect(rowData["34"]).toEqual({ ia: 1 });
  });

  it("normalize：补默认对齐/换行；已有显式 h 的行保持手动高度，只给没有 h 的行打自动行高", async () => {
    const core = await import("../../core/usheetDoc");
    const wb = {
      sheets: {
        s1: {
          rowCount: 3,
          defaultStyle: { fs: 11 },
          rowData: { "0": { h: 60 }, "1": { ia: 1 } },
        },
      },
      defaultStyle: {},
    } as never;
    core.normalizeUsheetWorkbook(wb);
    const sheet = (wb as { sheets: Record<string, { defaultStyle: Record<string, unknown>; rowData: Record<string, { ia?: number; h?: number }> } > }).sheets.s1;
    const top = (wb as { defaultStyle: Record<string, unknown> }).defaultStyle;
    expect(top.ht).toBe(2);
    expect(top.tb).toBe(3);
    expect(sheet.defaultStyle.ht).toBe(2);
    expect(sheet.defaultStyle.tb).toBe(3);
    expect(sheet.rowData["0"]).toEqual({ h: 60 }); // 手动高度不碰
    expect(sheet.rowData["1"]).toEqual({ ia: 1 });
    expect(sheet.rowData["2"]).toEqual({ ia: 1 });
  });

  it("normalize：自动行高上限 500 行（1 万行的表不塞满 rowData）", async () => {
    const core = await import("../../core/usheetDoc");
    const wb = { sheets: { s1: { rowCount: 10000 } } } as never;
    core.normalizeUsheetWorkbook(wb);
    const sheet = (wb as { sheets: Record<string, { rowData?: Record<string, unknown> }> }).sheets.s1;
    expect(Object.keys(sheet.rowData ?? {})).toHaveLength(500);
  });


  it("261122 真机：旧版遗留的自动高度缓存 ah 必须清掉（只打 ia 不清 ah ⇒ 换行文字仍被压扁）", async () => {
    const core = await import("../../core/usheetDoc");
    const wb = {
      sheets: {
        s1: {
          rowCount: 3,
          defaultStyle: { fs: 11 },
          rowData: { "0": { ah: 34 }, "1": { ah: 50, ia: 1 }, "2": { h: 40, ah: 40 } },
        },
      },
      defaultStyle: {},
    } as never;
    core.normalizeUsheetWorkbook(wb);
    const sheet = (wb as { sheets: Record<string, { rowData: Record<string, Record<string, unknown>> }> }).sheets.s1;
    // 无显式 h：打 ia、删陈旧 ah（让内核按当前列宽重算）
    expect(sheet.rowData["0"]).toEqual({ ia: 1 });
    expect(sheet.rowData["1"]).toEqual({ ia: 1 });
    // 手动高度：原样保留（h + ah 都不动，也不打 ia）
    expect(sheet.rowData["2"]).toEqual({ h: 40, ah: 40 });
  });

  it("normalize 对空表幂等（新建正文 = 规范化后字节，打开不产生假改动）", async () => {
    const core = await import("../../core/usheetDoc");
    const wb = emptyUsheetWorkbook();
    const before = JSON.stringify(wb);
    core.normalizeUsheetWorkbook(wb);
    expect(JSON.stringify(wb)).toBe(before);
  });
});