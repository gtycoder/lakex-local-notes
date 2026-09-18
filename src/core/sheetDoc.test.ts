import { describe, expect, it } from "vitest";
import { emptySheetBody, parseSheetBody, sheetToSearchText, sheetsToBody, SHEET_DOC_VERSION } from "./sheetDoc.js";

describe("sheetDoc v2（FortuneSheet 正文格式）", () => {
  it("emptySheetBody 可被 parse 往返", () => {
    const doc = parseSheetBody(emptySheetBody());
    expect(doc).not.toBeNull();
    expect(doc?.version).toBe(SHEET_DOC_VERSION);
    expect(doc?.sheets).toHaveLength(1);
  });

  it("v1（CE 快照）/ 非法 JSON / 版本不符 / 空 sheets 一律返回 null（不写兼容）", () => {
    expect(parseSheetBody(JSON.stringify({ kind: "sheet", version: 1, worksheets: [] }))).toBeNull();
    expect(parseSheetBody("{bad json")).toBeNull();
    expect(parseSheetBody("")).toBeNull();
    expect(parseSheetBody(JSON.stringify({ kind: "sheet", version: 2, sheets: [] }))).toBeNull();
  });

  it("sheetToSearchText 按行列拼 celldata 的显示值/原值", () => {
    const body = JSON.stringify({
      kind: "sheet",
      version: SHEET_DOC_VERSION,
      sheets: [
        { name: "Sheet1", celldata: [
          { r: 0, c: 0, v: { v: "hello", m: "hello" } },
          { r: 0, c: 1, v: { v: 2, m: "2" } },
          { r: 1, c: 0, v: { v: "line1\nline2", m: "line1\nline2" } },
        ] },
      ],
    });
    const text = sheetToSearchText(body);
    expect(text).toContain("hello");
    expect(text).toContain("2");
    expect(text).toContain("line1");
  });

  it("sheetsToBody 剔除运行时字段并把 dense data 规范成 sparse celldata", () => {
    const body = sheetsToBody([
      {
        name: "Sheet1",
        config: { rowlen: { "0": 30 } },
        data: [[null, { v: "x", m: "x" }], [null, null]],
        luckysheet_select_save: [{ row: [0], column: [1] }],
      } as never,
    ]);
    const doc = parseSheetBody(body);
    expect(doc).not.toBeNull();
    const sheet = doc?.sheets[0] as Record<string, unknown>;
    expect(sheet.luckysheet_select_save).toBeUndefined();
    expect(sheet.data).toBeUndefined();
    expect(sheet.celldata).toEqual([{ r: 0, c: 1, v: { v: "x", m: "x" } }]);
    expect(sheet.config).toEqual({ rowlen: { "0": 30 } });
  });
});
