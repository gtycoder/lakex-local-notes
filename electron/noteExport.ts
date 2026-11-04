import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { isSafePathSegment, sanitizeFileName } from "../src/core/storeUtils.js";
import { mdToHtml, wrapHtmlPage } from "../src/core/mdToHtml.js";
import { mimeTypeForFilename } from "../src/core/assetNaming.js";
import { ASSET_PORT } from "./assetServer.js";
import { bitableAttachments, parseBitableBody } from "../src/core/bitableDoc.js";
import { bitableTableCsv, csvFileNameFor } from "../src/core/bitableCsv.js";
import { parseUsheetBody } from "../src/core/usheetDoc.js";
import { usheetSheetCsv } from "../src/core/usheetCsv.js";
import { buildUsheetXlsx } from "./usheetXlsxExport.js";
import { collectMarkdownImageSources, markdownToDocx, type DocxImage } from "../src/core/docx.js";
import { parseLocalAssetUrl } from "../src/core/assetUrl.js";
import { parseInkBody, type InkBackgroundImageFit, type InkDoc, type InkPage } from "../src/core/inkDoc.js";
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
import { ZipWriter } from "../src/core/zipArchive.js";

/** 同名附件归档时的去重后缀：a.pdf → a (2).pdf。 */
function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) + " (" + n + ")" + name.slice(dot) : name + " (" + n + ")";
}

/**
 * W-3：资产服务器 URL 提取正则工厂。端口跟随 ASSET_PORT（LAKE_ASSET_PORT 可覆盖，
 * 多端同机双开），此前硬编码 19876 会在端口覆盖时让导出静默丢失全部图片。
 */
export function localAssetLakeSrcRe(port: number): RegExp {
  return new RegExp(`^http://127\\.0\\.0\\.1:${port}/([^/]+)/([^/]+)$`);
}
export function localAssetHtmlImgRe(port: number): RegExp {
  return new RegExp(`<img[^>]*src="(http://127\\.0\\.0\\.1:${port}/([^/]+)/([^/"\\s]+))"`, "g");
}
export function localAssetMdImgRe(port: number): RegExp {
  return new RegExp(`!\\[[^\\]]*\\]\\((http://127\\.0\\.0\\.1:${port}/([^/)]+)/([^/)]+))\\)`, "g");
}

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

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 导出的页图统一转 JPEG 的质量（Chromium 打印会把 WebP 按无损重写：335 页实测 382 MB）。 */
const INK_EXPORT_JPEG_QUALITY = 80;

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
      + `<svg class="ink-page__ink" viewBox="0 0 ${page.width} ${page.height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${paths}</svg>`
      + "</div>";
  }).join("");
  return { bodyHtml: `<div class="ink-pdf">${pages}</div>`, imageCount, skipped };
}

/** 导出上下文：DB + 路径 + 缓存读取（由 Store 装配）。 */
export interface NoteExportContext {
  db: DbLike;
  /** .lake 正文文件绝对路径 */
  notePathFor: (noteId: string) => string;
  /** workspace 级资产根目录（note-assets/） */
  noteAssetsDir: string;
  /** 读取笔记缓存（markdown/plain） */
  readNoteCaches: (noteId: string) => { markdown: string | null; plain: string | null };
}

/**
 * 文档导出域（HTML / Markdown 资料包 / 多维表 CSV）。
 * 从事务语义到 SQL 全部原样迁移自 Store（REFACTOR：只搬家不改行为）。
 */
export class NoteExport {
  private readonly ctx: NoteExportContext;

  constructor(ctx: NoteExportContext) {
    this.ctx = ctx;
  }

  /** 唯一导出目录（{base}/{title}，重名自动 -2/-3 后缀）。 */
  private uniqueExportDir(base: string, title: string): string {
    let exportDir = path.join(base, title);
    let suffix = 2;
    while (fs.existsSync(exportDir)) {
      exportDir = path.join(base, `${title}-${suffix}`);
      suffix++;
    }
    return exportDir;
  }

