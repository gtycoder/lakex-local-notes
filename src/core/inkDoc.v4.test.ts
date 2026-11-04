/**
 * inkDoc v4：页备注 / 页内贴图 / 页内文字块（261104 二十批）。
 *
 * 一次升版装齐三件**页级**内容，避免反复升版把旧端反复踢进只读。
 * 这里钉住：写 v4、读 1|2|3|4、字段往返、坏元素只丢自己（不连累整页）、备注截断、字段序稳定。
 */
import { describe, expect, it } from "vitest";
import {
  INK_DOC_VERSION,
  INK_PAGE_HEIGHT,
  INK_PAGE_WIDTH,
  MAX_PAGE_IMAGES,
  MAX_PAGE_NOTE_CHARS,
  MAX_PAGE_TEXTS,
  createInkDoc,
  inkToBody,
  parseInkBody,
  type InkDoc,
  type InkPageImage,
} from "./inkDoc";

const assetUrl = (filename: string): string => `http://127.0.0.1:19877/note-1/${filename}`;

function pageWith(extra: Record<string, unknown>): string {
  return JSON.stringify({
    kind: "ink",
    version: 4,
    pages: [{ id: "p1", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", strokes: [], ...extra }],
  });
}

describe("inkDoc v4", () => {
  it("版本常量：写 4、可读 1|2|3|4", () => {
    expect(INK_DOC_VERSION).toBe(4);
    expect(parseInkBody(JSON.stringify({ kind: "ink", version: 5, pages: [] }))).toBeNull();
  });

  it("页备注往返：写入 → 读回一致；空/纯空白 = 不落盘", () => {
    const doc: InkDoc = createInkDoc("p1");
    doc.pages[0].note = "重点：第三章";
    const body = inkToBody(doc);
    expect(body).toContain('"version":4');
    expect(body).toContain('"note":"重点：第三章"');
    expect(parseInkBody(body)!.pages[0].note).toBe("重点：第三章");

    const blank: InkDoc = createInkDoc("p1");
    blank.pages[0].note = "   ";
    expect(inkToBody(blank)).not.toContain("note");
  });

  it("页备注超长：截断到上限（元数据宁截断也不让整页坏）", () => {
    const parsed = parseInkBody(pageWith({ note: "x".repeat(MAX_PAGE_NOTE_CHARS + 50) }));
    expect(parsed).not.toBeNull();
    expect(parsed!.pages[0].note!.length).toBe(MAX_PAGE_NOTE_CHARS);
  });

  it("页内贴图：往返保持；非本地资产/坏数值的单张只丢自己，整页仍在", () => {
    const doc: InkDoc = createInkDoc("p1");
    const image: InkPageImage = { id: "img1", url: assetUrl("1700000000000_abcdef12.png"), x: 100, y: 200, width: 300, height: 200, rotation: 15 };
    doc.pages[0].images = [image];
    const body = inkToBody(doc);
    expect(body).toContain('"images":[{');
    expect(body).toContain(image.url);
    const roundTrip = parseInkBody(body)!.pages[0].images![0];
    expect(roundTrip).toMatchObject({ id: "img1", x: 100, y: 200, width: 300, height: 200, rotation: 15 });

    // 坏元素：外部 http / data URL / 宽高非法 / 坐标非法 ⇒ 只丢这些，好的一张留下
    const parsed = parseInkBody(pageWith({
      images: [
        { id: "ok", url: assetUrl("1700000000000_abcdef12.png"), x: 1, y: 2, width: 10, height: 10 },
        { id: "ext", url: "https://example.com/a.png", x: 1, y: 2, width: 10, height: 10 },
        { id: "data", url: "data:image/png;base64,AAAA", x: 1, y: 2, width: 10, height: 10 },
        { id: "bad-size", url: assetUrl("1700000000000_abcdef12.png"), x: 1, y: 2, width: 0, height: 10 },
        { id: "bad-rot", url: assetUrl("1700000000000_abcdef12.png"), x: 1, y: 2, width: 10, height: 10, rotation: 999 },
      ],
    }));
    expect(parsed!.pages[0].images!.map((item) => item.id)).toEqual(["ok"]);
  });

  it("页内贴图上限：超过 MAX 的部分丢弃（不撑爆正文）", () => {
    const images = Array.from({ length: MAX_PAGE_IMAGES + 5 }, (_, index) => ({
      id: "i" + index,
      url: assetUrl("1700000000000_abcdef12.png"),
      x: 0, y: 0, width: 10, height: 10,
    }));
    const parsed = parseInkBody(pageWith({ images }));
    expect(parsed!.pages[0].images!.length).toBe(MAX_PAGE_IMAGES);
  });

  it("页内文字块：往返保持；坏元素只丢自己；非数组 ⇒ 该页坏", () => {
    const text = { id: "t1", x: 80, y: 120, width: 400, text: "这里是批注", fontSize: 16, color: "#262626", align: "left" as const };
    const doc: InkDoc = createInkDoc("p1");
    doc.pages[0].texts = [text];
    const roundTrip = parseInkBody(inkToBody(doc))!.pages[0].texts![0];
    expect(roundTrip).toMatchObject({ id: "t1", text: "这里是批注", fontSize: 16, align: "left" });

    const parsed = parseInkBody(pageWith({
      texts: [text, { ...text, id: "bad", fontSize: 200 }, { ...text, id: "bad2", text: "  " }],
    }));
    expect(parsed!.pages[0].texts!.map((item) => item.id)).toEqual(["t1"]);

    // 结构字段严格：texts 不是数组 ⇒ 整页坏（单页文档 ⇒ 整篇拒绝）
    expect(parseInkBody(pageWith({ texts: { length: 1 } }))).toBeNull();
    // 但坏集合字段只影响这一页：两页文档里坏的是第二页 ⇒ 第一页仍可用
    const twoPages = JSON.stringify({
      kind: "ink",
      version: 4,
      pages: [
        { id: "p1", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", strokes: [] },
        { id: "p2", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", strokes: [], texts: "nope" },
      ],
    });
    const two = parseInkBody(twoPages);
    expect(two!.pages.length).toBe(1);
    expect(two!.droppedPages).toBe(1);
  });

  it("字段序稳定：note / images / texts 在 backgroundImage 之后、strokes 之前", () => {
    const doc: InkDoc = createInkDoc("p1");
    doc.pages[0].note = "备注";
    doc.pages[0].images = [{ id: "i", url: assetUrl("1700000000000_abcdef12.png"), x: 0, y: 0, width: 10, height: 10 }];
    doc.pages[0].texts = [{ id: "t", x: 0, y: 0, width: 100, text: "字", fontSize: 16, color: "#000" }];
    const body = inkToBody(doc);
    expect(body.indexOf('"note"')).toBeLessThan(body.indexOf('"images"'));
    expect(body.indexOf('"images"')).toBeLessThan(body.indexOf('"texts"'));
    expect(body.indexOf('"texts"')).toBeLessThan(body.indexOf('"strokes"'));
    expect(MAX_PAGE_TEXTS).toBeGreaterThan(0);
  });
});
