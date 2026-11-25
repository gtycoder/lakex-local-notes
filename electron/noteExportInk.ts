/**
 * 手写板（inkDoc v4）导出渲染块：笔迹 / 纸张底纹 / 页内贴图 / 页内文字块 → SVG 与逐页压平 HTML。
 * 职责：只做「inkDoc 页面 → 标记串」的纯渲染（C-07 从 noteExport.ts 原样搬出，零行为变化）；
 * 落盘、读正文、图片转码（sharp/fs）与导出编排仍归 NoteExport（electron/noteExport.ts）。
 * 边界：本文件零 fs / 零 electron 依赖 —— 背景图与贴图一律走调用方注入的 imageDataUri
 * （InkPdfBodyDeps），读不到返回 null、由调用方计 skipped（缺图不缺页）。
 * 契约：正文格式 = inkDoc v4（docs/INK-PAD.md，读 1|2|3|4 写 4）；纸张底纹几何单一来源
 * = src/core/inkPaperGeometry；笔迹描边 / 断行与屏显同源（src/features/ink/*），屏幕与导出不得分家。
 * 调用方：NoteExport.readInkPageSvg / exportInkPdfHtml（electron/noteExport.ts）与 noteExport.inkPdf.test.ts。
 */
import type { InkBackgroundImageFit, InkDoc, InkPage } from "../src/core/inkDoc.js";
import {
  INK_PAPER_DOT_PITCH,
  INK_PAPER_DOT_RADIUS,
  INK_PAPER_EXPORT_COLORS,
  INK_PAPER_PITCH,
  INK_PAPER_STROKE_OFFSET,
  INK_PAPER_STROKE_WIDTH,
  isPaperBackground,
} from "../src/core/inkPaperGeometry.js";
import { strokeToSvgPath } from "../src/features/ink/inkGeometry.js";
import { inkStrokeStyle } from "../src/features/ink/inkStrokeStyle.js";
import { INK_TEXT_LINE_HEIGHT, wrapInkTextLines } from "../src/features/ink/inkPageTexts.js";

/** 手写板 PDF 打印样式：每页一块 A4 比例画布（210mm 宽，打印时随可打印宽度收窄），页间强制分页。
 *  注意 printToPDF 的 A4 页边距参数保持不变（electron/pdfRenderer.ts）⇒ 页面宽度用 max-width:100% 适配可打印区，
 *  否则 210mm 会被页边距裁掉右侧。 */
export const INK_PDF_PRINT_CSS = [
  "<style>",
  "body { max-width: none; margin: 0; padding: 0; background: #fff; }",
  ".ink-pdf { margin: 0; padding: 0; background: #fff; }",
  ".ink-page { position: relative; width: 210mm; max-width: 100%; aspect-ratio: 210 / 297; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }",
  ".ink-page:last-child { page-break-after: auto; break-after: auto; }",
  ".ink-page__paper { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }",
  ".ink-page__bg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }",
  ".ink-page__img { position: absolute; display: block; }",
  ".ink-page__ink { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }",
  "</style>",
].join("");

