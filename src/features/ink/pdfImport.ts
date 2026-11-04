/**
 * 手写板「PDF 页」导入编排（纯逻辑，两端复用；宿主注入栅格化/上传能力）。
 *
 * 流程：PDF 字节 → 逐页栅格化（桌面 unpdf / 移动原生 PdfRender）→ 每页图片走同一资产通道
 * → 生成 InkPage[]（背景图页，source=pdf-page + pdf:{page}）+ InkDoc.sourcePdf{name,pageCount}。
 * 打开=只读、资产声明/S3/GC 全部复用图片页管线。
 *
 * v3（261103 P6）：**不再先落原 PDF**（sourcePdf 只留 name/pageCount，原 PDF 不进正文、不进 S3）；
 * 需要磁盘 PDF 的端（移动原生插件）在自己的适配器里暂存与清理，编排层只收 bytes。
 *
 * 边界：本文件不 import unpdf / 任一端的 IPC/bridge —— rasterize/uploadPage 由宿主注入，
 * 因此可在 node 环境用假实现做纯逻辑测试（页映射/截断/替换空首页/取消/错误）。
 */
import { parseLocalAssetUrl } from "../../core/assetUrl.js";
import { MAX_ATTACHMENT_BYTES } from "../../core/storeLimits.js";
import {
  createInkPage,
  type InkBackgroundImage,
  type InkDoc,
  type InkPage,
  type InkSourcePdf,
} from "../../core/inkDoc.js";
import type { InkPatch } from "./history.js";
import { inkOrderDelta, inkPageDelta } from "./history.js";
import { newInkId } from "./ids.js";

/** 产品上限：一份 PDF 最多导入 500 页（core 的 1000 页硬上限不变；一本 300+ 页的书是常态）。 */
export const INK_PDF_MAX_PAGES = 500;
/** 上传池宽度（P7）：栅格化每产出一页就入队上传，与后续页的栅格化重叠；3 路在手机上也不会打爆桥/内存。 */
export const PDF_IMPORT_UPLOAD_CONCURRENCY = 3;

/** 导入阶段：栅格化 / 写资产（UI 的进度文案按阶段区分）。 */
export type PdfImportPhase = "raster" | "upload";

export interface PdfImportRasterPage {
  /** 1-based 页码（PDF 里的真实页号）。 */
  page: number;
  /** 页逻辑尺寸（桌面 = pt×4/3；移动 = 插件返回宽高）。 */
  width: number;
  height: number;
  /** 图片像素尺寸（可选；写进 backgroundImage.pixelWidth/Height）。 */
  pixelWidth?: number;
  pixelHeight?: number;
  /** 该页图片字节（桌面 WebP 直接给）。 */
  bytes?: Uint8Array;
  /** 惰性读字节：移动原生把页图落在 cacheDir，按需读（读取与上传都在池内，不阻塞后续页渲染）。 */
  loadBytes?: () => Promise<Uint8Array>;
}

export interface PdfImportRasterResult {
  pageCount: number;
  cancelled: boolean;
}

export interface PdfImportRasterizeOptions {
  maxPages: number;
  /** 栅格化进度（第 done / total 页）。 */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** 每渲染好一页立刻回调（编排层据此排队上传，实现「边栅格化边上传」）。 */
  onPage?: (page: PdfImportRasterPage) => void;
}

export interface PdfImportDeps {
  /**
   * 逐页栅格化（桌面 unpdf / 移动原生 PdfRender 插件）。
   * v3 起**不再先落原 PDF**（sourcePdf 只留 {name,pageCount}，原 PDF 不进正文/不进 S3）；
   * 需要磁盘 PDF 的端（移动原生插件）在自己的适配器里暂存，编排层不关心。
   */
  rasterize: (input: { bytes: Uint8Array }, options: PdfImportRasterizeOptions) => Promise<PdfImportRasterResult>;
  /** 上传单页图片字节。 */
  uploadPage: (input: { bytes: Uint8Array; filename: string }) => Promise<{ url: string; size?: number }>;
  /**
   * 失败/取消时删除本轮**已上传**的资产（按已知 URL；实现方只删本笔记、且未被正文/历史引用的文件）。
   * 没有它就只能等孤儿扫描兜底（设置页手动清理），会留下几 MB 的无主页图。
   */
  deleteAssets?: (urls: string[]) => Promise<void>;
}

