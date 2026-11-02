/**
 * PDF 导入编排（pdfImport.ts）纯逻辑测试：
 * 页映射 / 尺寸 / 300 截断 / 空白首页替换 / sourcePdf / 取消 / 加密与上传错误。
 * 桌面 unpdf 栅格化不在 node 里跑（浏览器 canvas），这里用注入的假 rasterize 钉编排语义。
 */
import { describe, expect, it, vi } from "vitest";
import { localAssetHttpUrl } from "../../core/assetUrl";
import { MAX_ATTACHMENT_BYTES } from "../../core/storeLimits";
import { createInkDoc, inkToBody, type InkDoc, type InkPage } from "../../core/inkDoc";
import {
  INK_PDF_MAX_PAGES,
  importPdfPages,
  pickPdfFile,
  planPdfPageInsert,
  pdfRasterErrorMessage,
  shouldReplaceEmptyFirstPage,
  type PdfImportDeps,
  type PdfImportRasterPage,
} from "./pdfImport";

const PDF_URL = localAssetHttpUrl("note-1", "1700000000000_abcdef12.pdf");
const pageUrl = (page: number): string => localAssetHttpUrl("note-1", `${1700000000000 + page}_abcdef1${page}.webp`);

function rasterPage(page: number, overrides: Partial<PdfImportRasterPage> = {}): PdfImportRasterPage {
  return { page, width: 793.7, height: 1122.5, pixelWidth: 1600, pixelHeight: 2263, bytes: new Uint8Array([page]), ...overrides };
}

interface DepsOptions {
  pageCount?: number;
  pages?: PdfImportRasterPage[];
  cancelled?: boolean;
  savePdfUrl?: string;
  uploadPageUrl?: (input: { bytes: Uint8Array; filename: string }) => string;
  rasterizeError?: Error;
  uploadErrorPage?: number;
}

function makeDeps(options: DepsOptions = {}) {
  const pageCount = options.pageCount ?? 2;
  const pages = options.pages ?? Array.from({ length: Math.min(pageCount, 300) }, (_, index) => rasterPage(index + 1));
  const savePdf = vi.fn(async () => ({ url: options.savePdfUrl ?? PDF_URL }));
  const rasterize = vi.fn(async (_input: { bytes: Uint8Array; pdfUrl: string }, rasterOptions: { maxPages: number; onProgress?: (done: number, total: number) => void }) => {
    if (options.rasterizeError) throw options.rasterizeError;
    rasterOptions.onProgress?.(1, Math.min(pageCount, rasterOptions.maxPages));
    return { pageCount, pages: pages.slice(0, rasterOptions.maxPages), cancelled: options.cancelled ?? false };
  });
  const uploadPage = vi.fn(async (input: { bytes: Uint8Array; filename: string }) => {
    const page = Number(input.filename.slice("pdf-page-".length).replace(".webp", "")) || 1;
    if (options.uploadErrorPage === page) throw new Error("磁盘写入失败");
    return { url: options.uploadPageUrl ? options.uploadPageUrl(input) : pageUrl(page) };
  });
  const deps: PdfImportDeps = { savePdf, rasterize, uploadPage };
  return { deps, savePdf, rasterize, uploadPage };
}

