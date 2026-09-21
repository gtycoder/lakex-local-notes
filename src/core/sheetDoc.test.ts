import { describe, expect, it } from "vitest";
import {
  emptySheetBody,
  parseSheetBody,
  sheetImageDiskSrc,
  sheetImageSrc,
  sheetImages,
  sheetToSearchText,
  sheetsToBody,
  SHEET_DOC_VERSION,
} from "./sheetDoc.js";

describe("sheetDoc v2（FortuneSheet 正文格式 + 图片资产化）", () => {
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
    expect(parseSheetBody(JSON.stringify({ kind: "sheet", version: SHEET_DOC_VERSION, sheets: [] }))).toBeNull();
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

  it("单元格图片（P2）：带合法 cell 锚点的读出锚点；非法锚点当浮动图", () => {
    const withAnchors = {
      name: "Sheet1",
      images: [
        { id: "cellimg_1", src: "a.png", left: 0, top: 0, width: 74, height: 20, cell: { r: 1, c: 2 } },
        { id: "cellimg_bad", src: "b.png", left: 0, top: 0, width: 74, height: 20, cell: { r: -1, c: 0 } },
        { id: "cellimg_bad2", src: "c.png", left: 0, top: 0, width: 74, height: 20, cell: "A1" },
      ],
    };
    const images = sheetImages(withAnchors as never);
    expect(images[0].cell).toEqual({ r: 1, c: 2 });
    expect(images[1].cell).toBeUndefined();
    expect(images[2].cell).toBeUndefined();
  });

  it("没有 images / 非法结构 ⇒ 空数组（不抛错）", () => {
    expect(sheetImages({ name: "S" })).toEqual([]);
    expect(sheetImages(null)).toEqual([]);
    expect(sheetImages({ name: "S", images: "nope" } as never)).toEqual([]);
  });

  it("src 解析：data/http 原样，filename 拼 canonical URL（端口随实例）", () => {
    expect(sheetImageSrc("data:image/png;base64,AAAA", "note-1")).toBe("data:image/png;base64,AAAA");
    expect(sheetImageSrc("http://127.0.0.1:19876/note-1/a.png", "note-1")).toBe("http://127.0.0.1:19876/note-1/a.png");
    expect(sheetImageSrc("1712345678_ab12cd34.png", "note-1")).toBe("http://127.0.0.1:19876/note-1/1712345678_ab12cd34.png");
    // 多端同机双开（B 端 LAKE_ASSET_PORT=19877）：URL 必须带本实例端口
    expect(sheetImageSrc("1712345678_ab12cd34.png", "note-1", 19877)).toBe("http://127.0.0.1:19877/note-1/1712345678_ab12cd34.png");
    expect(sheetImageSrc("", "note-1")).toBeNull();
    expect(sheetImageSrc("1712345678_ab12cd34.png", "")).toBeNull();
  });

  it("缩略图档位只落在 query 上：落盘仍是 filename，正文里永远不出现 ?w=", () => {
    expect(sheetImageSrc("1712345678_ab12cd34.png", "note-1", undefined, 128))
      .toBe("http://127.0.0.1:19876/note-1/1712345678_ab12cd34.png?w=128");
    // 已是 URL（上一轮拼过档位、或被渲染层注入过 token）：原地改写，不重复拼路径，也不冲掉 token
    expect(sheetImageSrc("http://127.0.0.1:19876/note-1/a.png?w=512&token=t", "note-1", undefined, 256))
      .toBe("http://127.0.0.1:19876/note-1/a.png?w=256&token=t");
    // data:/外部 http 没有档位可言（外部图我们无权也无需缩放）
    expect(sheetImageSrc("data:image/png;base64,AAAA", "note-1", undefined, 128)).toBe("data:image/png;base64,AAAA");
    expect(sheetImageSrc("https://example.com/x.png", "note-1", undefined, 128)).toBe("https://example.com/x.png");
    // 落盘只取路径段：档位（和 token 一样）是运行时产物，不进正文
    expect(sheetImageDiskSrc("http://127.0.0.1:19876/note-1/a.png?w=128&token=t")).toBe("a.png");
  });

  it("正文快照里的 images 能被 parseSheetBody 保留（sanitize 不裁字段）", () => {
    const body = JSON.stringify({ kind: "sheet", version: SHEET_DOC_VERSION, sheets: [sheet] });
    const parsed = parseSheetBody(body);
    expect(sheetImages(parsed?.sheets[0])).toHaveLength(2);
  });

  it("落盘口径：资产 URL（含 token）→ filename；几何与其余字段逐字节保留", () => {
    const body = sheetsToBody([
      {
        name: "Sheet1",
        images: [
          { id: "img_1", src: "http://127.0.0.1:19876/note-1/1712345678_ab12cd34.png?token=SECRET", left: 10, top: 20, width: 80, height: 50, originWidth: 160, originHeight: 100 },
          { id: "img_2", src: "1712345678_ab12cd34.png", left: 0, top: 0, width: 10, height: 10 },
          { id: "img_3", src: "https://example.test/remote.png", left: 0, top: 0, width: 10, height: 10 },
        ],
      } as never,
    ]);
    expect(body).not.toContain("base64");
    expect(body).not.toContain("token");
    expect(body).not.toContain("127.0.0.1");
    const images = (parseSheetBody(body)?.sheets[0] as unknown as { images: Array<Record<string, unknown>> }).images;
    expect(images[0]).toEqual({ id: "img_1", src: "1712345678_ab12cd34.png", left: 10, top: 20, width: 80, height: 50, originWidth: 160, originHeight: 100 });
    expect(images[1].src).toBe("1712345678_ab12cd34.png");
    expect(images[2].src).toBe("https://example.test/remote.png"); // 外部图原样（不是本地资产）
  });

  it("落盘口径：内核刚插入的 base64 保持原样（由编辑器负责在保存前提升，不在这里丢图）", () => {
    const body = sheetsToBody([
      { name: "Sheet1", images: [{ id: "img_1", src: "data:image/png;base64,AAAA", left: 0, top: 0, width: 80, height: 50 }] } as never,
    ]);
    const images = (parseSheetBody(body)?.sheets[0] as unknown as { images: Array<{ src: string }> }).images;
    expect(images[0].src).toBe("data:image/png;base64,AAAA");
  });
});