export interface PdfImportOptions {
  fileName?: string;
  /** 产品截断上限（默认 500，硬夹到 1..500）。 */
  maxPages?: number;
  /** 进度：phase = raster（第 n/N 页渲染）/ upload（第 n 页写入资产）。 */
  onProgress?: (done: number, total: number, phase: PdfImportPhase) => void;
  signal?: AbortSignal;
}

export interface PdfImportOutcome {
  pages: InkPage[];
  sourcePdf?: InkSourcePdf;
  /** PDF 真实页数（未截断前的总页数）。 */
  pageCount: number;
  importedPageCount: number;
  /** true = 原 PDF 页数超过上限，只导入了前 maxPages 页。 */
  truncated: boolean;
  cancelled: boolean;
  errors: string[];
  /** 本次实际上传的页图字节总数（= 首次同步要传的资产量；缺省/0 = 未知或没上传）。 */
  uploadedBytes?: number;
}

function isNoteAssetUrl(value: string): boolean {
  const ref = parseLocalAssetUrl(value);
  return ref !== null && ref.space === "note" && !ref.staging;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** 栅格化失败的可见文案：加密/损坏分开说（手机与桌面同一套）。 */
export function pdfRasterErrorMessage(reason: unknown): string {
  const text = errorText(reason);
  if (/password|encrypt/i.test(text)) return "PDF 已加密，暂不支持导入受密码保护的 PDF";
  return "无法打开 PDF（文件损坏或格式不支持）：" + text;
}

function emptyOutcome(errors: string[] = []): PdfImportOutcome {
  return { pages: [], pageCount: 0, importedPageCount: 0, truncated: false, cancelled: false, errors, uploadedBytes: 0 };
}

/**
 * PDF → 图片页（不写正文；调用方拿 pages/sourcePdf 自己提交，见 planPdfPageInsert）。
 *
 * P7 管线：栅格化每产出一页就入队上传（池宽 3 ⇒ 与后续页渲染重叠）；页图按页号归位，
 * 返回前等池排空。失败/取消（栅格化异常、signal abort、一页都没成）时**删掉本轮已上传的资产**，
 * 不让无主页图留在 note-assets 里等人工清孤儿。
 */
export async function importPdfPages(
  bytes: Uint8Array,
  deps: PdfImportDeps,
  options: PdfImportOptions = {},
): Promise<PdfImportOutcome> {
  if (bytes.length === 0) return emptyOutcome(["PDF 为空"]);
  if (bytes.length > MAX_ATTACHMENT_BYTES) return emptyOutcome(["PDF 超过 100 MiB 上限"]);
  const maxPages = Math.min(INK_PDF_MAX_PAGES, Math.max(1, Math.floor(options.maxPages ?? INK_PDF_MAX_PAGES)));

  const errors: string[] = [];
  /** 按页号归位（1-based）；并发上传完成顺序不定，最后按页号排序。 */
  const slots: Array<InkPage | null> = [];
  const seenPages = new Set<number>();
  const uploadedUrls: string[] = [];
  let enqueued = 0;
  let uploaded = 0;
  /** 本次实际上传的页图字节总数（提示「首次同步要传多少」）。 */
  let uploadedBytes = 0;
  let maxPageSeen = 0;
  let aborted = false;
  /** 栅格化报上来的总页数（含被上限截断的部分）⇒ 上传阶段的分母必须是它，不能是「已入队数」。 */
  let expectedTotal = 0;

  const ensureSlot = (page: number): void => {
    while (slots.length < page) slots.push(null);
  };

  // ---- 上传池：与栅格化重叠（池内 n≤3），页字节可能是惰性读取（移动端 cacheDir） ----
  const queue: PdfImportRasterPage[] = [];
  let active = 0;
  let drained: (() => void) | null = null;
  const drainPool = (): Promise<void> => new Promise((resolve) => {
    if (active === 0 && queue.length === 0) resolve();
    else drained = resolve;
  });
  const maybeDrain = (): void => {
    if (active === 0 && queue.length === 0 && drained) {
      const done = drained;
      drained = null;
      done();
    }
  };

  const uploadOne = async (item: PdfImportRasterPage): Promise<void> => {
    try {
      const pageBytes = item.bytes ?? (item.loadBytes ? await item.loadBytes() : null);
      if (!pageBytes) {
        errors.push(`第 ${item.page} 页：页图字节缺失`);
        return;
      }
      const result = await deps.uploadPage({ bytes: pageBytes, filename: `pdf-page-${item.page}.webp` });
      if (!isNoteAssetUrl(result.url)) {
        errors.push(`第 ${item.page} 页：上传结果不是本地资产地址`);
        return;
      }
      uploadedUrls.push(result.url);
      uploaded += 1;
      if (result.size && result.size > 0) uploadedBytes += result.size;
      ensureSlot(item.page);
      const image: InkBackgroundImage = {
        url: result.url,
        fit: "contain",
        source: "pdf-page",
        pdf: { page: item.page },
      };
      if (item.pixelWidth && item.pixelHeight) {
        image.pixelWidth = Math.round(item.pixelWidth);
        image.pixelHeight = Math.round(item.pixelHeight);
      }
      slots[item.page - 1] = {
        ...createInkPage(newInkId("page"), "blank"),
        width: item.width,
        height: item.height,
        backgroundImage: image,
      };
      // 取消后仍在途的上传要跑完（拿到 URL 才能在取消路径删掉它们）
      // 分母必须是「真实要导入的页数」（min(总页数, 上限)）；旧实现拿「已入队数」当分母 ⇒ UI 上两个数一起涨（298/298）。
      const total = expectedTotal > 0 ? Math.min(expectedTotal, maxPages) : Math.max(enqueued, uploaded);
      options.onProgress?.(uploaded, Math.max(total, uploaded), "upload");
    } catch (reason) {
      errors.push(`第 ${item.page} 页：${errorText(reason)}`);
    }
  };

  const pump = (): void => {
    if (!aborted) {
      while (active < PDF_IMPORT_UPLOAD_CONCURRENCY && queue.length > 0) {
        const item = queue.shift()!;
        active += 1;
        void uploadOne(item).finally(() => {
          active -= 1;
          pump();
          maybeDrain();
        });
      }
    }
    maybeDrain();
  };

  const enqueue = (page: PdfImportRasterPage): void => {
    if (aborted) return;
    if (!Number.isInteger(page.page) || page.page <= 0 || page.page > maxPages) return;
    if (seenPages.has(page.page)) return;
    seenPages.add(page.page);
    maxPageSeen = Math.max(maxPageSeen, page.page);
    ensureSlot(page.page);
    enqueued += 1;
    queue.push(page);
    pump();
  };

  const cleanupUploaded = async (): Promise<void> => {
    if (uploadedUrls.length === 0) return;
    if (!deps.deleteAssets) return;
    const urls = uploadedUrls.splice(0, uploadedUrls.length);
    try {
      await deps.deleteAssets(urls);
    } catch { /* 清理失败不掩盖导入结果：孤儿扫描/设置页兜底 */ }
  };

  const onAbort = (): void => {
    aborted = true;
    queue.length = 0;
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  let raster: PdfImportRasterResult;
  try {
    raster = await deps.rasterize(
      { bytes },
      {
        maxPages,
        onProgress: (done, total) => {
          // 记下总页数供上传阶段当分母；移动端原生报的是 PDF 真实页数（可能大于上限），这里统一夹到上限。
          if (total > 0) expectedTotal = Math.max(expectedTotal, Math.floor(total));
          options.onProgress?.(done, total > 0 ? Math.min(total, maxPages) : total, "raster");
        },
        signal: options.signal,
        onPage: enqueue,
      },
    );
  } catch (reason) {
    options.signal?.removeEventListener("abort", onAbort);
    aborted = true;
    queue.length = 0;
    await drainPool();
    await cleanupUploaded();
    return emptyOutcome([pdfRasterErrorMessage(reason)]);
  }
  options.signal?.removeEventListener("abort", onAbort);

  const cancelled = raster.cancelled || aborted || Boolean(options.signal?.aborted);
  if (cancelled) aborted = true;
  await drainPool();

  const pageCount = Math.max(raster.pageCount || 0, maxPageSeen);
  const pages = slots.filter((page): page is InkPage => page !== null).slice(0, maxPages);
  const truncated = pageCount > maxPages;
  if (cancelled || pages.length === 0) {
    await cleanupUploaded();
    return { pages: [], pageCount, importedPageCount: 0, truncated, cancelled, errors, uploadedBytes };
  }
  return {
    pages,
    // v3：只留文件名与页数（原 PDF 不强制入库；不写 url 就不会被资产声明/同步带上，也不拦 GC）。
    sourcePdf: { ...(options.fileName ? { name: options.fileName } : {}), pageCount },
    pageCount,
    importedPageCount: pages.length,
    truncated,
    cancelled: false,
    errors,
    uploadedBytes,
  };
}

/** 当前文档是不是「只有一页空 A4」（无笔迹、无背景图）——PDF/图片导入时用它替换掉空白首页。 */
export function shouldReplaceEmptyFirstPage(doc: InkDoc): boolean {
  if (doc.pages.length !== 1) return false;
  const page = doc.pages[0];
  return page.strokes.length === 0 && !page.backgroundImage;
}

export interface PdfInsertPlan {
  next: InkDoc;
  patch: InkPatch;
  /** 被替换掉的空白首页 id（null = 追加）。 */
  replacedEmptyPageId: string | null;
}

/**
 * 把导入页合进当前文档（一次可撤销提交）：空白单页文档用第一张导入页替换它，否则追加；
 * 切到第一张新页；sourcePdf 只挂在文档上（不进页补丁）。
 */
export function planPdfPageInsert(doc: InkDoc, importedPages: InkPage[], sourcePdf?: InkSourcePdf): PdfInsertPlan | null {
  if (importedPages.length === 0) return null;
  const replace = shouldReplaceEmptyFirstPage(doc);
  const previousFirst = doc.pages[0];
  const nextPages = replace ? [...importedPages] : [...doc.pages, ...importedPages];
  const patch: InkPatch = {
    pages: [
      ...(replace ? [inkPageDelta(previousFirst, importedPages[0])] : []),
      ...(replace ? importedPages.slice(1) : importedPages).map((page) => inkPageDelta(null, page)),
    ],
  };
  const order = inkOrderDelta(doc.pages, nextPages);
  if (order) patch.order = order;
  const next: InkDoc = {
    ...doc,
    pages: nextPages,
    activePageId: importedPages[0].id,
    ...(sourcePdf ? { sourcePdf } : {}),
  };
  return { next, patch, replacedEmptyPageId: replace ? previousFirst.id : null };
}

/** 选一个 PDF 文件（取消返回 null，不会悬挂 await）。桌面/移动共用（两端都是 Chromium input[type=file]）。 */
export function pickPdfFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.style.display = "none";
    let done = false;
    const finish = (file: File | null): void => {
      if (done) return;
      done = true;
      window.removeEventListener("focus", onFocus);
      input.remove();
      resolve(file);
    };
    const onFocus = (): void => {
      window.setTimeout(() => finish(input.files?.[0] ?? null), 300);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => finish(null));
    window.addEventListener("focus", onFocus, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}
