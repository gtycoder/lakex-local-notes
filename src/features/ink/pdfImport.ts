/**
 * 手写板 v2「PDF 页」导入编排（纯逻辑，两端复用；宿主注入落盘/栅格化能力）。
 *
 * 流程：PDF 字节 → 先落原 PDF（body 里要出现它的磁盘名 ⇒ 防孤儿清理）→ 逐页栅格化
 * （桌面 unpdf / 移动原生 PdfRender）→ 每页图片走同一资产通道 → 生成 InkPage[]（背景图页，
 * source=pdf-page + pdf 引用）+ InkDoc.sourcePdf。打开=只读、资产声明/S3/GC 全部复用 T1 管线。
 *
 * 边界：本文件不 import unpdf / 任一端的 IPC/bridge —— rasterize/savePdf/uploadPage 由宿主注入，
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

/** 产品上限：一份 PDF 最多导入 300 页（core 的 1000 页硬上限不变）。 */
export const INK_PDF_MAX_PAGES = 300;

export interface PdfImportRasterPage {
  /** 1-based 页码（PDF 里的真实页号）。 */
  page: number;
  /** 页逻辑尺寸（桌面 = pt×4/3；移动 = 插件返回宽高）。 */
  width: number;
  height: number;
  /** 图片像素尺寸（可选；写进 backgroundImage.pixelWidth/Height）。 */
  pixelWidth?: number;
  pixelHeight?: number;
  /** 该页图片字节（桌面 WebP / 移动插件产物）。 */
  bytes: Uint8Array;
}

export interface PdfImportRasterResult {
  pageCount: number;
  pages: PdfImportRasterPage[];
  cancelled: boolean;
}

export interface PdfImportRasterizeOptions {
  maxPages: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface PdfImportDeps {
  /** 落原 PDF 到本笔记资产目录（正文里存它的 canonical URL，防孤儿清理）。 */
  savePdf: (input: { bytes: Uint8Array; filename: string }) => Promise<{ url: string }>;
  /** 逐页栅格化（桌面 unpdf / 移动原生插件）。 */
  rasterize: (input: { bytes: Uint8Array; pdfUrl: string }, options: PdfImportRasterizeOptions) => Promise<PdfImportRasterResult>;
  /** 上传单页图片字节。 */
  uploadPage: (input: { bytes: Uint8Array; filename: string }) => Promise<{ url: string }>;
}

export interface PdfImportOptions {
  fileName?: string;
  /** 产品截断上限（默认 300，硬夹到 1..300）。 */
  maxPages?: number;
  onProgress?: (done: number, total: number) => void;
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
  return { pages: [], pageCount: 0, importedPageCount: 0, truncated: false, cancelled: false, errors };
}

/**
 * PDF → 图片页（不写正文；调用方拿 pages/sourcePdf 自己提交，见 planPdfPageInsert）。
 * 逐页容错：某页上传失败只记 errors，其余页照常；取消 = 不产出任何页（已上传资产由 GC 回收）。
 */
export async function importPdfPages(
  bytes: Uint8Array,
  deps: PdfImportDeps,
  options: PdfImportOptions = {},
): Promise<PdfImportOutcome> {
  if (bytes.length === 0) return emptyOutcome(["PDF 为空"]);
  if (bytes.length > MAX_ATTACHMENT_BYTES) return emptyOutcome(["PDF 超过 100 MiB 上限"]);
  const maxPages = Math.min(INK_PDF_MAX_PAGES, Math.max(1, Math.floor(options.maxPages ?? INK_PDF_MAX_PAGES)));

  let pdfUrl = "";
  try {
    const saved = await deps.savePdf({ bytes, filename: options.fileName || "import.pdf" });
    if (!isNoteAssetUrl(saved.url)) return emptyOutcome(["PDF 上传结果不是本地资产地址"]);
    pdfUrl = saved.url;
  } catch (reason) {
    return emptyOutcome(["PDF 上传失败：" + errorText(reason)]);
  }

  let raster: PdfImportRasterResult;
  try {
    raster = await deps.rasterize({ bytes, pdfUrl }, { maxPages, onProgress: options.onProgress, signal: options.signal });
  } catch (reason) {
    return emptyOutcome([pdfRasterErrorMessage(reason)]);
  }

  const pageCount = Math.max(raster.pageCount || 0, raster.pages.length);
  if (raster.cancelled) {
    return { ...emptyOutcome(), pageCount, cancelled: true };
  }
  const rasterPages = raster.pages.slice(0, maxPages);
  const truncated = pageCount > rasterPages.length;
  const pages: InkPage[] = [];
  const errors: string[] = [];
  for (const item of rasterPages) {
    if (options.signal?.aborted) {
      return { pages: [], pageCount, importedPageCount: 0, truncated, cancelled: true, errors };
    }
    try {
      const uploaded = await deps.uploadPage({ bytes: item.bytes, filename: `pdf-page-${item.page}.webp` });
      if (!isNoteAssetUrl(uploaded.url)) {
        errors.push(`第 ${item.page} 页：上传结果不是本地资产地址`);
        continue;
      }
      const image: InkBackgroundImage = {
        url: uploaded.url,
        fit: "contain",
        source: "pdf-page",
        pdf: { url: pdfUrl, page: item.page, pageCount },
      };
      if (item.pixelWidth && item.pixelHeight) {
        image.pixelWidth = Math.round(item.pixelWidth);
        image.pixelHeight = Math.round(item.pixelHeight);
      }
      const base = createInkPage(newInkId("page"), "blank");
      pages.push({
        ...base,
        width: item.width,
        height: item.height,
        backgroundImage: image,
      });
    } catch (reason) {
      errors.push(`第 ${item.page} 页：${errorText(reason)}`);
    }
  }
  if (pages.length === 0) {
    return { pages, pageCount, importedPageCount: 0, truncated, cancelled: false, errors };
  }
  return {
    pages,
    sourcePdf: { url: pdfUrl, pageCount },
    pageCount,
    importedPageCount: pages.length,
    truncated,
    cancelled: false,
    errors,
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
