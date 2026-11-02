/**
 * 手写板文档（kind="ink"）正文模型。
 *
 * 只存**矢量笔迹**：页面、背景模板、背景图片引用、笔迹点和笔刷参数。PNG 仅用于缩略图/导出，永不作为正文。
 * 页面坐标统一为 A4 96dpi 逻辑尺寸（794 × 1123），桌面与移动端按容器缩放显示。
 *
 * v2（261102 T1）：每页可选一张「背景图片」（图片页 + 手写批注），图片以 **canonical 本地资产 URL**
 * 引用（末段是磁盘文件名 ⇒ extractAssetRefs / 资产声明 / 同步 / GC 全链路复用现成能力）。
 * v1 正文仍可读（读入后按 v2 规范写回；不写迁移脚本）。
 */
import { parseLocalAssetUrl } from "./assetUrl.js";

export const INK_DOC_KIND = "ink" as const;
export const INK_DOC_VERSION = 2 as const;
/** 可读的正文版本：v1（纯矢量页）/ v2（可选背景图片页）。 */
export const INK_DOC_READ_VERSIONS: readonly number[] = [1, 2];
export const INK_PAGE_WIDTH = 794;
export const INK_PAGE_HEIGHT = 1123;
export const MAX_INK_BODY_CHARS = 16 * 1024 * 1024;

export const INK_BACKGROUNDS = ["blank", "lined", "grid", "dot"] as const;
export type InkBackground = (typeof INK_BACKGROUNDS)[number];

export const INK_TOOLS = ["pen", "highlighter"] as const;
export type InkTool = (typeof INK_TOOLS)[number];

/** 背景图片的铺放方式（渲染侧直接映射到 SVG preserveAspectRatio）。 */
export const INK_BACKGROUND_IMAGE_FITS = ["contain", "cover", "stretch"] as const;
export type InkBackgroundImageFit = (typeof INK_BACKGROUND_IMAGE_FITS)[number];

/** 图片页来源：普通图片 / PDF 转换出的页（pdf 记录转换参数，便于将来重渲染）。 */
export const INK_BACKGROUND_IMAGE_SOURCES = ["image", "pdf-page"] as const;
export type InkBackgroundImageSource = (typeof INK_BACKGROUND_IMAGE_SOURCES)[number];

/** PDF 页来源信息（仅 source === "pdf-page" 时出现；page 从 1 开始）。 */
export interface InkBackgroundImagePdfRef {
  url: string;
  page: number;
  pageCount: number;
}

/** 页面背景图片引用。url 必须是本笔记空间的 canonical 本地资产 URL（磁盘名在末段）。 */
export interface InkBackgroundImage {
  url: string;
  /** 缺省 contain（整图可见，留白处可批注）。 */
  fit?: InkBackgroundImageFit;
  /** 0..1；缺省 1。 */
  opacity?: number;
  /** 原图像素尺寸（正整数，成对出现；用于将来重排/导出与「大图」判定）。 */
  pixelWidth?: number;
  pixelHeight?: number;
  source?: InkBackgroundImageSource;
  pdf?: InkBackgroundImagePdfRef;
}

/** 整篇的 PDF 来源（多页 PDF 各成一页时记录同一份来源）。 */
export interface InkSourcePdf {
  url: string;
  pageCount: number;
}

export interface InkPoint {
  x: number;
  y: number;
  /** 0..1；无压感设备使用 0.5，由 perfect-freehand 模拟速度压感。 */
  pressure: number;
  /** 距本笔开始的毫秒数，可选；用于后续重采样/回放。 */
  t?: number;
}

export interface InkStroke {
  id: string;
  tool: InkTool;
  color: string;
  /** 逻辑页面单位下的基础笔宽。 */
  width: number;
  points: InkPoint[];
}

export interface InkPage {
  id: string;
  width: number;
  height: number;
  background: InkBackground;
  /** v2：可选背景图片（图片页）。缺省 = 纯矢量页。 */
  backgroundImage?: InkBackgroundImage;
  strokes: InkStroke[];
}