  /** 默认导出根目录（桌面 lakex-local-notes-导出）。 */
  private defaultExportBase(): string {
    return path.join(os.homedir(), "Desktop", "lakex-local-notes-导出");
  }

  /**
   * D01：导出多维表**活动数据表**为 CSV（UTF-8 BOM + CRLF，Excel 通用）。
   * 只读 / 锁定文档也允许导出（导出不改数据）；非多维表明确拒绝。
   */
  exportBitableCsv(id: string, baseDir?: string): { exportPath: string; rowCount: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if ((row?.kind ?? "doc") !== "bitable") throw new AppError("InvalidInput", "该文档不是多维表，无法导出 CSV");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseBitableBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc || doc.tables.length === 0) throw new AppError("InvalidInput", "多维表正文为空，无可导出的数据表");
    const table = doc.tables.find((t) => t.id === doc.activeTableId) ?? doc.tables[0];
    const csv = bitableTableCsv(table, { tables: doc.tables });
    const title = sanitizeFileName(row?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const stem = `${title} - ${csvFileNameFor(table).replace(/\.csv$/, "")}`;
    const exportPath = this.uniqueExportFile(base, stem, "csv");
    fs.writeFileSync(exportPath, csv, "utf8");
    return { exportPath, rowCount: table.records.length, size: csv.length };
  }

