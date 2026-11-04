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

const pageUrl = (page: number): string => localAssetHttpUrl("note-1", `${1700000000000 + page}_abcdef1${page}.webp`);

function rasterPage(page: number, overrides: Partial<PdfImportRasterPage> = {}): PdfImportRasterPage {
  return { page, width: 793.7, height: 1122.5, pixelWidth: 1600, pixelHeight: 2263, bytes: new Uint8Array([page]), ...overrides };
}

interface DepsOptions {
  pageCount?: number;
  pages?: PdfImportRasterPage[];
  cancelled?: boolean;
  uploadPageUrl?: (input: { bytes: Uint8Array; filename: string }) => string;
  rasterizeError?: Error;
  uploadErrorPage?: number;
}

function makeDeps(options: DepsOptions = {}) {
  const pageCount = options.pageCount ?? 2;
  const pages = options.pages ?? Array.from({ length: Math.min(pageCount, INK_PDF_MAX_PAGES) }, (_, index) => rasterPage(index + 1));
  // P7：栅格化按页交付（onPage），编排层边收边上传 —— 与真实适配器同一口径
  const rasterize = vi.fn(async (_input: { bytes: Uint8Array }, rasterOptions: { maxPages: number; onProgress?: (done: number, total: number) => void; onPage?: (page: PdfImportRasterPage) => void }) => {
    if (options.rasterizeError) throw options.rasterizeError;
    const slice = pages.slice(0, rasterOptions.maxPages);
    for (let index = 0; index < slice.length; index += 1) {
      rasterOptions.onPage?.(slice[index]);
      rasterOptions.onProgress?.(index + 1, slice.length);
    }
    return { pageCount, cancelled: options.cancelled ?? false };
  });
  const uploadPage = vi.fn(async (input: { bytes: Uint8Array; filename: string }) => {
    const page = Number(input.filename.slice("pdf-page-".length).replace(".webp", "")) || 1;
    if (options.uploadErrorPage === page) throw new Error("磁盘写入失败");
    return { url: options.uploadPageUrl ? options.uploadPageUrl(input) : pageUrl(page) };
  });
  const deleteAssets = vi.fn(async (_urls: string[]) => undefined);
  const deps: PdfImportDeps = { rasterize, uploadPage, deleteAssets };
  return { deps, rasterize, uploadPage, deleteAssets };
}

