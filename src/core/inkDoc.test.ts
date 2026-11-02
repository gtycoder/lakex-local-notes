import { describe, expect, it } from "vitest";
import { localAssetHttpUrl } from "./assetUrl.js";
import { canonicalDocBody } from "./docBaseline.js";
import {
  INK_DOC_VERSION,
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

  it("重复笔迹 ID 拒绝导入，避免 React key 与整笔橡皮命中歧义", () => {
    const doc = createInkDoc();
    doc.pages[0].strokes.push(
      { id: "dup", tool: "pen", color: "#000", width: 2, points: [{ x: 1, y: 1, pressure: 0.5 }] },
      { id: "dup", tool: "pen", color: "#000", width: 2, points: [{ x: 2, y: 2, pressure: 0.5 }] },
    );
    expect(parseInkBody(inkToBody(doc))).toBeNull();
  });

  it("手写正文当前不进入全文搜索", () => {
    expect(inkToSearchText(emptyInkBody())).toBe("");
  });
});
const IMAGE_URL = localAssetHttpUrl("note-1", "1700000000000_abcdef12.png");

function docWithImagePage(): ReturnType<typeof createInkDoc> {
  const doc = createInkDoc("p1");
  doc.pages[0] = {
    ...doc.pages[0],
    backgroundImage: {
      url: IMAGE_URL,
      fit: "cover",
      opacity: 0.8,
      pixelWidth: 1200,
      pixelHeight: 1600,
      source: "image",
    },
  };
  return doc;
}

describe("手写板正文 v2（背景图片页）", () => {
  it("写盘恒为 v2；v1 正文可读，读入后按 v2 规范序列化（不写迁移脚本）", () => {
    const v1Body = JSON.stringify({
      kind: "ink",
      version: 1,
      pages: [{ id: "p1", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", strokes: [] }],
      activePageId: "p1",
    });
    const parsed = parseInkBody(v1Body)!;
    expect(parsed.version).toBe(INK_DOC_VERSION);
    expect(insideVersion(inkToBody(parsed))).toBe(INK_DOC_VERSION);
    // 打开=只读判据：v1 磁盘原文的规范形态 = 读入后写回形态（同一份 canonical）
    expect(canonicalDocBody("ink", v1Body)).toBe(inkToBody(parsed));
    // v2 仍可读；未知版本拒绝
    expect(parseInkBody(inkToBody(docWithImagePage()))).not.toBeNull();
    expect(parseInkBody(JSON.stringify({ kind: "ink", version: 3, pages: [] }))).toBeNull();
  });

  it("背景图片字段往返保持；fit 缺省 contain；字段序稳定（backgroundImage 在 strokes 之前）", () => {
    const doc = docWithImagePage();
    const body = inkToBody(doc);
    const parsed = parseInkBody(body)!;
    expect(parsed.pages[0].backgroundImage).toEqual({
      url: IMAGE_URL,
      fit: "cover",
      opacity: 0.8,
      pixelWidth: 1200,
      pixelHeight: 1600,
      source: "image",
    });
    expect(inkToBody(parsed)).toBe(body); // canonical 稳定（打开=只读）
    expect(body.indexOf("backgroundImage")).toBeLessThan(body.indexOf("strokes"));

    const noFit = createInkDoc("p1");
    noFit.pages[0] = { ...noFit.pages[0], backgroundImage: { url: IMAGE_URL } };
    expect(parseInkBody(inkToBody(noFit))!.pages[0].backgroundImage!.fit).toBe("contain");
  });

  it("PDF 页来源与整篇 sourcePdf 往返保持", () => {
    const doc = createInkDoc("p1");
    doc.pages[0] = {
      ...doc.pages[0],
      backgroundImage: { url: IMAGE_URL, source: "pdf-page", pdf: { url: IMAGE_URL, page: 2, pageCount: 5 } },
    };
    doc.sourcePdf = { url: IMAGE_URL, pageCount: 5 };
    const parsed = parseInkBody(inkToBody(doc))!;
    expect(parsed.pages[0].backgroundImage!.pdf).toEqual({ url: IMAGE_URL, page: 2, pageCount: 5 });
    expect(parsed.sourcePdf).toEqual({ url: IMAGE_URL, pageCount: 5 });
  });

  it("非法背景图片整篇拒绝：非本地资产 / 外部 http / 小记空间 / 坏 fit / 越界 opacity / 像素不成对 / PDF 页越界", () => {
    const mutate = (image: Record<string, unknown>): string => {
      const doc = createInkDoc("p1");
      doc.pages[0] = { ...doc.pages[0], backgroundImage: image as never };
      return inkToBody(doc);
    };
    const valid = { url: IMAGE_URL };
    expect(parseInkBody(mutate(valid))).not.toBeNull();
    expect(parseInkBody(mutate({ url: "data:image/png;base64,AAAA" }))).toBeNull();
    expect(parseInkBody(mutate({ url: "https://example.com/a.png" }))).toBeNull();
    expect(parseInkBody(mutate({ url: localAssetHttpUrl("n1", "1700000000000_abcdef12.png", { space: "quick-notes" }) }))).toBeNull();
    expect(parseInkBody(mutate({ ...valid, fit: "stretch2" }))).toBeNull();
    expect(parseInkBody(mutate({ ...valid, opacity: 1.2 }))).toBeNull();
    expect(parseInkBody(mutate({ ...valid, opacity: Number.NaN }))).toBeNull();
    // 像素宽高必须成对：序列化会丢弃不完整对，这里用原始正文验证解析侧拒绝
    const rawMismatch = JSON.stringify({
      kind: "ink",
      version: 2,
      pages: [{ id: "p1", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", backgroundImage: { url: IMAGE_URL, pixelWidth: 100 }, strokes: [] }],
      activePageId: "p1",
    });
    expect(parseInkBody(rawMismatch)).toBeNull();
    expect(parseInkBody(mutate({ ...valid, pixelWidth: 100, pixelHeight: -1 }))).toBeNull();
    expect(parseInkBody(mutate({ ...valid, pdf: { url: IMAGE_URL, page: 6, pageCount: 5 } }))).toBeNull();
    const badDoc = createInkDoc("p1");
    badDoc.sourcePdf = { url: "https://example.com/a.png", pageCount: 2 };
    expect(parseInkBody(inkToBody(badDoc))).toBeNull();
  });

  it("正文里的背景图片 URL 带磁盘名 ⇒ extractAssetRefs 可提取（资产声明/GC 保护）", () => {
    const body = inkToBody(docWithImagePage());
    const filename = "1700000000000_abcdef12.png";
    expect(body).toContain(filename);
    expect(new Set(body.match(/\d{13}_[0-9a-f]{8}\.[a-z0-9]{1,10}/g))).toEqual(new Set([filename]));
  });
});

/** 只读地读回 version 字段（避免 JSON.parse 后类型误会）。 */
function insideVersion(body: string): number {
  return (JSON.parse(body) as { version: number }).version;
}