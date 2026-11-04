import { describe, expect, it } from "vitest";
import { localAssetHttpUrl } from "./assetUrl.js";
import { canonicalDocBody } from "./docBaseline.js";
import {
  INK_DOC_VERSION,
  INK_PAGE_HEIGHT,
  INK_PAGE_WIDTH,
  MAX_PAGE_NOTE_CHARS,
  createInkDoc,
  createInkPage,
  emptyInkBody,
  inkStrokePointCount,
  inkToBody,
  inkToSearchText,
  parseInkBody,
} from "./inkDoc.js";

const IMAGE_URL = localAssetHttpUrl("note-1", "1700000000000_abcdef12.png");
const PDF_URL = localAssetHttpUrl("note-1", "1700000000000_abcdef12.pdf");

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

describe("手写板正文（kind=ink v3）", () => {
  it("空白文档是单页 A4，可往返序列化", () => {
    const doc = createInkDoc("page-a");
    expect(doc.pages[0]).toMatchObject({ id: "page-a", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank" });
    expect(parseInkBody(inkToBody(doc))).toEqual(doc);
  });

  it("点编码扁平化：points = [x,y,p,(t)]，坐标/压力定点 0.01", () => {
    const doc = createInkDoc("p1");
    doc.pages[0].strokes.push({
      id: "s1",
      tool: "pen",
      color: "#1f2329",
      width: 2.5,
      points: [{ x: 10.12345, y: 20.98765, pressure: 0.45678, t: 4.4444 }, { x: 30, y: 40, pressure: 0.8 }],
    });
    const body = inkToBody(doc);
    const raw = JSON.parse(body) as { version: number; pages: Array<{ strokes: Array<{ points: unknown[] }> }> };
    expect(raw.version).toBe(INK_DOC_VERSION);
    expect(raw.pages[0].strokes[0].points).toEqual([[10.12, 20.99, 0.46, 4.44], [30, 40, 0.8]]);
    const parsed = parseInkBody(body)!;
    expect(parsed.pages[0].strokes[0].points[0]).toEqual({ x: 10.12, y: 20.99, pressure: 0.46, t: 4.44 });
    expect(inkStrokePointCount(parsed)).toBe(2);
  });

  it("activePageId 不落盘（本机视图，core/inkNav）；读 v1/v2 时仍作一次性回退种子", () => {
    const doc = createInkDoc("p1");
    doc.pages.push(createInkPage("p2", "lined"));
    doc.activePageId = "p2";
    const body = inkToBody(doc);
    expect(body).not.toContain("activePageId");
    expect(parseInkBody(body)!.activePageId).toBe("p1");
    const legacy = JSON.stringify({
      kind: "ink",
      version: 2,
      pages: [
        { id: "p1", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", strokes: [] },
        { id: "p2", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", strokes: [] },
      ],
      activePageId: "p2",
    });
    expect(parseInkBody(legacy)!.activePageId).toBe("p2");
  });

  it("坏正文 / 未知版本 / 全部页都坏 ⇒ 整篇拒绝（不得被当成空文档覆盖）", () => {
    expect(parseInkBody("")).toBeNull();
    expect(parseInkBody("{}")).toBeNull();
    expect(parseInkBody(JSON.stringify({ kind: "ink", version: 2, pages: [] }))).toBeNull();
    expect(parseInkBody(JSON.stringify({ kind: "ink", version: 1, pages: [] }))).toBeNull();
    expect(parseInkBody(JSON.stringify({ kind: "ink", version: 5, pages: [{ id: "p1", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", strokes: [] }] }))).toBeNull();
    const doc = createInkDoc();
    doc.pages[0].strokes.push({ id: "bad", tool: "pen", color: "#000", width: 2, points: [{ x: Number.NaN, y: 1, pressure: 0.5 }] });
    expect(parseInkBody(inkToBody(doc))).toBeNull();
  });

  it("坏页可丢并计数：结构严格，单页坏不拖垮整篇", () => {
    const doc = createInkDoc("p1");
    doc.pages.push(createInkPage("p2"));
    const body = JSON.parse(inkToBody(doc)) as { pages: Array<{ strokes: unknown[] }> };
    body.pages[1].strokes = [{ id: "bad", tool: "pen", color: "#000", width: 2, points: [{ x: Number.NaN }] }];
    const parsed = parseInkBody(JSON.stringify(body))!;
    expect(parsed.pages.map((page) => page.id)).toEqual(["p1"]);
    expect(parsed.droppedPages).toBe(1);

    // 跨页重复笔迹 id：只丢后一页（React key / 整笔橡皮命中仍无歧义）
    const dup = JSON.parse(inkToBody(doc)) as { pages: Array<{ strokes: unknown[] }> };
    const stroke = { id: "dup", tool: "pen", color: "#000", width: 2, points: [{ x: 1, y: 1, pressure: 0.5 }] };
    dup.pages[0].strokes = [stroke];
    dup.pages[1].strokes = [stroke];
    const dupParsed = parseInkBody(JSON.stringify(dup))!;
    expect(dupParsed.pages.map((page) => page.id)).toEqual(["p1"]);
    expect(dupParsed.droppedPages).toBe(1);
  });

  it("手写笔迹不进入全文搜索，但页备注/文字块进（v4）", () => {
    // 没有 note/texts 的手写板：零解析开销，返回空串（笔迹本身不可搜，无 OCR）
    expect(inkToSearchText(emptyInkBody())).toBe("");
    const doc = createInkDoc("p1");
    doc.pages[0].strokes.push({ id: "s1", tool: "pen", color: "#000", width: 2, points: [{ x: 1, y: 1, pressure: 0.5 }] });
    expect(inkToSearchText(inkToBody(doc))).toBe("");
    // 页备注 + 文字块按页序拼成可搜索文本
    doc.pages[0].note = "第三章重点";
    doc.pages[0].texts = [{ id: "t1", x: 0, y: 0, width: 200, text: "这里是批注文字", fontSize: 16, color: "#000" }];
    expect(inkToSearchText(inkToBody(doc))).toBe("第三章重点\n这里是批注文字");
    // 坏正文不抛错
    expect(inkToSearchText('{"kind":"ink","version":4,"pages":[{"note":"x"')).toBe("");
    // 超长截断
    const long = createInkDoc("p1");
    long.pages[0].note = "x".repeat(MAX_PAGE_NOTE_CHARS);
    expect(inkToSearchText(inkToBody(long), 20).length).toBe(20);
  });
});

describe("手写板正文 v3（图片页 / PDF 来源）", () => {
  it("写盘恒为 v3；v1/v2 正文可读，读入后按 v3 规范序列化（不写迁移脚本）", () => {
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
    expect(parseInkBody(JSON.stringify({ kind: "ink", version: 5, pages: [] }))).toBeNull();
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

  it("PDF 页只留页号；sourcePdf 只留 name/pageCount —— v2 的 url 被丢弃、不再进正文", () => {
    const doc = createInkDoc("p1");
    doc.pages[0] = {
      ...doc.pages[0],
      backgroundImage: { url: IMAGE_URL, source: "pdf-page", pdf: { page: 2 } },
    };
    doc.sourcePdf = { name: "论文.pdf", pageCount: 5 };
    const body = inkToBody(doc);
    const parsed = parseInkBody(body)!;
    expect(parsed.pages[0].backgroundImage!.pdf).toEqual({ page: 2 });
    expect(parsed.sourcePdf).toEqual({ name: "论文.pdf", pageCount: 5 });
    expect(body).not.toContain(PDF_URL); // 原 PDF 的资产 URL 不入正文（不强制入库/同步）

    // 读旧 v2：url/pageCount 字段被丢弃，只保留页号
    const legacy = JSON.stringify({
      kind: "ink",
      version: 2,
      pages: [{
        id: "p1", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", strokes: [],
        backgroundImage: { url: IMAGE_URL, source: "pdf-page", pdf: { url: PDF_URL, page: 2, pageCount: 5 } },
      }],
      sourcePdf: { url: PDF_URL, pageCount: 5 },
    });
    const legacyParsed = parseInkBody(legacy)!;
    expect(legacyParsed.pages[0].backgroundImage!.pdf).toEqual({ page: 2 });
    expect(legacyParsed.sourcePdf).toEqual({ pageCount: 5 });
    expect(inkToBody(legacyParsed)).not.toContain(PDF_URL);
  });

  it("非法背景图片只丢该页（单页文档 ⇒ 整篇拒绝）：非本地资产 / 外部 http / 小记空间 / 坏 fit / 越界 opacity / 像素不成对 / PDF 页号非法", () => {
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
    // 像素宽高必须成对：序列化会丢弃不完整对，这里用原始正文验证解析侧丢页
    const rawMismatch = JSON.stringify({
      kind: "ink",
      version: 3,
      pages: [{ id: "p1", width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background: "blank", backgroundImage: { url: IMAGE_URL, pixelWidth: 100 }, strokes: [] }],
    });
    expect(parseInkBody(rawMismatch)).toBeNull();
    expect(parseInkBody(mutate({ ...valid, pixelWidth: 100, pixelHeight: -1 }))).toBeNull();
    expect(parseInkBody(mutate({ ...valid, pdf: { page: 0 } }))).toBeNull();
    expect(parseInkBody(mutate({ ...valid, pdf: { page: -3 } }))).toBeNull();

    // sourcePdf 结构非法 ⇒ 整篇拒绝（结构字段仍严格）；name 只是元数据，非字符串被忽略而不是拒绝
    const badDoc = createInkDoc("p1");
    badDoc.sourcePdf = { pageCount: 0 };
    expect(parseInkBody(inkToBody(badDoc))).toBeNull();
    const badName = createInkDoc("p1");
    badName.sourcePdf = { pageCount: 2, name: 42 as never };
    expect(parseInkBody(inkToBody(badName))!.sourcePdf).toEqual({ pageCount: 2 });
  });

  it("正文里的背景图片 URL 带磁盘名 ⇒ extractAssetRefs 可提取（资产声明/GC 保护）；原 PDF 不再被引用", () => {
    const doc = docWithImagePage();
    doc.sourcePdf = { name: "扫描件.pdf", pageCount: 5 };
    const body = inkToBody(doc);
    const filename = "1700000000000_abcdef12.png";
    expect(body).toContain(filename);
    expect(new Set(body.match(/\d{13}_[0-9a-f]{8}\.[a-z0-9]{1,10}/g))).toEqual(new Set([filename]));
  });
});

/** 只读地读回 version 字段（避免 JSON.parse 后类型误会）。 */
function insideVersion(body: string): number {
  return (JSON.parse(body) as { version: number }).version;
}