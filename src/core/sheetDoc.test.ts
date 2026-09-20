import { describe, expect, it } from "vitest";
import {
  emptySheetBody,
  parseSheetBody,
  sheetImageSrc,
  sheetImages,
  sheetToSearchText,
  sheetsToBody,
  SHEET_DOC_VERSION,
} from "./sheetDoc.js";

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
describe("表格浮动图（sheets[].images）解析", () => {
  const sheet = {
    name: "Sheet1",
    celldata: [{ r: 0, c: 0, v: { v: "A1" } }],
    images: [
      { id: "img_1", src: "data:image/png;base64,AAAA", left: 0, top: 0, width: 80, height: 50, originWidth: 160, originHeight: 100 },
      { id: "img_2", src: "1712345678_ab12cd34.png", left: 180, top: 90, width: 120, height: 80 },
      { id: "img_bad", src: "", left: 0, top: 0, width: 10, height: 10 },
      { id: "img_bad2", src: "data:image/png;base64,BBBB", left: "x", top: 0, width: 10, height: 10 },
      { id: "img_1", src: "data:image/png;base64,CCCC", left: 5, top: 5, width: 10, height: 10 },
      null,
    ],
  };

  it("读出合法浮动图（像素几何原样、按 id 去重、非法项跳过）", () => {
    const images = sheetImages(sheet);
    expect(images.map((image) => image.id)).toEqual(["img_1", "img_2"]);
    expect(images[0]).toEqual({ id: "img_1", src: "data:image/png;base64,AAAA", left: 0, top: 0, width: 80, height: 50 });
    expect(images[1]).toMatchObject({ left: 180, top: 90, width: 120, height: 80 });
  });

  it("没有 images / 非法结构 ⇒ 空数组（不抛错）", () => {
    expect(sheetImages({ name: "S" })).toEqual([]);
    expect(sheetImages(null)).toEqual([]);
    expect(sheetImages({ name: "S", images: "nope" } as never)).toEqual([]);
  });

  it("src 解析：data/http 原样，filename 拼 canonical URL（为桌面 P1 预留）", () => {
    expect(sheetImageSrc("data:image/png;base64,AAAA", "note-1")).toBe("data:image/png;base64,AAAA");
    expect(sheetImageSrc("http://127.0.0.1:19876/note-1/a.png", "note-1")).toBe("http://127.0.0.1:19876/note-1/a.png");
    expect(sheetImageSrc("1712345678_ab12cd34.png", "note-1")).toBe("http://127.0.0.1:19876/note-1/1712345678_ab12cd34.png");
    expect(sheetImageSrc("", "note-1")).toBeNull();
    expect(sheetImageSrc("1712345678_ab12cd34.png", "")).toBeNull();
  });

  it("正文快照里的 images 能被 parseSheetBody 保留（sanitize 不裁字段）", () => {
    const body = JSON.stringify({ kind: "sheet", version: 2, sheets: [sheet] });
    const parsed = parseSheetBody(body);
    expect(sheetImages(parsed?.sheets[0])).toHaveLength(2);
  });
});