export interface InkDoc {
  kind: typeof INK_DOC_KIND;
  version: typeof INK_DOC_VERSION;
  pages: InkPage[];
  activePageId?: string;
  /** v2：整篇的 PDF 来源（可选）。 */
  sourcePdf?: InkSourcePdf;
}

const MAX_PAGE_WIDTH = 4096;
const MAX_PAGE_HEIGHT = 8192;
const MAX_STROKES_PER_PAGE = 20000;
const MAX_POINTS_PER_STROKE = 50000;
const MAX_PAGES = 1000;
const MAX_TOTAL_STROKES = 100000;
const MAX_TOTAL_POINTS = 300000;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isBackground(value: unknown): value is InkBackground {
  return (INK_BACKGROUNDS as readonly unknown[]).includes(value);
}

function isTool(value: unknown): value is InkTool {
  return (INK_TOOLS as readonly unknown[]).includes(value);
}

function isBackgroundImageFit(value: unknown): value is InkBackgroundImageFit {
  return (INK_BACKGROUND_IMAGE_FITS as readonly unknown[]).includes(value);
}

function isBackgroundImageSource(value: unknown): value is InkBackgroundImageSource {
  return (INK_BACKGROUND_IMAGE_SOURCES as readonly unknown[]).includes(value);
}

/**
 * 背景图片必须是**本笔记空间**的 canonical 本地资产 URL（磁盘名在末段 ⇒ extractAssetRefs 可提取、
 * 资产声明/同步/GC 全链路复用）。外部 http / data URL / 小记空间一律拒绝：图片页只引用本地资产。
 */
function isNoteAssetUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  const ref = parseLocalAssetUrl(value);
  return ref !== null && ref.space === "note" && !ref.staging;
}

/** 正整数（用于像素尺寸 / PDF 页号）。 */
function positiveInt(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizeBackgroundImagePdfRef(raw: unknown): InkBackgroundImagePdfRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isNoteAssetUrl(record.url)) return null;
  const page = positiveInt(record.page);
  const pageCount = positiveInt(record.pageCount);
  if (page === null || pageCount === null || page > pageCount) return null;
  return { url: record.url, page, pageCount };
}

function normalizeBackgroundImage(raw: unknown): InkBackgroundImage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isNoteAssetUrl(record.url)) return null;
  const image: InkBackgroundImage = { url: record.url, fit: "contain" };
  if (record.fit !== undefined) {
    if (!isBackgroundImageFit(record.fit)) return null;
    image.fit = record.fit;
  }
  if (record.opacity !== undefined) {
    const opacity = finiteNumber(record.opacity);
    if (opacity === null || opacity < 0 || opacity > 1) return null;
    image.opacity = opacity;
  }
  const hasWidth = record.pixelWidth !== undefined;
  const hasHeight = record.pixelHeight !== undefined;
  if (hasWidth !== hasHeight) return null;
  if (hasWidth && hasHeight) {
    const pixelWidth = positiveInt(record.pixelWidth);
    const pixelHeight = positiveInt(record.pixelHeight);
    if (pixelWidth === null || pixelHeight === null) return null;
    image.pixelWidth = pixelWidth;
    image.pixelHeight = pixelHeight;
  }
  if (record.source !== undefined) {
    if (!isBackgroundImageSource(record.source)) return null;
    image.source = record.source;
  }
  if (record.pdf !== undefined) {
    const pdf = normalizeBackgroundImagePdfRef(record.pdf);
    if (!pdf) return null;
    image.pdf = pdf;
  }
  return image;
}

function normalizeSourcePdf(raw: unknown): InkSourcePdf | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isNoteAssetUrl(record.url)) return null;
  const pageCount = positiveInt(record.pageCount);
  if (pageCount === null) return null;
  return { url: record.url, pageCount };
}

