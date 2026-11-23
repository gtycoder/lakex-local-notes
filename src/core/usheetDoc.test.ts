import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USHEET_CANONICAL_FONT_FAMILY, emptyUsheetBody, emptyUsheetWorkbook, mapUsheetImageSources, normalizeUsheetWorkbook, parseUsheetBody, usheetAutoHeightOnlyDiff, usheetToBody, usheetToSearchText } from "./usheetDoc.js";

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

  it("默认字号 11（261119）：workbook + 每张工作表的 defaultStyle.fs 一律 11（缺失也补、默认收敛），幂等", () => {
    const wb: any = {
      id: "wb",
      defaultStyle: { fs: 10 },
      sheets: { s1: { id: "s1", cellData: {} }, s2: { id: "s2", defaultStyle: { fs: 14, bl: 1 } } },
    };
    normalizeUsheetWorkbook(wb);
    expect(wb.defaultStyle.fs).toBe(11);
    expect(wb.sheets.s1.defaultStyle.fs).toBe(11);
    expect(wb.sheets.s2.defaultStyle.fs).toBe(11); // 「默认」一律收敛 11（只改默认）
    expect(wb.sheets.s2.defaultStyle.bl).toBe(1); // defaultStyle 其它键不动
    const snapshot = JSON.stringify(wb);
    normalizeUsheetWorkbook(wb);
    expect(JSON.stringify(wb)).toBe(snapshot);
  });

  it("存量显式字号零变化：命名 styles 与单元格的 fs 原样不动（只改默认）", () => {
    const wb: any = {
      id: "wb",
      styles: { big: { fs: 14, ff: "'X'" } },
      sheets: { s1: { id: "s1", cellData: { "0": { "0": { v: "a", s: { fs: 9 } }, "1": { v: "b", si: "big" } } } } },
    };
    normalizeUsheetWorkbook(wb);
    expect(wb.styles.big.fs).toBe(14);
    expect(wb.sheets.s1.cellData["0"]["0"].s.fs).toBe(9);
    expect(wb.sheets.s1.cellData["0"]["1"].si).toBe("big");
    expect(wb.sheets.s1.defaultStyle.fs).toBe(11);
  });

  it("新建空表正文 = normalize 输出逐字节相同（新建/打开零规范化改写）", () => {
    const wb = emptyUsheetWorkbook();
    const before = usheetToBody(wb);
    normalizeUsheetWorkbook(wb);
    expect(usheetToBody(wb)).toBe(before);
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

describe("usheetAutoHeightOnlyDiff（ah 缓存差异不算内容改动，261123）", () => {
  const body = (rows: Record<string, unknown>, cells: Record<string, unknown> = {}) =>
    usheetToBody({ id: "wb", sheets: { s1: { id: "s1", rowCount: 3, cellData: cells as never, rowData: rows } } });

  it("只差 ah（新增 / 改值 / 删除）= 只差派生缓存 ⇒ true", () => {
    expect(usheetAutoHeightOnlyDiff(body({ "0": { ia: 1 } }), body({ "0": { ia: 1, ah: 48 } }))).toBe(true);
    expect(usheetAutoHeightOnlyDiff(body({ "0": { ia: 1, ah: 48 } }), body({ "0": { ia: 1, ah: 66 } }))).toBe(true);
    expect(usheetAutoHeightOnlyDiff(body({ "0": { ia: 1, ah: 48 } }), body({ "0": { ia: 1 } }))).toBe(true);
  });

  it("内核重算新建的行条目 {ah} 与缺省等价（剥空条目）⇒ true", () => {
    expect(usheetAutoHeightOnlyDiff(body({}), body({ "2": { ah: 40 } }))).toBe(true);
  });

  it("内容 / 手动高度的差异是真实差异 ⇒ false", () => {
    expect(usheetAutoHeightOnlyDiff(body({ "0": { ia: 1 } }), body({ "0": { ia: 1 } }, { "0": { "0": { v: "x" } } }))).toBe(false);
    expect(usheetAutoHeightOnlyDiff(body({ "0": { ia: 1, ah: 48 } }), body({ "0": { h: 24, ah: 48 } }))).toBe(false);
  });

  it("解析失败保守 false；空正文 = 空表对空表 true", () => {
    expect(usheetAutoHeightOnlyDiff("{bad", body({}))).toBe(false);
    expect(usheetAutoHeightOnlyDiff("", "")).toBe(true);
    expect(usheetAutoHeightOnlyDiff("", emptyUsheetBody())).toBe(true);
  });
});
