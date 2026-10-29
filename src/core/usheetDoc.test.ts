import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USHEET_CANONICAL_FONT_FAMILY, emptyUsheetBody, emptyUsheetWorkbook, mapUsheetImageSources, normalizeUsheetWorkbook, parseUsheetBody, usheetToBody, usheetToSearchText } from "./usheetDoc.js";

/** 单元格图：cellData[r][c].p.drawings[d] 带 source。 */
function cellImageWorkbook() {
  return {
    id: "wb", name: "t", sheetOrder: ["s1"],
    sheets: {
      s1: {
        id: "s1", name: "Sheet1",
        cellData: { 1: { 4: { p: { drawings: { d1: { drawingId: "d1", drawingType: 0, imageSourceType: "URL", source: "1712345678901_ab12cd34.png" } }, drawingsOrder: ["d1"] } } } },
      },
    },
  };
}

/** 浮动图：进 workbook.resources 的 JSON 字符串（SHEET_DRAWING_PLUGIN.data）。 */
function floatingImageWorkbook() {
  return {
    id: "wb", name: "t", sheetOrder: ["s1"],
    sheets: { s1: { id: "s1", name: "Sheet1", cellData: {} } },
    resources: [{ name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ d2: { drawingId: "d2", drawingType: 0, imageSourceType: "URL", source: "1712345678902_deadbeef.png" } }) }],
  };
}

describe("usheetDoc", () => {
  it("empty → parse → serialize 往返（kind/version 正确）", () => {
    const doc = parseUsheetBody(emptyUsheetBody());
    expect(doc?.kind).toBe("usheet");
    expect(doc?.version).toBe(1);
    expect(Object.keys(doc?.workbook.sheets ?? {})).toEqual(["s1"]);
    expect(parseUsheetBody(usheetToBody(emptyUsheetWorkbook()))?.version).toBe(1);
  });

  it("非法/旧版本/异 kind 返回 null（不写兼容）", () => {
    expect(parseUsheetBody("")).toBeNull();
    expect(parseUsheetBody("not json")).toBeNull();
    expect(parseUsheetBody(JSON.stringify({ kind: "usheet", version: 2, workbook: {} }))).toBeNull();
    expect(parseUsheetBody(JSON.stringify({ kind: "bitable", version: 1, workbook: {} }))).toBeNull();
    expect(parseUsheetBody(JSON.stringify({ kind: "usheet", version: 1, workbook: null }))).toBeNull();
  });

  it("搜索文本抽取单元格 v/m", () => {
    const body = usheetToBody({ id: "wb", sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "S", cellData: { 0: { 0: { v: "hello" }, 1: { m: 42 } } } } } });
    const text = usheetToSearchText(body);
    expect(text).toContain("hello");
    expect(text).toContain("42");
  });

  it("遍历单元格图 source 并映射（filename → URL）", () => {
    const wb = cellImageWorkbook();
    const changed = mapUsheetImageSources(wb, (src) => "http://127.0.0.1:19876/n1/" + src);
    expect(changed).toBe(true);
    const drawing = (wb.sheets.s1.cellData as any)[1][4].p.drawings.d1;
    expect(drawing.source).toBe("http://127.0.0.1:19876/n1/1712345678901_ab12cd34.png");
  });

  it("遍历 resources 里的浮动图 JSON 并写回（且无变化时不重排）", () => {
    const wb = floatingImageWorkbook();
    const before = wb.resources[0].data;
    expect(mapUsheetImageSources(wb, (src) => src)).toBe(false); // 恒等映射 → 不改、不重排
    expect(wb.resources[0].data).toBe(before);
    const changed = mapUsheetImageSources(wb, (src) => "http://127.0.0.1:19876/n1/" + src);
    expect(changed).toBe(true);
    const parsed = JSON.parse(wb.resources[0].data);
    expect(parsed.d2.source).toBe("http://127.0.0.1:19876/n1/1712345678902_deadbeef.png");
  });
});