/** 背景图 <img style> 的铺放方式（与屏内 SVG preserveAspectRatio 语义对齐）。 */
export function inkBackgroundFitCss(fit: InkBackgroundImageFit | undefined): string {
  if (fit === "cover") return "cover";
  if (fit === "stretch") return "fill";
  return "contain";
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 单页笔迹 → SVG path 串（逐页 HTML 与独立 SVG 共用，保证两条路线的笔迹一模一样）。 */
function inkStrokePathsMarkup(page: InkPage): string {
  return page.strokes.map((stroke) => {
    const d = strokeToSvgPath(stroke, true);
    if (!d) return "";
    // 与画布同一来源：导出的 HTML/PDF 不能和高亮规则分家。
    const inkStyle = inkStrokeStyle(stroke.tool);
    const style = inkStyle.blend
      ? ' opacity="' + inkStyle.opacity + '" style="mix-blend-mode:' + inkStyle.blend + '"'
      : "";
    return `<path d="${d}" fill="${escapeHtmlAttr(stroke.color)}"${style} />`;
  }).join("");
}

/** 纸张底纹 pattern（几何来自 core/inkPaperGeometry；打印文档没有主题变量 ⇒ 用固定浅色）。 */
function inkPaperDefs(page: InkPage, patternId: string): string {
  const { line, dot } = INK_PAPER_EXPORT_COLORS;
  if (page.background === "lined") {
    return `<pattern id="${patternId}" width="${page.width}" height="${INK_PAPER_PITCH}" patternUnits="userSpaceOnUse">`
      + `<line x1="0" y1="${INK_PAPER_STROKE_OFFSET}" x2="${page.width}" y2="${INK_PAPER_STROKE_OFFSET}" stroke="${line}" stroke-width="${INK_PAPER_STROKE_WIDTH}" /></pattern>`;
  }
  if (page.background === "grid") {
    return `<pattern id="${patternId}" width="${INK_PAPER_PITCH}" height="${INK_PAPER_PITCH}" patternUnits="userSpaceOnUse">`
      + `<path d="M 0 ${INK_PAPER_STROKE_OFFSET} H ${INK_PAPER_PITCH} M ${INK_PAPER_STROKE_OFFSET} 0 V ${INK_PAPER_PITCH}" fill="none" stroke="${line}" stroke-width="${INK_PAPER_STROKE_WIDTH}" /></pattern>`;
  }
  return `<pattern id="${patternId}" width="${INK_PAPER_DOT_PITCH}" height="${INK_PAPER_DOT_PITCH}" patternUnits="userSpaceOnUse">`
    + `<circle cx="${INK_PAPER_DOT_PITCH / 2}" cy="${INK_PAPER_DOT_PITCH / 2}" r="${INK_PAPER_DOT_RADIUS}" fill="${dot}" /></pattern>`;
}

/** HTML 版：底纹单独一层 SVG，铺在背景图与笔迹下面；无底纹 = 白纸（不输出）。 */
function inkPaperMarkup(page: InkPage, patternId: string): string {
  if (!isPaperBackground(page.background)) return "";
  return `<svg class="ink-page__paper" viewBox="0 0 ${page.width} ${page.height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<defs>${inkPaperDefs(page, patternId)}</defs>`
    + `<rect x="0" y="0" width="${page.width}" height="${page.height}" fill="url(#${patternId})" />`
    + "</svg>";
}

/**
 * v4 页内贴图 → 逐张 <img>（按页面百分比定位，rotation 绕自身中心）。
 * 读不到图的行计入 skipped（页与笔迹照常输出）。
 */
function inkInlineImagesMarkup(
  page: InkPage,
  imageDataUri: (url: string) => string | null,
): { markup: string; imageCount: number; skipped: number } {
  let imageCount = 0;
  let skipped = 0;
  const markup = (page.images ?? []).map((image) => {
    const uri = imageDataUri(image.url);
    if (!uri) {
      skipped += 1;
      return "";
    }
    imageCount += 1;
    const left = (image.x / page.width) * 100;
    const top = (image.y / page.height) * 100;
    const width = (image.width / page.width) * 100;
    const height = (image.height / page.height) * 100;
    const rotation = image.rotation ? ` transform:rotate(${image.rotation}deg);` : "";
    return `<img class="ink-page__img" alt="" src="${escapeHtmlAttr(uri)}" style="left:${left}%;top:${top}%;width:${width}%;height:${height};${rotation}" />`;
  }).join("");
  return { markup, imageCount, skipped };
}

/** v4 页内贴图 → 独立 SVG 里的 <image>（单页 SVG/PNG 导出用）。 */
function inkInlineImagesSvgMarkup(page: InkPage, imageDataUri: (url: string) => string | null): string {
  return (page.images ?? []).map((image) => {
    const uri = imageDataUri(image.url);
    if (!uri) return "";
    const center = `${image.x + image.width / 2} ${image.y + image.height / 2}`;
    const rotation = image.rotation ? ` transform="rotate(${image.rotation} ${center})"` : "";
    return `<image href="${escapeHtmlAttr(uri)}" x="${image.x}" y="${image.y}" width="${image.width}" height="${image.height}"${rotation} />`;
  }).join("");
}

/**
 * v4 页内文字块 → SVG <text>（逐行 tspan）。换行与行高来自 core/features 的同一份估算
 * （`wrapInkTextLines` / `INK_TEXT_LINE_HEIGHT`）：屏幕与导出的断行必须一致。
 */
function inkTextsMarkup(page: InkPage): string {
  return (page.texts ?? []).map((item) => {
    const lines = wrapInkTextLines(item.text, item.width, item.fontSize);
    if (lines.length === 0) return "";
    const lineHeight = item.fontSize * INK_TEXT_LINE_HEIGHT;
    const anchor = item.align === "center" ? "middle" : item.align === "right" ? "end" : "start";
    const x = item.align === "center" ? item.x + item.width / 2 : item.align === "right" ? item.x + item.width : item.x;
    const baseline = item.y + item.fontSize * 0.9;
    const tspans = lines.map((line, index) => `<tspan x="${x}"${index === 0 ? "" : ` dy="${lineHeight}"`}>${escapeHtmlText(line || " ")}</tspan>`).join("");
    return `<text x="${x}" y="${baseline}" fill="${escapeHtmlAttr(item.color)}" font-size="${item.fontSize}" font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif" text-anchor="${anchor}" xml:space="preserve">${tspans}</text>`;
  }).join("");
}
/** 背景图 → preserveAspectRatio（与屏内 SVG 一致）。 */
function inkBackgroundAspect(fit: InkBackgroundImageFit | undefined): string {
  if (fit === "cover") return "xMidYMid slice";
  if (fit === "stretch") return "none";
  return "xMidYMid meet";
}

/**
 * 单页 → **独立 SVG 文档**（自包含：底纹 + 背景图 data URI + 矢量笔迹）。
 * 用途：「单页导出 SVG」直接落盘；「单页导出 PNG」由渲染层把这份 SVG 栅格化（data URI 不污染 canvas）。
 */
export function buildInkPageSvg(page: InkPage, index: number, deps: InkPdfBodyDeps): string {
  const patternId = "ink-paper-p" + index;
  const paper = isPaperBackground(page.background)
    ? `<defs>${inkPaperDefs(page, patternId)}</defs><rect x="0" y="0" width="${page.width}" height="${page.height}" fill="url(#${patternId})" />`
    : "";
  const uri = page.backgroundImage ? deps.imageDataUri(page.backgroundImage.url) : null;
  const image = page.backgroundImage && uri
    ? `<image href="${escapeHtmlAttr(uri)}" x="0" y="0" width="${page.width}" height="${page.height}" preserveAspectRatio="${inkBackgroundAspect(page.backgroundImage.fit)}" opacity="${page.backgroundImage.opacity ?? 1}" />`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}">`
    + `<rect x="0" y="0" width="${page.width}" height="${page.height}" fill="#ffffff" />` + paper + image
    + inkInlineImagesSvgMarkup(page, deps.imageDataUri)
    + inkTextsMarkup(page)
    + inkStrokePathsMarkup(page) + "</svg>";
}
/** 背景图 URL：**已转好的 data URI**（调用方做路径校验/读盘/转码；读不到返回 null）。 */
export interface InkPdfBodyDeps {
  /** 背景图 URL → data URI（调用方做路径校验/读盘；读不到返回 null）。 */
  imageDataUri: (url: string) => string | null;
}