function normalizePoint(raw: unknown, pageWidth: number, pageHeight: number): InkPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  const pressure = finiteNumber(record.pressure);
  if (x === null || y === null) return null;
  const point: InkPoint = {
    x: clamp(x, 0, pageWidth),
    y: clamp(y, 0, pageHeight),
    pressure: pressure === null ? 0.5 : clamp(pressure, 0, 1),
  };
  const t = finiteNumber(record.t);
  if (t !== null && t >= 0) point.t = t;
  return point;
}

function normalizeStroke(raw: unknown, pageWidth: number, pageHeight: number): InkStroke | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id || !isTool(record.tool)) return null;
  if (typeof record.color !== "string" || !record.color) return null;
  const width = finiteNumber(record.width);
  if (width === null || width <= 0 || width > 128) return null;
  if (!Array.isArray(record.points) || record.points.length === 0 || record.points.length > MAX_POINTS_PER_STROKE) return null;
  const points: InkPoint[] = [];
  for (const rawPoint of record.points) {
    const point = normalizePoint(rawPoint, pageWidth, pageHeight);
    if (!point) return null;
    points.push(point);
  }
  return { id: record.id, tool: record.tool, color: record.color, width, points };
}

function normalizePage(raw: unknown): InkPage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id || !isBackground(record.background)) return null;
  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  if (width === null || height === null || width <= 0 || height <= 0 || width > MAX_PAGE_WIDTH || height > MAX_PAGE_HEIGHT) return null;
  if (!Array.isArray(record.strokes) || record.strokes.length > MAX_STROKES_PER_PAGE) return null;
  const strokes: InkStroke[] = [];
  for (const rawStroke of record.strokes) {
    const stroke = normalizeStroke(rawStroke, width, height);
    if (!stroke) return null;
    strokes.push(stroke);
  }
  const page: InkPage = { id: record.id, width, height, background: record.background, strokes };
  if (record.backgroundImage !== undefined) {
    const backgroundImage = normalizeBackgroundImage(record.backgroundImage);
    if (!backgroundImage) return null;
    page.backgroundImage = backgroundImage;
  }
  return page;
}

/** 创建空白 A4 手写板。pageId 必须由调用方保证在文档内唯一。 */
export function createInkDoc(pageId = "page-1"): InkDoc {
  return {
    kind: INK_DOC_KIND,
    version: INK_DOC_VERSION,
    pages: [{
      id: pageId,
      width: INK_PAGE_WIDTH,
      height: INK_PAGE_HEIGHT,
      background: "blank",
      strokes: [],
    }],
    activePageId: pageId,
  };
}

export function createInkPage(id: string, background: InkBackground = "blank"): InkPage {
  return { id, width: INK_PAGE_WIDTH, height: INK_PAGE_HEIGHT, background, strokes: [] };
}

/** 正文 → InkDoc。严格校验：坏正文返回 null，编辑器必须只读，不得用默认空文档覆盖原文。 */
export function parseInkBody(content: string | null | undefined): InkDoc | null {
  if (!content || content.length > MAX_INK_BODY_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.kind !== INK_DOC_KIND || !INK_DOC_READ_VERSIONS.includes(record.version as number)) return null;
  if (!Array.isArray(record.pages) || record.pages.length === 0 || record.pages.length > MAX_PAGES) return null;
  const pages: InkPage[] = [];
  const ids = new Set<string>();
  const strokeIds = new Set<string>();
  let totalStrokes = 0;
  let totalPoints = 0;
  for (const rawPage of record.pages) {
    const page = normalizePage(rawPage);
    if (!page || ids.has(page.id)) return null;
    for (const stroke of page.strokes) {
      if (strokeIds.has(stroke.id)) return null;
      strokeIds.add(stroke.id);
    }
    totalStrokes += page.strokes.length;
    totalPoints += page.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
    if (totalStrokes > MAX_TOTAL_STROKES || totalPoints > MAX_TOTAL_POINTS) return null;
    ids.add(page.id);
    pages.push(page);
  }
  const activePageId = typeof record.activePageId === "string" && ids.has(record.activePageId)
    ? record.activePageId
    : pages[0].id;
  const doc: InkDoc = { kind: INK_DOC_KIND, version: INK_DOC_VERSION, pages, activePageId };
  if (record.sourcePdf !== undefined) {
    const sourcePdf = normalizeSourcePdf(record.sourcePdf);
    if (!sourcePdf) return null;
    doc.sourcePdf = sourcePdf;
  }
  return doc;
}