describe("正文规范化（打开表格不再误标脏 / 触发同步；CORE-04 字体族 canonical）", () => {
  it("canonical 字体族与 base.css 的 --lake-font-family 同值（只差引号）", () => {
    const css = readFileSync(new URL("../styles/themes/base.css", import.meta.url), "utf8");
    const value = /--lake-font-family:\s*([^;]+);/.exec(css)?.[1].trim();
    expect(value).toBeTruthy();
    expect(value!.replace(/'/g, '"')).toBe(USHEET_CANONICAL_FONT_FAMILY);
  });

  it("defaultStyle 与所有命名 styles 的 ff 一律收敛成 canonical，未初始化 resource 归一", () => {
    const wb: any = {
      id: "wb",
      defaultStyle: { ff: "'MiSans', sans-serif", bl: 1 },
      styles: { s1: { ff: "'JetBrains Mono', monospace" }, s2: { ff: "\"Arial\", sans-serif" } },
      resources: [
        { name: "SHEET_NOTE_PLUGIN", data: "{}" },
        { name: "SHEET_RANGE_PROTECTION_PLUGIN", data: "" },
      ],
    };
    normalizeUsheetWorkbook(wb);
    expect(wb.defaultStyle.ff).toBe(USHEET_CANONICAL_FONT_FAMILY);
    expect(wb.defaultStyle.bl).toBe(1);
    expect(wb.styles.s1.ff).toBe(USHEET_CANONICAL_FONT_FAMILY);
    expect(wb.styles.s2.ff).toBe(USHEET_CANONICAL_FONT_FAMILY);
    expect(wb.resources[1].data).toBe("{}");
    // 幂等：再规范化一次不再变化
    const snapshot = JSON.stringify(wb);
    normalizeUsheetWorkbook(wb);
    expect(JSON.stringify(wb)).toBe(snapshot);
  });

  it("缺失也补：没有 defaultStyle / 命名样式缺 ff 时补写 canonical，且幂等", () => {
    const wb: any = { id: "wb", styles: { s1: { bl: 1 } } };
    normalizeUsheetWorkbook(wb);
    expect(wb.defaultStyle.ff).toBe(USHEET_CANONICAL_FONT_FAMILY);
    expect(wb.styles.s1.ff).toBe(USHEET_CANONICAL_FONT_FAMILY);
    expect(wb.styles.s1.bl).toBe(1);
    const snapshot = JSON.stringify(wb);
    normalizeUsheetWorkbook(wb);
    expect(JSON.stringify(wb)).toBe(snapshot);
  });

  it("跨端两种输入（dev 单引号 / 打包双引号 + 空 resource）归一后逐字节相同", () => {
    const desktop: any = {
      id: "wb",
      defaultStyle: { ff: "'MiSans', -apple-system, sans-serif" },
      styles: { s1: { ff: "'JetBrains Mono', monospace", bl: 1 } },
      resources: [{ name: "SHEET_NOTE_PLUGIN", data: "" }],
    };
    const mobile: any = {
      id: "wb",
      defaultStyle: { ff: USHEET_CANONICAL_FONT_FAMILY },
      styles: { s1: { ff: USHEET_CANONICAL_FONT_FAMILY, bl: 1 } },
      resources: [{ name: "SHEET_NOTE_PLUGIN", data: "{}" }],
    };
    normalizeUsheetWorkbook(desktop);
    normalizeUsheetWorkbook(mobile);
    expect(usheetToBody(desktop)).toBe(usheetToBody(mobile));
  });

  it("真实差异（单元格值）不会被规范化吞掉", () => {
    const a: any = { id: "wb", sheets: { s1: { id: "s1", cellData: { 0: { 0: { v: "1" } } } } } };
    const b: any = { id: "wb", sheets: { s1: { id: "s1", cellData: { 0: { 0: { v: "2" } } } } } };
    normalizeUsheetWorkbook(a);
    normalizeUsheetWorkbook(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