export interface InkPdfBodyResult {
  bodyHtml: string;
  imageCount: number;
  skipped: number;
}

/**
 * 手写板 → 逐页压平 HTML（纯函数、无 fs/electron 依赖，便于单测）。
 * 每页：纸张底纹（有底纹才画，与画布同源）+ 可选背景图（data URI，object-fit 按 fit）+ 矢量笔迹 SVG。
 * 高亮笔 = 与画布同一份 inkStrokeStyle（opacity + mix-blend-mode）。
 * `pageIds` 给了就只导出这些页（按原文顺序）—— 单页导出复用同一条管线。
 */
export function buildInkPdfBody(doc: InkDoc, deps: InkPdfBodyDeps, options: { pageIds?: string[] } = {}): InkPdfBodyResult {
  let imageCount = 0;
  let skipped = 0;
  const wanted = options.pageIds && options.pageIds.length > 0 ? new Set(options.pageIds) : null;
  const selected = doc.pages
    .map((page, index) => ({ page, index }))
    .filter((item) => !wanted || wanted.has(item.page.id));
  const pages = selected.map(({ page, index }, position) => {
    let background = "";
    if (page.backgroundImage) {
      const uri = deps.imageDataUri(page.backgroundImage.url);
      if (uri) {
        imageCount++;
        const pixelAttrs = page.backgroundImage.pixelWidth && page.backgroundImage.pixelHeight
          ? ` data-pixel-width="${page.backgroundImage.pixelWidth}" data-pixel-height="${page.backgroundImage.pixelHeight}"`
          : "";
        background = `<img class="ink-page__bg" alt="" src="${escapeHtmlAttr(uri)}" style="object-fit:${inkBackgroundFitCss(page.backgroundImage.fit)}"${pixelAttrs} />`;
      } else {
        skipped++; // 缺图：占位白底（页仍在，笔迹照常输出）
      }
    }
    const inline = inkInlineImagesMarkup(page, deps.imageDataUri);
    imageCount += inline.imageCount;
    skipped += inline.skipped;
    const paths = inkStrokePathsMarkup(page);
    return `<div class="ink-page" data-page="${index + 1}">${inkPaperMarkup(page, "ink-paper-p" + position)}${background}${inline.markup}`
      + `<svg class="ink-page__ink" viewBox="0 0 ${page.width} ${page.height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inkTextsMarkup(page)}${paths}</svg>`
      + "</div>";
  }).join("");
  return { bodyHtml: `<div class="ink-pdf">${pages}</div>`, imageCount, skipped };
}
