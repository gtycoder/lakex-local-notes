import { describe, expect, it } from "vitest";
import { emptyUsheetBody, emptyUsheetWorkbook, mapUsheetImageSources, normalizeFontFamily, normalizeUsheetWorkbook, parseUsheetBody, usheetToBody, usheetToSearchText } from "./usheetDoc.js";

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

describe("正文规范化（打开表格不再误标脏 / 触发同步）", () => {
  it("字族引号统一：单引号族名 → 双引号，且幂等", () => {
    expect(normalizeFontFamily("'MiSans', -apple-system, \"Segoe UI\"")).toBe("\"MiSans\", -apple-system, \"Segoe UI\"");
    const once = normalizeFontFamily("'A', 'B'");
    expect(normalizeFontFamily(once)).toBe(once);
  });

  it("未初始化的 plugin resource（data=\"\"）归一成 \"{}\"，字族同时归一", () => {
    const wb: any = {
      id: "wb",
      defaultStyle: { ff: "'MiSans', sans-serif" },
      styles: { s1: { ff: "'JetBrains Mono', monospace" } },
      resources: [
        { name: "SHEET_NOTE_PLUGIN", data: "{}" },
        { name: "SHEET_RANGE_PROTECTION_PLUGIN", data: "" },
      ],
    };
    normalizeUsheetWorkbook(wb);
    expect(wb.defaultStyle.ff).toBe("\"MiSans\", sans-serif");
    expect(wb.styles.s1.ff).toBe("\"JetBrains Mono\", monospace");
    expect(wb.resources[1].data).toBe("{}");
    // 幂等：再规范化一次不再变化
    const snapshot = JSON.stringify(wb);
    normalizeUsheetWorkbook(wb);
    expect(JSON.stringify(wb)).toBe(snapshot);
  });

  it("真实差异（单元格值）不会被规范化吞掉", () => {
    const a: any = { id: "wb", sheets: { s1: { id: "s1", cellData: { 0: { 0: { v: "1" } } } } } };
    const b: any = { id: "wb", sheets: { s1: { id: "s1", cellData: { 0: { 0: { v: "2" } } } } } };
    normalizeUsheetWorkbook(a);
    normalizeUsheetWorkbook(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