  /**
   * 文档（doc）：导出 Word（.docx）。
   * 图片：本地资产读盘；webp 等 Word 不稳的格式用 sharp 转 png；图片尺寸用于按比例缩到 ≤600px 宽。
   * 解析/转换失败的图片不阻断导出，计入 skipped（结果提示里明说）。
   */
  async exportDocxNote(id: string, baseDir?: string): Promise<{ exportPath: string; imageCount: number; skipped: number; size: number }> {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    this.assertDocKind(id);
    const caches = this.ctx.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const images = new Map<string, DocxImage>();
    for (const src of collectMarkdownImageSources(markdown)) {
      const ref = parseLocalAssetUrl(src);
      if (!ref || ref.space !== "note" || ref.staging) continue;
      if (!isSafePathSegment(ref.noteId) || !isSafePathSegment(ref.filename)) continue;
      const file = path.join(this.ctx.noteAssetsDir, ref.noteId, ref.filename);
      try {
        if (!fs.existsSync(file)) continue;
        const ext = path.extname(ref.filename).toLowerCase();
        if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif") {
          const meta = await sharp(file).metadata();
          if (!meta.width || !meta.height) continue;
          images.set(src, {
            bytes: new Uint8Array(fs.readFileSync(file)),
            extension: ext === ".png" ? "png" : ext === ".gif" ? "gif" : "jpeg",
            width: meta.width,
            height: meta.height,
          });
        } else {
          const converted = await sharp(file).png().toBuffer({ resolveWithObject: true });
          images.set(src, { bytes: new Uint8Array(converted.data), extension: "png", width: converted.info.width, height: converted.info.height });
        }
      } catch {
        // 单张图失败：跳过（result.skipped 会计数并提示），不影响整篇导出。
      }
    }
    const result = markdownToDocx(markdown, (src) => images.get(src) ?? null);
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const exportPath = this.uniqueExportFile(base, title, "docx");
    fs.writeFileSync(exportPath, Buffer.from(result.bytes));
    return { exportPath, imageCount: result.imageCount, skipped: result.skippedImages, size: result.bytes.byteLength };
  }

  /**
   * 表格（usheet）：导出某一张工作表为 CSV（UTF-8 BOM + CRLF，Excel 通用）。
   * 工作表选择：渲染层给了活动 sheetId 就用它，否则回退 sheetOrder 第一张（结果带表名，UI 会明确导的是哪张）。
   * 空工作表**明确报错**，不产出一个空文件让用户以为成功。
   */
  exportUsheetCsv(id: string, baseDir?: string, sheetId?: string): { exportPath: string; rowCount: number; sheetName: string; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if ((row?.kind ?? "doc") !== "usheet") throw new AppError("InvalidInput", "该文档不是表格，无法导出 CSV");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseUsheetBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc) throw new AppError("InvalidInput", "表格正文为空或无法解析，无可导出的数据");
    const result = usheetSheetCsv(doc.workbook, sheetId);
    if (!result.csv) throw new AppError("InvalidInput", `工作表「${result.sheetName}」为空，没有可导出的数据`);
    const title = sanitizeFileName(row?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const stem = `${title} - ${sanitizeFileName(result.sheetName)}`;
    const exportPath = this.uniqueExportFile(base, stem, "csv");
    fs.writeFileSync(exportPath, result.csv, "utf8");
    return { exportPath, rowCount: result.rowCount, sheetName: result.sheetName, size: result.csv.length };
  }

  /**
   * 表格（usheet）：导出全部工作表为 Excel（.xlsx，多工作表 + 图片内嵌）。
   * 语义映射在 core/usheetExcel.ts；写库在 electron/usheetXlsxExport.ts（write-excel-file）。
   * 所有工作表都为空 ⇒ 明确报错，不产出空工作簿。
   */
  async exportUsheetXlsx(id: string, baseDir?: string): Promise<{ exportPath: string; rowCount: number; sheetCount: number; imageCount: number; skipped: number; size: number }> {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if ((row?.kind ?? "doc") !== "usheet") throw new AppError("InvalidInput", "该文档不是表格，无法导出 Excel");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseUsheetBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc) throw new AppError("InvalidInput", "表格正文为空或无法解析，无可导出的数据");
    const result = await buildUsheetXlsx(doc.workbook, { noteId: id, assetsDir: this.ctx.noteAssetsDir });
    if (result.cellCount === 0 && result.imageCount === 0) throw new AppError("InvalidInput", "表格内容为空，没有可导出的数据");
    const title = sanitizeFileName(row?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const exportPath = this.uniqueExportFile(base, title, "xlsx");
    fs.writeFileSync(exportPath, Buffer.from(result.bytes));
    return { exportPath, rowCount: result.rowCount, sheetCount: result.sheetCount, imageCount: result.imageCount, skipped: result.skipped, size: result.bytes.byteLength };
  }

  /**
   * D01 续：导出多维表**活动数据表**为 ZIP 压缩包 —— 内含 `{表名}.csv` + `附件/{文件名}`。
   * 附件/图片字段引用的真实文件一并打包；同名附件自动加 (2)/(3) 后缀，并让 CSV 对应单元格指向归档内相对路径。
   * store（不压缩）**流式写盘**：每次只读一个附件，避免整包进内存；4GiB 以上明确报错（需 ZIP64）。
   */
  exportBitableZip(id: string, baseDir?: string): { exportPath: string; rowCount: number; fileCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if ((row?.kind ?? "doc") !== "bitable") throw new AppError("InvalidInput", "该文档不是多维表，无法导出压缩包");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseBitableBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc || doc.tables.length === 0) throw new AppError("InvalidInput", "多维表正文为空，无可导出的数据表");
    const table = doc.tables.find((t) => t.id === doc.activeTableId) ?? doc.tables[0];

    // 1) 收集附件（按磁盘名去重）：附件 / 图片字段引用的 { file, name }
    const pairs: Array<{ file: string; name: string }> = [];
    const seen = new Set<string>();
    for (const field of table.fields) {
      if (field.type !== "attachment" && field.type !== "image") continue;
      for (const record of table.records) {
        for (const attachment of bitableAttachments(record.values[field.id])) {
          if (seen.has(attachment.file)) continue;
          seen.add(attachment.file);
          pairs.push({ file: attachment.file, name: attachment.name });
        }
      }
    }
    // 2) 归档内文件名去重（与 CSV 单元格一一对应）
    const used = new Set<string>();
    const archiveName = new Map<string, string>();
    for (const pair of pairs) {
      const base = pair.name.replace(/[\\/:*?"<>|\r\n]/g, "_").trim() || "附件";
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate)) candidate = withSuffix(base, suffix++);
      used.add(candidate);
      archiveName.set(pair.file, candidate);
    }
    const labelOf = (attachment: { file: string; name: string }): string => "附件/" + (archiveName.get(attachment.file) ?? attachment.name);
    const csv = bitableTableCsv(table, { tables: doc.tables }, { attachmentLabel: labelOf });

    // 3) 流式写 zip
    const title = sanitizeFileName(row?.title ?? "未命名");
    const tableName = csvFileNameFor(table).replace(/\.csv$/, "") || "数据表";
    const base0 = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base0, { recursive: true });
    const exportPath = this.uniqueExportFile(base0, `${title} - ${tableName}`, "zip");
    const fd = fs.openSync(exportPath, "w");
    let fileCount = 0;
    let skipped = 0;
    try {
      const writer = new ZipWriter((chunk) => fs.writeSync(fd, chunk));
      writer.addFile(tableName + ".csv", Buffer.from(csv, "utf8"));
      for (const pair of pairs) {
        if (!isSafePathSegment(pair.file)) { skipped++; continue; }
        const src = path.join(this.ctx.noteAssetsDir, id, pair.file);
        if (!fs.existsSync(src)) { skipped++; continue; }
        writer.addFile("附件/" + (archiveName.get(pair.file) ?? pair.name), fs.readFileSync(src));
        fileCount++;
      }
      writer.finish();
    } finally {
      fs.closeSync(fd);
    }
    return { exportPath, rowCount: table.records.length, fileCount, skipped, size: fs.statSync(exportPath).size };
  }

  /**
   * kind 守卫：非 doc 类型（表格/多维表）正文不是 Lake 文档格式，缓存 markdown 为空/无意义，
   * 导出会产出坏文件或无语义内容 → 统一前置拦截。
   * UI 侧（目录树右键「导出」子菜单 / 文档 ⋯ 菜单）对非 doc 已隐藏入口，这里做**兜底**（防 IPC 直调）。
   */
  private assertDocKind(id: string): void {
    const row = this.ctx.db.prepare("SELECT kind FROM notes WHERE id=?").get(id) as { kind?: string | null } | undefined;
    const kind = row?.kind ?? "doc";
    if (kind === "doc") return;
    const label = kind === "usheet" ? "表格" : kind === "bitable" ? "多维表" : kind === "board" ? "画板" : kind === "ink" ? "手写板" : kind;
    throw new AppError("InvalidInput", `${label}文档暂不支持导出（仅文档可导出 Markdown/HTML/资料包；手写板仅支持导出 PDF）`);
  }

  /**
   * M1：导出 HTML（收口导出的一环）：读缓存 Markdown → 轻量转 HTML →
   * 复制本地图片到 images/ 并改写相对引用 → 写 {标题}/index.html。
   */
  exportHtmlNote(id: string, baseDir?: string): { exportPath: string; imageCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    this.assertDocKind(id);
    const caches = this.ctx.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    const exportDir = this.uniqueExportDir(base, title);
    const imagesDir = path.join(exportDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    let body = mdToHtml(markdown);
    // 提取 <img src="http://127.0.0.1:{ASSET_PORT}/{noteId}/{file}"> 并复制 + 改写相对引用
    const imgRe = localAssetHtmlImgRe(ASSET_PORT);
    const seen = new Set<string>();
    let imageCount = 0;
    let skipped = 0;
    body = body.replace(imgRe, (whole: string, url: string, noteId: string, filename: string) => {
      const key = `${noteId}/${filename}`;
      if (seen.has(key)) return whole.replace(url, `images/${filename}`);
      seen.add(key);
      if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) { skipped++; return whole; }
      const src = path.join(this.ctx.noteAssetsDir, noteId, filename);
      try {
        if (fs.existsSync(src)) {
          const dest = path.join(imagesDir, filename);
          if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
          imageCount++;
          return whole.replace(url, `images/${filename}`);
        }
      } catch { /* 复制失败算跳过 */ }
      skipped++;
      return whole;
    });
    const page = wrapHtmlPage(title, body);
    fs.writeFileSync(path.join(exportDir, "index.html"), page, "utf8");
    return { exportPath: path.join(exportDir, "index.html"), imageCount, skipped, size: page.length };
  }

  /** 唯一导出文件路径（{base}/{title}.{ext}，重名 -2/-3 后缀）。 */
  private uniqueExportFile(base: string, title: string, ext: string): string {
    let p = path.join(base, `${title}.${ext}`);
    let suffix = 2;
    while (fs.existsSync(p)) {
      p = path.join(base, `${title}-${suffix}.${ext}`);
      suffix++;
    }
    return p;
  }

  /** 单张页图 → JPEG data URI（读不到/转码失败返回 null，调用方计 skipped）。 */
  private async inkImageDataUri(url: string): Promise<string | null> {
    const ref = parseLocalAssetUrl(url);
    if (!ref || ref.space !== "note" || ref.staging) return null;
    if (!isSafePathSegment(ref.noteId) || !isSafePathSegment(ref.filename)) return null;
    const file = path.join(this.ctx.noteAssetsDir, ref.noteId, ref.filename);
    if (!fs.existsSync(file)) return null;
    try {
      const jpeg = await sharp(file).jpeg({ quality: INK_EXPORT_JPEG_QUALITY }).toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    } catch {
      // 转码失败：退回原始字节（宁可 PDF 大一点，也不要丢页图）。
      try {
        return `data:${mimeTypeForFilename(ref.filename)};base64,${fs.readFileSync(file).toString("base64")}`;
      } catch {
        return null;
      }
    }
  }

  /**
   * 单页（或多页）→ 自包含 SVG 文本：供「单页导出 SVG」落盘、以及渲染层栅格化成 PNG。
   * 不写文件（落盘交给调用方），页面尺寸与画布逻辑尺寸一致（794×1123）。
   */
  async readInkPageSvg(
    id: string,
    pageIds: string[],
  ): Promise<{ svg: string; width: number; height: number; title: string; imageCount: number; skipped: number }> {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    if ((row.kind ?? "doc") !== "ink") throw new AppError("InvalidInput", "该文档不是手写板，无法导出图片");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseInkBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc) throw new AppError("InvalidInput", "手写板正文无法解析，无法导出图片");
    const index = pageIds.length > 0 ? doc.pages.findIndex((item) => item.id === pageIds[0]) : 0;
    const page = doc.pages[index];
    if (!page) throw new AppError("InvalidInput", "该页不存在（可能已被删除）");
    // 背景图与页内贴图都要各自的 data URI（不能共用一个 getter：那会把背景图当成所有贴图）
    const uris = new Map<string, string | null>();
    const urls = new Set<string>([
      ...(page.backgroundImage ? [page.backgroundImage.url] : []),
      ...(page.images ?? []).map((image) => image.url),
    ]);
    for (const url of urls) uris.set(url, await this.inkImageDataUri(url));
    let imageCount = 0;
    let skipped = 0;
    const countImage = (url: string): void => {
      if (uris.get(url)) imageCount += 1;
      else skipped += 1;
    };
    if (page.backgroundImage) countImage(page.backgroundImage.url);
    for (const image of page.images ?? []) countImage(image.url);
    const svg = buildInkPageSvg(page, index, { imageDataUri: (url: string) => uris.get(url) ?? null });
    return { svg, width: page.width, height: page.height, title: sanitizeFileName(row.title ?? "未命名"), imageCount, skipped };
  }
  /**
   * 手写板（kind=ink）导出 PDF 的内容准备：读 ink 正文 → 每页压平 HTML（底纹 + 背景图 data URI + 矢量笔迹）
   * → 自包含临时 HTML + 唯一 pdf 目标路径。渲染仍由 electron/export.ts 的隐藏窗口 printToPDF 完成。
   * 只导出「当前内容」：不管阅读/编辑态、不管视口。**纸张底纹与画布一致**（有底纹就印，blank 就是白纸）。
   * `pageIds` 给了就只导这些页（单页导出复用同一条管线）。
   */
  async exportInkPdfHtml(
    id: string,
    baseDir?: string,
    options: { pageIds?: string[] } = {},
  ): Promise<{ htmlPath: string; tempDir: string; pdfPath: string; imageCount: number; skipped: number }> {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title, kind FROM notes WHERE id=?").get(id) as { title?: string; kind?: string | null } | undefined;
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    if ((row.kind ?? "doc") !== "ink") throw new AppError("InvalidInput", "该文档不是手写板，无法导出 PDF");
    const bodyPath = this.ctx.notePathFor(id);
    if (!fs.existsSync(bodyPath)) throw new AppError("NotFound", `笔记不存在: ${id}`);
    const doc = parseInkBody(fs.readFileSync(bodyPath, "utf8"));
    if (!doc) throw new AppError("InvalidInput", "手写板正文无法解析，无法导出 PDF");
    const title = sanitizeFileName(row.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const pdfPath = this.uniqueExportFile(base, title, "pdf");
    // 页图统一转 JPEG 再内嵌：Chromium 打印会把 WebP 按无损重写（335 页实测 382 MB）；
    // JPEG q80 实测 ≈200 KB/页 ⇒ 全书降到 ~1/6（代价 ~33ms/页 转码）。
    const wanted = options.pageIds && options.pageIds.length > 0 ? new Set(options.pageIds) : null;
    const selected = wanted ? doc.pages.filter((item) => wanted.has(item.id)) : doc.pages;
    const uris = new Map<string, string | null>();
    for (const item of selected) {
      const image = item.backgroundImage;
      if (!image || uris.has(image.url)) continue;
      uris.set(image.url, await this.inkImageDataUri(image.url));
    }
    const imageDataUri = (url: string): string | null => uris.get(url) ?? null;
    const { bodyHtml, imageCount, skipped } = buildInkPdfBody(doc, { imageDataUri }, { pageIds: options.pageIds });
    const page = wrapHtmlPage(title, bodyHtml).replace("</head>", `${INK_PDF_PRINT_CSS}</head>`);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-ink-pdf-"));
    const htmlPath = path.join(tempDir, "index.html");
    fs.writeFileSync(htmlPath, page, "utf8");
    return { htmlPath, tempDir, pdfPath, imageCount, skipped };
  }

  /**
   * M3：PDF 导出内容准备（本方法无 electron 依赖、可测）：缓存 Markdown → HTML →
   * 图片 data URI 内嵌（单文件交付，临时页 loadFile 无 data URL 导航大小限制）→
   * 自包含临时 HTML + 唯一 pdf 目标路径。渲染（隐藏窗口 printToPDF）由 electron/export.ts
   * 完成（思源同款 printToPDF 路线），临时目录由调用方用完即删。
   */
  async exportPdfHtml(
    id: string,
    baseDir?: string,
    options: { pageIds?: string[] } = {},
  ): Promise<{ htmlPath: string; tempDir: string; pdfPath: string; imageCount: number; skipped: number }> {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    // PDF 按 kind 分流：ink = 逐页压平（底纹 + 背景图 + 矢量笔迹）；doc = Markdown→HTML；其余显式拒绝。
    const kindRow = this.ctx.db.prepare("SELECT kind FROM notes WHERE id=?").get(id) as { kind?: string | null } | undefined;
    if ((kindRow?.kind ?? "doc") === "ink") return this.exportInkPdfHtml(id, baseDir, options);
    this.assertDocKind(id);
    const caches = this.ctx.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    const base = baseDir ?? this.defaultExportBase();
    fs.mkdirSync(base, { recursive: true });
    const pdfPath = this.uniqueExportFile(base, title, "pdf");
    let body = mdToHtml(markdown);
    // 图片 → data URI 内嵌（同图复用缓存，避免多次读同一文件）
    const imgRe = localAssetHtmlImgRe(ASSET_PORT);
    const uriCache = new Map<string, string | null>();
    const toDataUri = (noteId: string, filename: string): string | null => {
      const key = `${noteId}/${filename}`;
      if (uriCache.has(key)) return uriCache.get(key)!;
      let uri: string | null = null;
      if (isSafePathSegment(noteId) && isSafePathSegment(filename)) {
        const file = path.join(this.ctx.noteAssetsDir, noteId, filename);
        try {
          if (fs.existsSync(file)) {
            uri = `data:${mimeTypeForFilename(filename)};base64,${fs.readFileSync(file).toString("base64")}`;
          }
        } catch { /* 读取失败算跳过 */ }
      }
      uriCache.set(key, uri);
      return uri;
    };
    let imageCount = 0;
    let skipped = 0;
    body = body.replace(imgRe, (whole: string, url: string, noteId: string, filename: string) => {
      const uri = toDataUri(noteId, filename);
      if (!uri) { skipped++; return whole; }
      imageCount++;
      return whole.replace(url, uri);
    });
    // 打印优化（A4 分页防断裂；页边距由 printToPDF margins 管，body 不再留白/限宽）
    const printCss = "<style>body { max-width: none; padding: 0; } h1, h2, h3 { break-after: avoid; } pre, blockquote, img, li { break-inside: avoid; }</style>";
    const page = wrapHtmlPage(title, body).replace("</head>", `${printCss}</head>`);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-export-pdf-"));
    const htmlPath = path.join(tempDir, "index.html");
    fs.writeFileSync(htmlPath, page, "utf8");
    return { htmlPath, tempDir, pdfPath, imageCount, skipped };
  }

  getNotePaths(id: string): { title: string; lakePath: string; assetsDir: string } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const row = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    return { title: row.title, lakePath: this.ctx.notePathFor(id), assetsDir: path.join(this.ctx.noteAssetsDir, id) };
  }

  /**
   * M1：导出资料包（Markdown + 图片）到桌面 lakex-local-notes-导出/{标题}/。
   * 图片引用从 Lake 生成的 markdown 里以轻量正则提取（`![](http://127.0.0.1:19876/{noteId}/{filename})`），
   * 复制到导出目录 images/ 并把 MD 改写为相对引用，产出自包含资料包。
   */
  exportNotePackage(id: string, baseDir?: string): { exportDir: string; imageCount: number; skipped: number; size: number } {
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    this.assertDocKind(id);
    const caches = this.ctx.readNoteCaches(id);
    const markdown = caches.markdown ?? "";
    if (!markdown.trim()) throw new AppError("InvalidInput", "该文档还没有文本缓存，请先打开并保存一次");
    const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    const title = sanitizeFileName(titleRow?.title ?? "未命名");
    // 提取图片引用（仅处理本地 assetServer URL；远程 URL 保持原样）
    const imgRe = localAssetMdImgRe(ASSET_PORT);
    const unique: Array<{ url: string; noteId: string; filename: string }> = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(markdown))) {
      const url = m[1], noteId = m[2], filename = m[3];
      if (!isSafePathSegment(noteId) || !isSafePathSegment(filename)) continue; // 防路径穿越
      const key = `${noteId}/${filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ url, noteId, filename });
    }
    const base = baseDir ?? this.defaultExportBase();
    const exportDir = this.uniqueExportDir(base, title);
    const imagesDir = path.join(exportDir, "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    let imageCount = 0;
    let skipped = 0;
    let md = markdown;
    for (const img of unique) {
      const src = path.join(this.ctx.noteAssetsDir, img.noteId, img.filename);
      let copied = false;
      try {
        if (fs.existsSync(src)) {
          const dest = path.join(imagesDir, img.filename);
          if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
          copied = true;
        }
      } catch { /* 复制失败算跳过 */ }
      if (copied) {
        imageCount++;
        md = md.split(img.url).join(`images/${img.filename}`);
      } else {
        skipped++;
      }
    }
    fs.writeFileSync(path.join(exportDir, "index.md"), md, "utf8");
    return { exportDir, imageCount, skipped, size: md.length };
  }
}