/** 稳定字段顺序，便于 hash / diff / S3 对象复用。v2 字段只在存在时出现，缺省值（fit=contain）显式写出。 */
function serializeBackgroundImagePdfRef(pdf: InkBackgroundImagePdfRef): InkBackgroundImagePdfRef {
  return { url: pdf.url, page: pdf.page, pageCount: pdf.pageCount };
}

function serializeBackgroundImage(image: InkBackgroundImage): Record<string, unknown> {
  const out: Record<string, unknown> = { url: image.url, fit: image.fit ?? "contain" };
  if (image.opacity !== undefined) out.opacity = image.opacity;
  if (image.pixelWidth !== undefined && image.pixelHeight !== undefined) {
    out.pixelWidth = image.pixelWidth;
    out.pixelHeight = image.pixelHeight;
  }
  if (image.source !== undefined) out.source = image.source;
  if (image.pdf !== undefined) out.pdf = serializeBackgroundImagePdfRef(image.pdf);
  return out;
}

export function inkToBody(doc: InkDoc): string {
  if (doc.pages.length === 0 || doc.pages.length > MAX_PAGES) throw new Error("手写板页数超出上限");
  let totalStrokes = 0;
  let totalPoints = 0;
  const pages = doc.pages.map((page) => {
    if (page.strokes.length > MAX_STROKES_PER_PAGE) throw new Error("单页笔迹数量超出上限");
    const out: Record<string, unknown> = {
      id: page.id,
      width: page.width,
      height: page.height,
      background: page.background,
    };
    if (page.backgroundImage) out.backgroundImage = serializeBackgroundImage(page.backgroundImage);
    out.strokes = page.strokes.map((stroke) => {
      if (stroke.points.length > MAX_POINTS_PER_STROKE) throw new Error("单条笔迹采样点超出上限");
      return {
        id: stroke.id,
        tool: stroke.tool,
        color: stroke.color,
        width: stroke.width,
        points: stroke.points.map((point) => {
          const pointOut: Record<string, number> = { x: point.x, y: point.y, pressure: point.pressure };
          if (point.t !== undefined) pointOut.t = point.t;
          return pointOut;
        }),
      };
    });
    return out;
  });
  const activePageId = doc.activePageId && pages.some((page) => page.id === doc.activePageId)
    ? doc.activePageId
    : pages[0]?.id;
  for (const page of doc.pages) {
    totalStrokes += page.strokes.length;
    totalPoints += page.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
  }
  if (totalStrokes > MAX_TOTAL_STROKES || totalPoints > MAX_TOTAL_POINTS) {
    throw new Error("手写板笔迹或采样点超出上限");
  }
  const body = JSON.stringify({
    kind: INK_DOC_KIND,
    version: INK_DOC_VERSION,
    pages,
    ...(activePageId ? { activePageId } : {}),
    ...(doc.sourcePdf ? { sourcePdf: { url: doc.sourcePdf.url, pageCount: doc.sourcePdf.pageCount } } : {}),
  });
  if (body.length > MAX_INK_BODY_CHARS) throw new Error("手写板正文超过 16 MiB 上限");
  return body;
}

export function emptyInkBody(): string {
  return inkToBody(createInkDoc());
}

/** 手写正文当前不参与全文搜索（OCR 尚未接入）；标题仍由 notes.title 命中。 */
export function inkToSearchText(_content: string | null | undefined, _maxChars = 20000): string {
  return "";
}

export function inkStrokePointCount(doc: InkDoc): number {
  return doc.pages.reduce((sum, page) => sum + page.strokes.reduce((n, stroke) => n + stroke.points.length, 0), 0);
}
