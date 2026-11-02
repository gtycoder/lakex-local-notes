/**
 * 桌面 PDF 逐页栅格化（unpdf → PNG → canvas WebP）。
 *
 * 懒加载纪律：unpdf（含 pdf.js serverless 构建，~1.5MB）**只能动态 import**，绝不能进入口/主 chunk；
 * 本模块本身只被桌面宿主（DesktopInkPad）静态引用，移动端构建不包含它。
 *
 * 环境事实（261102 实测，Node 侧）：
 *  · unpdf 用 pdf.js 的 serverless 构建（fake worker，不需要 workerSrc，也不需要打包 pdf.worker）；
 *  · cMapUrl 必须指向 public/vendor/pdfjs/cmaps（桌面走 http/私有协议 URL；Node 实测走文件系统路径）；
 *  · 中文非嵌入字体 PDF 在有 cmaps 时能正常解析（无 cmaps 时文字提取为空）。
 * 浏览器里 canvas 由 DOMCanvasFactory 提供（unpdf 自动选择），无需 @napi-rs/canvas。
 */

/** 每页逻辑尺寸 = PDF pt × 96/72（A4 595pt → 794）。 */
const CSS_PX_PER_PT = 4 / 3;
const DEFAULT_MAX_WIDTH = 1600;
/** WebP 质量：实测同一页 PNG→WebP 体积约 1/10（文字页），批注底图足够清晰。 */
const WEBP_QUALITY = 0.8;

export interface PdfRasterPage {
  /** 1-based 页码。 */
  page: number;
  /** 页逻辑尺寸（pt × 4/3）。 */
  width: number;
  height: number;
  /** 栅格图的像素尺寸。 */
  pixelWidth: number;
  pixelHeight: number;
  /** WebP 字节（上传走资产通道）。 */
  bytes: Uint8Array;
}

export interface PdfRasterResult {
  pageCount: number;
  pages: PdfRasterPage[];
  /** true = 中途被 AbortSignal 取消（pages 为已完成部分）。 */
  cancelled: boolean;
}

export interface PdfRasterOptions {
  /** 目标像素宽（默认 1600；A4@2x ≈ 1190，1600 兼顾大字与体积）。 */
  maxWidth?: number;
  /** 最多渲染多少页（产品截断 300；默认 300）。 */
  maxPages?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function pdfError(reason: unknown): Error {
  const text = reason instanceof Error ? reason.message : String(reason);
  if (/password|encrypt/i.test(text)) return new Error("PDF 已加密，暂不支持导入受密码保护的 PDF");
  return new Error("无法打开 PDF（文件损坏或格式不支持）：" + text);
}

/** PNG 字节 → WebP 字节 + 像素尺寸（canvas 编码；浏览器/Electron 渲染层可用）。 */
async function pngToWebp(pngBytes: Uint8Array): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const pngCopy = new Uint8Array(pngBytes);
  const bitmap = await createImageBitmap(new Blob([pngCopy.buffer as ArrayBuffer], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close?.();
    throw new Error("无法创建画布（PDF 页编码失败）");
  }
  context.drawImage(bitmap, 0, 0);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
  if (!blob) throw new Error("PDF 页编码 WebP 失败");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

/**
 * 渲染 PDF 为逐页 WebP（带进度/取消）。失败抛 Error（文案见 pdfError；调用方 importPdfPages 会兜）。
 * cMapUrl 取 public/vendor/pdfjs/cmaps（构建产物里的静态资源，dev 与打包版同一相对路径）。
 */
export async function renderPdfPagesDesktop(bytes: Uint8Array, options: PdfRasterOptions = {}): Promise<PdfRasterResult> {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const cMapUrl = new URL("vendor/pdfjs/cmaps/", document.baseURI).href;
  const maxWidth = Math.max(320, Math.min(2400, Math.floor(options.maxWidth ?? DEFAULT_MAX_WIDTH)));
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes, { cMapUrl, cMapPacked: true, useSystemFonts: true });
  } catch (reason) {
    throw pdfError(reason);
  }
  try {
    const pageCount = pdf.numPages;
    const total = Math.min(pageCount, Math.max(1, Math.floor(options.maxPages ?? 300)));
    const pages: PdfRasterPage[] = [];
    for (let page = 1; page <= total; page += 1) {
      if (options.signal?.aborted) return { pageCount, pages, cancelled: true };
      const pageProxy = await pdf.getPage(page);
      const viewport = pageProxy.getViewport({ scale: 1 });
      const png = await renderPageAsImage(pdf, page, { width: maxWidth });
      const webp = await pngToWebp(new Uint8Array(png));
      pages.push({
        page,
        width: viewport.width * CSS_PX_PER_PT,
        height: viewport.height * CSS_PX_PER_PT,
        pixelWidth: webp.width,
        pixelHeight: webp.height,
        bytes: webp.bytes,
      });
      options.onProgress?.(pages.length, total);
    }
    return { pageCount, pages, cancelled: false };
  } finally {
    try { await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* 释放失败不影响导入结果 */ }
  }
}
