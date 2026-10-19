import { describe, expect, it } from "vitest";
import {
  INK_PAGE_HEIGHT,
  INK_PAGE_WIDTH,
  createInkDoc,
  createInkPage,
  emptyInkBody,
  inkStrokePointCount,
  inkToBody,
  inkToSearchText,
  parseInkBody,
} from "./inkDoc.js";

describe("手写板正文（kind=ink）", () => {
  it("空白文档是单页 A4，可往返序列化", () => {
    const doc = createInkDoc("page-a");
    expect(doc.pages[0]).toMatchObject({ id: "page-a", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank" });
    expect(parseInkBody(inkToBody(doc))).toEqual(doc);
  });

  it("笔迹、页面和多页 activePageId 往返保持", () => {
    const doc = createInkDoc("p1");
    doc.pages.push(createInkPage("p2", "lined"));
    doc.pages[0].strokes.push({
      id: "s1",
      tool: "pen",
      color: "#1f2329",
      width: 2.5,
      points: [{ x: 10, y: 20, pressure: 0.4, t: 4 }, { x: 30, y: 40, pressure: 0.8 }],
    });
    doc.activePageId = "p2";
    const parsed = parseInkBody(inkToBody(doc));
    expect(parsed).toEqual(doc);
    expect(inkStrokePointCount(parsed!)).toBe(2);
  });

  it("坏正文、错误版本、非法笔迹一律拒绝（不得被当成空文档覆盖）", () => {
    expect(parseInkBody("")).toBeNull();
    expect(parseInkBody("{}")).toBeNull();
    expect(parseInkBody(JSON.stringify({ kind: "ink", version: 2, pages: [] }))).toBeNull();
    expect(parseInkBody(JSON.stringify({ kind: "ink", version: 1, pages: [] }))).toBeNull();
    const doc = createInkDoc();
    doc.pages[0].strokes.push({ id: "bad", tool: "pen", color: "#000", width: 2, points: [{ x: Number.NaN, y: 1, pressure: 0.5 }] });
    expect(parseInkBody(inkToBody(doc))).toBeNull();
  });

  it("手写正文当前不进入全文搜索", () => {
    expect(inkToSearchText(emptyInkBody())).toBe("");
  });
});