describe("importPdfPages", () => {
  it("逐页成图页：fit=contain、source=pdf-page、pdf 只留页号、记录像素尺寸与页面逻辑尺寸", async () => {
    const { deps, rasterize } = makeDeps();
    const outcome = await importPdfPages(new Uint8Array([1, 2, 3]), deps, { fileName: "论文.pdf" });
    expect(outcome.errors).toEqual([]);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.truncated).toBe(false);
    expect(outcome.pageCount).toBe(2);
    expect(outcome.importedPageCount).toBe(2);
    expect(outcome.sourcePdf).toEqual({ name: "论文.pdf", pageCount: 2 });
    expect(outcome.pages).toHaveLength(2);
    expect(outcome.pages[0]).toMatchObject({ width: 793.7, height: 1122.5, background: "blank" });
    expect(outcome.pages[0].backgroundImage).toEqual({
      url: pageUrl(1),
      fit: "contain",
      source: "pdf-page",
      pdf: { page: 1 },
      pixelWidth: 1600,
      pixelHeight: 2263,
    });
    expect(outcome.pages[1].backgroundImage?.pdf?.page).toBe(2);
    // v3：不先落原 PDF（编排层只收 bytes）；页图文件名带页号（便于排障）
    expect(rasterize).toHaveBeenCalledWith({ bytes: new Uint8Array([1, 2, 3]) }, expect.objectContaining({ maxPages: INK_PDF_MAX_PAGES }));
    expect(deps.uploadPage).toHaveBeenCalledWith(expect.objectContaining({ filename: "pdf-page-1.webp" }));
  });

  it("产品上限（500 页）：pageCount 超上限时只导入前 500 页并标记 truncated", async () => {
    const total = INK_PDF_MAX_PAGES + 120;
    const { deps, rasterize } = makeDeps({ pageCount: total, pages: Array.from({ length: total }, (_, index) => rasterPage(index + 1)) });
    const outcome = await importPdfPages(new Uint8Array([1]), deps);
    expect(rasterize).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ maxPages: INK_PDF_MAX_PAGES }));
    expect(outcome.pageCount).toBe(total);
    expect(outcome.pages).toHaveLength(INK_PDF_MAX_PAGES);
    expect(outcome.importedPageCount).toBe(INK_PDF_MAX_PAGES);
    expect(outcome.truncated).toBe(true);
    expect(outcome.sourcePdf?.pageCount).toBe(total);
  });

  it("进度分母 = 真实总页数（旧实现拿「已入队数」当分母 ⇒ UI 上两个数一起涨，298/298）", async () => {
    const { deps } = makeDeps({ pageCount: 5 });
    const progress: Array<{ done: number; total: number; phase?: string }> = [];
    await importPdfPages(new Uint8Array([1]), deps, { onProgress: (done, total, phase) => progress.push({ done, total, phase }) });
    const upload = progress.filter((item) => item.phase === "upload");
    expect(upload.length).toBeGreaterThan(0);
    // 五页文档：上传阶段每条事件的分母都必须是 5（不是 1、2、3 这些「已入队」值）
    for (const item of upload) expect(item.total).toBe(5);
    expect(upload[upload.length - 1].done).toBe(5);
  });

  it("取消：不产出任何页；本轮已上传的页图被清理（不留无主页图）", async () => {
    const { deps, deleteAssets } = makeDeps({ cancelled: true });
    const outcome = await importPdfPages(new Uint8Array([1]), deps);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.pages).toEqual([]);
    expect(deleteAssets).toHaveBeenCalledTimes(1);
    expect((deleteAssets.mock.calls[0][0] as string[]).length).toBe(2);
  });

  it("上传阶段进度：phase=raster 与 phase=upload 都能报（UI 分文案）", async () => {
    const phases: string[] = [];
    const { deps } = makeDeps();
    const outcome = await importPdfPages(new Uint8Array([1]), deps, { onProgress: (_done, _total, phase) => phases.push(phase) });
    expect(outcome.pages).toHaveLength(2);
    expect(phases).toContain("raster");
    expect(phases).toContain("upload");
  });

  it("栅格化与上传重叠：第一页上传在栅格化完成之前就开始", async () => {
    let releaseRaster: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { releaseRaster = resolve; });
    const order: string[] = [];
    const deps: PdfImportDeps = {
      rasterize: async (_input, rasterOptions) => {
        rasterOptions.onPage?.({ page: 1, width: 794, height: 1123, pixelWidth: 1600, pixelHeight: 2264, bytes: new Uint8Array([1]) });
        order.push("page-enqueued");
        await gate;
        order.push("raster-done");
        return { pageCount: 1, cancelled: false };
      },
      uploadPage: async () => {
        order.push("uploaded");
        releaseRaster?.();
        return { url: pageUrl(1) };
      },
    };
    const outcome = await importPdfPages(new Uint8Array([1]), deps);
    expect(outcome.pages).toHaveLength(1);
    expect(order.indexOf("uploaded")).toBeLessThan(order.indexOf("raster-done"));
  });

  it("栅格化中途失败：本轮已上传资产被删除（按 URL 定向清理）", async () => {
    const deleted: string[] = [];
    const deps: PdfImportDeps = {
      rasterize: async (_input, rasterOptions) => {
        rasterOptions.onPage?.({ page: 1, width: 794, height: 1123, bytes: new Uint8Array([1]) });
        await new Promise((resolve) => setTimeout(resolve, 20)); // 等池里的上传完成
        throw new Error("Invalid PDF structure");
      },
      uploadPage: async () => ({ url: pageUrl(1) }),
      deleteAssets: async (urls) => { deleted.push(...urls); },
    };
    const outcome = await importPdfPages(new Uint8Array([1]), deps);
    expect(outcome.pages).toEqual([]);
    expect(outcome.errors[0]).toContain("无法打开 PDF");
    expect(deleted).toEqual([pageUrl(1)]);
  });

  it("超限/损坏/加密：给可见错误且不夹带页", async () => {
    const { deps } = makeDeps();
    const tooBig = await importPdfPages(new Uint8Array(MAX_ATTACHMENT_BYTES + 1), deps);
    expect(tooBig.pages).toEqual([]);
    expect(tooBig.errors[0]).toContain("100 MiB");

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
    // 部分成功 ⇒ 成功的页会被写进正文，不能删
    expect(deps.deleteAssets).not.toHaveBeenCalled();

    const invalid = await importPdfPages(new Uint8Array([1]), makeDeps({ uploadPageUrl: () => "https://example.com/x.webp" }).deps);
    expect(invalid.pages).toEqual([]);
    expect(invalid.errors.join("")).toContain("不是本地资产地址");
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
      return { ...page, id: `imp-${index + 1}`, backgroundImage: { url: pageUrl(index + 1), fit: "contain" as const, source: "pdf-page" as const, pdf: { page: index + 1 } } };
    });
  }

  it("只有一页空 A4（无笔迹无背景）⇒ 用它替换，不留空白页；patch 记录 before→after", () => {
    const doc = createInkDoc("empty-1");
    expect(shouldReplaceEmptyFirstPage(doc)).toBe(true);
    const pages = importedPages(2);
    const plan = planPdfPageInsert(doc, pages, { name: "论文.pdf", pageCount: 2 })!;
    expect(plan.replacedEmptyPageId).toBe("empty-1");
    expect(plan.next.pages.map((page) => page.id)).toEqual(["imp-1", "imp-2"]);
    expect(plan.next.activePageId).toBe("imp-1");
    expect(plan.next.sourcePdf).toEqual({ name: "论文.pdf", pageCount: 2 });
    expect(plan.patch.pages[0]).toMatchObject({ id: "imp-1" });
    expect(plan.patch.pages[0].before).not.toBeNull();
    expect(plan.patch.order).toEqual({ before: ["empty-1"], after: ["imp-1", "imp-2"] });
    // 新正文可正常序列化（v3：页图字段在正文里）
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
