import { describe, expect, it } from "vitest";
import { emptyUsheetBody, emptyUsheetWorkbook, mapUsheetImageSources, parseUsheetBody, usheetToBody, usheetToSearchText } from "./usheetDoc.js";

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