describe("importPdfPages", () => {
  it("逐页成图页：fit=contain、source=pdf-page、pdf 引用 page/pageCount、记录像素尺寸与页面逻辑尺寸", async () => {
    const { deps, rasterize } = makeDeps();
    const outcome = await importPdfPages(new Uint8Array([1, 2, 3]), deps, { fileName: "论文.pdf" });
    expect(outcome.errors).toEqual([]);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.truncated).toBe(false);
    expect(outcome.pageCount).toBe(2);
    expect(outcome.importedPageCount).toBe(2);
    expect(outcome.sourcePdf).toEqual({ url: PDF_URL, pageCount: 2 });
    expect(outcome.pages).toHaveLength(2);
    expect(outcome.pages[0]).toMatchObject({ width: 793.7, height: 1122.5, background: "blank" });
    expect(outcome.pages[0].backgroundImage).toEqual({
      url: pageUrl(1),
      fit: "contain",
      source: "pdf-page",
      pdf: { url: PDF_URL, page: 1, pageCount: 2 },
      pixelWidth: 1600,
      pixelHeight: 2263,
    });
    expect(outcome.pages[1].backgroundImage?.pdf?.page).toBe(2);
    // 原 PDF 先落盘、再栅格化；页图文件名带页号（便于排障）
    expect(rasterize).toHaveBeenCalledWith({ bytes: new Uint8Array([1, 2, 3]), pdfUrl: PDF_URL }, expect.objectContaining({ maxPages: INK_PDF_MAX_PAGES }));
    expect(deps.savePdf).toHaveBeenCalledWith({ bytes: new Uint8Array([1, 2, 3]), filename: "论文.pdf" });
    expect(deps.uploadPage).toHaveBeenCalledWith(expect.objectContaining({ filename: "pdf-page-1.webp" }));
  });

  it("300 页产品上限：pageCount>300 时只导入前 300 页并标记 truncated", async () => {
    const { deps, rasterize } = makeDeps({ pageCount: 500, pages: Array.from({ length: 500 }, (_, index) => rasterPage(index + 1)) });
    const outcome = await importPdfPages(new Uint8Array([1]), deps);
    expect(rasterize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxPages: INK_PDF_MAX_PAGES }));
    expect(outcome.pageCount).toBe(500);
    expect(outcome.pages).toHaveLength(300);
    expect(outcome.importedPageCount).toBe(300);
    expect(outcome.truncated).toBe(true);
    expect(outcome.sourcePdf?.pageCount).toBe(500);
  });

  it("取消：不产出任何页、不再上传页图", async () => {
    const { deps, uploadPage } = makeDeps({ cancelled: true });
    const outcome = await importPdfPages(new Uint8Array([1]), deps);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.pages).toEqual([]);
    expect(uploadPage).not.toHaveBeenCalled();
  });

  it("超限/损坏/加密：给可见错误且不夹带页", async () => {
    const { deps } = makeDeps();
    const tooBig = await importPdfPages(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), deps);
    expect(tooBig.pages).toEqual([]);
    expect(tooBig.errors[0]).toContain("100 MiB");
    expect(deps.savePdf).not.toHaveBeenCalled();

    const encrypted = await importPdfPages(new Uint8Array([1]), makeDeps({ rasterizeError: new Error("PasswordException: password required") }).deps);
    expect(encrypted.errors[0]).toBe("PDF 已加密，暂不支持导入受密码保护的 PDF");
    const broken = await importPdfPages(new Uint8Array([1]), makeDeps({ rasterizeError: new Error("Invalid PDF structure") }).deps);
    expect(broken.errors[0]).toContain("无法打开 PDF");
  });

  it("单页上传失败不拖垮其它页（逐页容错）；上传结果非法则拒绝写正文", async () => {
    const { deps } = makeDeps({ uploadErrorPage: 2 });
    const partial = await importPdfPages(new Uint8Array([1]), deps);
    expect(partial.pages).toHaveLength(1);
    expect(partial.errors[0]).toContain("第 2 页");
    expect(partial.sourcePdf).toBeDefined();

    const invalid = await importPdfPages(new Uint8Array([1]), makeDeps({ uploadPageUrl: () => "https://example.com/x.webp" }).deps);
    expect(invalid.pages).toEqual([]);
    expect(invalid.errors.join("")).toContain("不是本地资产地址");

    const badPdf = await importPdfPages(new Uint8Array([1]), makeDeps({ savePdfUrl: "https://example.com/a.pdf" }).deps);
    expect(badPdf.errors[0]).toContain("不是本地资产地址");
  });

  it("pdfRasterErrorMessage：加密/损坏分流文案", () => {
    expect(pdfRasterErrorMessage(new Error("encrypted file"))).toContain("已加密");
    expect(pdfRasterErrorMessage(new Error("bad xref"))).toContain("文件损坏");
  });
});

describe("planPdfPageInsert（合入正文 + 替换空白首页）", () => {
  function importedPages(count = 2): InkPage[] {
    return Array.from({ length: count }, (_, index) => {
      const page = createInkDoc(`p${index}`).pages[0];
      return { ...page, id: `imp-${index + 1}`, backgroundImage: { url: pageUrl(index + 1), fit: "contain" as const, source: "pdf-page" as const, pdf: { url: PDF_URL, page: index + 1, pageCount: count } } };
    });
  }

  it("只有一页空 A4（无笔迹无背景）⇒ 用它替换，不留空白页；patch 记录 before→after", () => {
    const doc = createInkDoc("empty-1");
    expect(shouldReplaceEmptyFirstPage(doc)).toBe(true);
    const pages = importedPages(2);
    const plan = planPdfPageInsert(doc, pages, { url: PDF_URL, pageCount: 2 })!;
    expect(plan.replacedEmptyPageId).toBe("empty-1");
    expect(plan.next.pages.map((page) => page.id)).toEqual(["imp-1", "imp-2"]);
    expect(plan.next.activePageId).toBe("imp-1");
    expect(plan.next.sourcePdf).toEqual({ url: PDF_URL, pageCount: 2 });
    expect(plan.patch.pages[0]).toMatchObject({ id: "imp-1" });
    expect(plan.patch.pages[0].before).not.toBeNull();
    expect(plan.patch.order).toEqual({ before: ["empty-1"], after: ["imp-1", "imp-2"] });
    // 新正文可正常序列化（v2 字段进正文）
    expect(inkToBody(plan.next)).toContain("\"source\":\"pdf-page\"");
  });

  it("已有内容（多页或带笔迹/背景图）⇒ 追加，不动原页", () => {
    const doc = createInkDoc("p1");
    doc.pages.push({ ...doc.pages[0], id: "p2" });
    const pages = importedPages(1);
    const plan = planPdfPageInsert(doc, pages)!;
    expect(plan.replacedEmptyPageId).toBeNull();
    expect(plan.next.pages.map((page) => page.id)).toEqual(["p1", "p2", "imp-1"]);
    expect(plan.patch.pages.map((delta) => delta.id)).toEqual(["imp-1"]);

    const single: InkDoc = createInkDoc("p1");
    single.pages[0] = { ...single.pages[0], strokes: [{ id: "s1", tool: "pen", color: "#000", width: 2, points: [{ x: 1, y: 1, pressure: 0.5 }] }] };
    expect(shouldReplaceEmptyFirstPage(single)).toBe(false);
  });

  it("没有导入页 ⇒ null（不产生空提交）", () => {
    expect(planPdfPageInsert(createInkDoc("p1"), [])).toBeNull();
  });
});

describe("pickPdfFile（静态契约）", () => {
  it("是带 accept=application/pdf 的单文件选择器（取消返回 null）", () => {
    expect(typeof pickPdfFile).toBe("function");
    const source = pickPdfFile.toString();
    expect(source).toContain("application/pdf");
    expect(source).toContain("cancel");
  });
});
