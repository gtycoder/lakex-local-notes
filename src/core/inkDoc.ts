/**
 * 手写板文档（kind="ink"）正文模型。
 *
 * 只存**矢量笔迹**：页面、背景模板、背景图片引用、笔迹点和笔刷参数。PNG 仅用于缩略图/导出，永不作为正文。
 * 页面坐标统一为 A4 96dpi 逻辑尺寸（794 × 1123），桌面与移动端按容器缩放显示。
 *
 * v2（261102 T1）：每页可选一张「背景图片」（图片页 + 手写批注），图片以 **canonical 本地资产 URL**
 * 引用（末段是磁盘文件名 ⇒ extractAssetRefs / 资产声明 / 同步 / GC 全链路复用现成能力）。
 * v1 正文仍可读（读入后按 v3 规范写回；不写迁移脚本）。
 *
 * v3（261103 P6，一次性的格式升级；**新端写 v3 后旧端读不了 → 只读保护**，与 v1→v2 同先例）：
 *  - **点编码扁平化**：`points: [x,y,p, x,y,p, ...]`（v2 是 `{x,y,pressure}` 对象），坐标/压力定点到 0.01。
 *    实测 100 笔×60 点：369 KiB → 108 KiB（−71%）；300 页批注的体积上限从 ~15 笔/页抬到 ~50 笔/页。
 *  - **activePageId 移出正文**：当前页是设备本地视图（同 usheet 工作表 / bitable 导航，见 AGENTS §4），
 *    存 `lakex-local-notes-v3.ink-nav.<noteId>`（features/ink/inkNav.ts）；读 v1/v2 时仍取旧字段做一次性回退种子。
 *  - **sourcePdf 只留 {name?, pageCount}、页级只留 {page}**：原 PDF 不再强制入库/全端同步（此前只被
 *    「防孤儿清理」引用、运行时从不读；移动端要用磁盘 PDF 只作为原生栅格化的一次性输入）。
 *  - **坏页可丢**：结构字段（kind/version/pages 数组/页尺寸）仍严格；单页元数据坏只丢该页并计数
 *    （`InkDoc.droppedPages`，内存态，不落盘），不再让一页坏数据把整篇打成只读。
 *
 * v4（261104 二十批，一次升版装齐三件**页级**内容，避免反复升版把旧端反复踢进只读）：
 *  - `page.note`：页签（字段名沿用 note；有值 = 有页签，**空串 = 纯标记**，可选一句话说明 ≤200 字，跨端同步）；
 *  - `page.images`：页内贴图（不铺满整页的小图，引用本笔记空间资产 URL ⇒ 声明/同步/GC 自动覆盖）；
 *  - `page.texts`：页内文字块（屏幕/导出渲染 + 双击编辑，261104 二十三/二十五批）；
 *  集合字段**不是数组 ⇒ 该页坏**；数组里的单个坏元素只丢自己（不连累整页）。
 *  旧端读到 v4 仍进只读保护（v1→v2→v3 同一先例），**S3 协议不需要动**（正文按字节内容寻址）。
 */
import { parseLocalAssetUrl } from "./assetUrl.js";

export const INK_DOC_KIND = "ink" as const;
export const INK_DOC_VERSION = 4 as const;
/**
 * 可读的正文版本：v1（纯矢量页）/ v2（可选背景图片页）/ v3（扁平点编码 + 视图字段出正文）/
 * v4（页备注 + 页内贴图 + 页内文字块，261104 二十批）。
 */
export const INK_DOC_READ_VERSIONS: readonly number[] = [1, 2, 3, 4];
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

/** 图片页来源：普通图片 / PDF 转换出的页（pdf 只记页号，便于将来溯源）。 */
export const INK_BACKGROUND_IMAGE_SOURCES = ["image", "pdf-page"] as const;
export type InkBackgroundImageSource = (typeof INK_BACKGROUND_IMAGE_SOURCES)[number];

/** PDF 页来源信息（仅 source === "pdf-page" 时出现；page 从 1 开始）。v3 起只留页号（原 PDF url 不入正文）。 */
export interface InkBackgroundImagePdfRef {
  page: number;
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

/** 整篇的 PDF 来源（v3 起只记文件名与页数；原 PDF 不强制落库）。 */
export interface InkSourcePdf {
  name?: string;
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

/** v4：页内贴图（**不铺满整页**的小图，相对页逻辑坐标；整页图仍走 backgroundImage）。 */
export interface InkPageImage {
  id: string;
  /** 本笔记空间 canonical 本地资产 URL（末段磁盘名参与资产声明/同步/GC）。 */
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 旋转角度（度，-180..180）；缺省 0。 */
  rotation?: number;
}

/** v4：页内文字块（批注文字）。渲染与编辑在后续批次接入；数据先随 v4 落盘，避免二次升版。 */
export interface InkPageText {
  id: string;
  x: number;
  y: number;
  /** 排版宽度（页逻辑 px）。 */
  width: number;
  text: string;
  fontSize: number;
  color: string;
  align?: "left" | "center" | "right";
}

export interface InkPage {
  id: string;
  width: number;
  height: number;
  background: InkBackground;
  /** v2：可选背景图片（图片页）。缺省 = 纯矢量页。 */
  backgroundImage?: InkBackgroundImage;
  strokes: InkStroke[];
  /** v4：页备注（给人看的一句话说明；≤200 字，跨端同步，属正文数据）。 */
  note?: string;
  /** v4：页内贴图。 */
  images?: InkPageImage[];
  /** v4：页内文字块。 */
  texts?: InkPageText[];
}

export interface InkDoc {
  kind: typeof INK_DOC_KIND;
  version: typeof INK_DOC_VERSION;
  pages: InkPage[];
  /** 当前页：**内存视图状态**（v3 不落盘；落盘导航见 features/ink/inkNav.ts）。 */
  activePageId?: string;
  /** v2/v3：整篇的 PDF 来源（可选）。 */
  sourcePdf?: InkSourcePdf;
  /** 解析时被丢弃的坏页数（结构严格、单页坏只丢该页）；仅内存态，不参与序列化。 */
  droppedPages?: number;
}

const MAX_PAGE_WIDTH = 4096;
const MAX_PAGE_HEIGHT = 8192;
const MAX_STROKES_PER_PAGE = 20000;
const MAX_POINTS_PER_STROKE = 50000;
const MAX_PAGES = 1000;
const MAX_TOTAL_STROKES = 100000;
const MAX_TOTAL_POINTS = 300000;
/** v4 每页上限：贴图 / 文字块 / 备注长度（坏元素**只丢自己**，不连累整页）。 */
export const MAX_PAGE_IMAGES = 30;
export const MAX_PAGE_TEXTS = 200;
export const MAX_PAGE_NOTE_CHARS = 200;
export const MAX_TEXT_CHARS = 2000;
/** 贴图坐标范围（允许略微出界，渲染时由 SVG 裁掉）。 */
const MAX_PAGE_ELEMENT_COORD = 100000;

/** v3 点坐标/压力定点小数位：0.01 逻辑 px / 1% 压力（视觉无差别，体积 −71% 的一半来源在这里）。 */
const POINT_DECIMALS = 2;
const POINT_SCALE = 10 ** POINT_DECIMALS;

function quantize(value: number): number {
  return Math.round(value * POINT_SCALE) / POINT_SCALE;
}

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

/**
 * PDF 页引用（v3 = `{page}`；v2 = `{url,page,pageCount}`）→ v3 形态。
 * 老正文里的 url/pageCount 一律丢弃：原 PDF 不再强制入库（见文件头）。
 */
function normalizeBackgroundImagePdfRef(raw: unknown): InkBackgroundImagePdfRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const page = positiveInt(record.page);
  if (page === null) return null;
  return { page };
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

/**
 * v4 页签（字段名仍叫 note，避免二次升版）：**字段存在 = 这一页有页签**，值可以是空串 =「纯标记」。
 * 去空白 + 截断（元数据，宁可截断也不让整页坏；纯空白 = 纯标记）。
 */
function normalizePageNote(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.trim();
  return text.length > MAX_PAGE_NOTE_CHARS ? text.slice(0, MAX_PAGE_NOTE_CHARS) : text;
}

/** v4 页内贴图：结构严格；单张坏只丢自己（不连累整页，更不连累整篇）。 */
function normalizePageImage(raw: unknown): InkPageImage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) return null;
  if (!isNoteAssetUrl(record.url)) return null;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  const width = finiteNumber(record.width);
  const height = finiteNumber(record.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  if (Math.abs(x) > MAX_PAGE_ELEMENT_COORD || Math.abs(y) > MAX_PAGE_ELEMENT_COORD) return null;
  if (width > MAX_PAGE_ELEMENT_COORD || height > MAX_PAGE_ELEMENT_COORD) return null;
  const image: InkPageImage = { id: record.id, url: record.url, x, y, width, height };
  if (record.rotation !== undefined) {
    const rotation = finiteNumber(record.rotation);
    if (rotation === null || rotation < -180 || rotation > 180) return null;
    image.rotation = rotation;
  }
  return image;
}

/** v4 页内文字块：结构严格；单个坏只丢自己。 */
function normalizePageText(raw: unknown): InkPageText | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) return null;
  if (typeof record.text !== "string" || !record.text.trim()) return null;
  if (typeof record.color !== "string" || !record.color) return null;
  const x = finiteNumber(record.x);
  const y = finiteNumber(record.y);
  const width = finiteNumber(record.width);
  const fontSize = finiteNumber(record.fontSize);
  if (x === null || y === null || width === null || fontSize === null) return null;
  if (width <= 0 || width > MAX_PAGE_ELEMENT_COORD) return null;
  if (fontSize < 6 || fontSize > 96) return null;
  if (Math.abs(x) > MAX_PAGE_ELEMENT_COORD || Math.abs(y) > MAX_PAGE_ELEMENT_COORD) return null;
  const text = record.text.length > MAX_TEXT_CHARS ? record.text.slice(0, MAX_TEXT_CHARS) : record.text;
  const item: InkPageText = { id: record.id, x, y, width, text, fontSize, color: record.color };
  if (record.align === "left" || record.align === "center" || record.align === "right") item.align = record.align;
  return item;
}
/** 整篇 PDF 来源：v3 = {name?, pageCount}；v2 的 url 丢弃（原 PDF 不再强制入库）。 */
function normalizeSourcePdf(raw: unknown): InkSourcePdf | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const pageCount = positiveInt(record.pageCount);
  if (pageCount === null) return null;
  const source: InkSourcePdf = { pageCount };
  if (typeof record.name === "string") {
    const name = record.name.trim();
    if (name) source.name = name.length > 200 ? name.slice(0, 200) : name;
  }
  return source;
}

/**
 * 单点解析：v3 扁平 `[x,y,p,(t)]`；同时接受 v2 对象形态（历史内存快照/手工正文，结构判据不因此放宽）。
 * 坐标 clamp 到页面逻辑尺寸（越界坐标不判整页坏，与 v1/v2 行为一致）。
 */
function normalizePoint(raw: unknown, pageWidth: number, pageHeight: number): InkPoint | null {
  let x: number | null = null;
  let y: number | null = null;
  let pressure: number | null = null;
  let t: number | null = null;
  if (Array.isArray(raw)) {
    if (raw.length < 3 || raw.length > 4) return null;
    x = finiteNumber(raw[0]);
    y = finiteNumber(raw[1]);
    pressure = finiteNumber(raw[2]);
    if (raw.length === 4) t = finiteNumber(raw[3]);
  } else if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    x = finiteNumber(record.x);
    y = finiteNumber(record.y);
    pressure = finiteNumber(record.pressure);
    t = finiteNumber(record.t);
  }
  if (x === null || y === null) return null;
  const point: InkPoint = {
    x: clamp(x, 0, pageWidth),
    y: clamp(y, 0, pageHeight),
    pressure: pressure === null ? 0.5 : clamp(pressure, 0, 1),
  };
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
  const note = normalizePageNote(record.note);
  if (note !== undefined) page.note = note;
  // v4 集合字段：不是数组 ⇒ 结构不合法（整页坏）；数组里的单个坏元素只丢自己并计数。
  if (record.images !== undefined) {
    if (!Array.isArray(record.images)) return null;
    const ids = new Set<string>();
    const images: InkPageImage[] = [];
    for (const raw of record.images.slice(0, MAX_PAGE_IMAGES)) {
      const image = normalizePageImage(raw);
      if (!image || ids.has(image.id)) continue;
      ids.add(image.id);
      images.push(image);
    }
    if (images.length > 0) page.images = images;
  }
  if (record.texts !== undefined) {
    if (!Array.isArray(record.texts)) return null;
    const ids = new Set<string>();
    const texts: InkPageText[] = [];
    for (const raw of record.texts.slice(0, MAX_PAGE_TEXTS)) {
      const item = normalizePageText(raw);
      if (!item || ids.has(item.id)) continue;
      ids.add(item.id);
      texts.push(item);
    }
    if (texts.length > 0) page.texts = texts;
  }
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

/**
 * 正文 → InkDoc。结构严格：kind / version / pages 数组 / 页尺寸 / 容量上限不合法 ⇒ 整篇 null（只读保护）。
 * 单页坏（元数据/笔迹非法、页 id 重复、跨页笔迹 id 重复、超出总容量）⇒ **丢该页并计数**，其余照常可编辑；
 * droppedPages > 0 时宿主必须给可见告警（保存会把坏页永久丢弃，用户要能看见）。
 */
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
  let droppedPages = 0;
  let totalStrokes = 0;
  let totalPoints = 0;
  for (const rawPage of record.pages) {
    const page = normalizePage(rawPage);
    if (!page || ids.has(page.id)) { droppedPages += 1; continue; }
    let duplicateStroke = false;
    let pagePoints = 0;
    for (const stroke of page.strokes) {
      if (strokeIds.has(stroke.id)) { duplicateStroke = true; break; }
      pagePoints += stroke.points.length;
    }
    if (duplicateStroke) { droppedPages += 1; continue; }
    if (totalStrokes + page.strokes.length > MAX_TOTAL_STROKES || totalPoints + pagePoints > MAX_TOTAL_POINTS) {
      droppedPages += 1;
      continue;
    }
    for (const stroke of page.strokes) strokeIds.add(stroke.id);
    totalStrokes += page.strokes.length;
    totalPoints += pagePoints;
    ids.add(page.id);
    pages.push(page);
  }
  if (pages.length === 0) return null;
  // v1/v2 的 activePageId 仍作为一次性回退种子（v3 正文没这个字段，宿主用设备本地导航覆盖）。
  const activePageId = typeof record.activePageId === "string" && ids.has(record.activePageId)
    ? record.activePageId
    : pages[0].id;
  const doc: InkDoc = { kind: INK_DOC_KIND, version: INK_DOC_VERSION, pages, activePageId };
  if (droppedPages > 0) doc.droppedPages = droppedPages;
  if (record.sourcePdf !== undefined) {
    const sourcePdf = normalizeSourcePdf(record.sourcePdf);
    if (!sourcePdf) return null;
    doc.sourcePdf = sourcePdf;
  }
  return doc;
}

function serializeBackgroundImagePdfRef(pdf: InkBackgroundImagePdfRef): InkBackgroundImagePdfRef {
  return { page: pdf.page };
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

/** v3 单点：`[x,y,p,(t)]`，坐标/压力定点 0.01。 */
function serializePoint(point: InkPoint): number[] {
  const out = [quantize(point.x), quantize(point.y), quantize(point.pressure)];
  if (point.t !== undefined) out.push(quantize(point.t));
  return out;
}

/**
 * 稳定字段顺序，便于 hash / diff / S3 对象复用。
 * **activePageId 不落盘**（v3：本机视图）；v2 字段缺省值（fit=contain）显式写出。
 */
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
    // 页签：空串 = 纯标记，必须写出来（不能用 if (note) 丢掉）
    if (page.note !== undefined) out.note = page.note.trim();
    if (page.images && page.images.length > 0) {
      out.images = page.images.slice(0, MAX_PAGE_IMAGES).map((image) => ({
        id: image.id,
        url: image.url,
        x: quantize(image.x),
        y: quantize(image.y),
        width: quantize(image.width),
        height: quantize(image.height),
        ...(image.rotation !== undefined ? { rotation: quantize(image.rotation) } : {}),
      }));
    }
    if (page.texts && page.texts.length > 0) {
      out.texts = page.texts.slice(0, MAX_PAGE_TEXTS).map((item) => ({
        id: item.id,
        x: quantize(item.x),
        y: quantize(item.y),
        width: quantize(item.width),
        text: item.text,
        fontSize: quantize(item.fontSize),
        color: item.color,
        ...(item.align ? { align: item.align } : {}),
      }));
    }
    out.strokes = page.strokes.map((stroke) => {
      if (stroke.points.length > MAX_POINTS_PER_STROKE) throw new Error("单条笔迹采样点超出上限");
      totalPoints += stroke.points.length;
      return {
        id: stroke.id,
        tool: stroke.tool,
        color: stroke.color,
        width: stroke.width,
        points: stroke.points.map(serializePoint),
      };
    });
    totalStrokes += page.strokes.length;
    return out;
  });
  if (totalStrokes > MAX_TOTAL_STROKES || totalPoints > MAX_TOTAL_POINTS) {
    throw new Error("手写板笔迹或采样点超出上限");
  }
  const body = JSON.stringify({
    kind: INK_DOC_KIND,
    version: INK_DOC_VERSION,
    pages,
    ...(doc.sourcePdf
      ? { sourcePdf: { ...(doc.sourcePdf.name ? { name: doc.sourcePdf.name } : {}), pageCount: doc.sourcePdf.pageCount } }
      : {}),
  });
  if (body.length > MAX_INK_BODY_CHARS) throw new Error("手写板正文超过 16 MiB 上限");
  return body;
}

export function emptyInkBody(): string {
  return inkToBody(createInkDoc());
}

/**
 * 手写正文 → 可搜索文本（261104 二十一批）。
 *
 * 手写笔迹**不可搜**（无 OCR）；但 v4 的**页备注**（page.note）与**页内文字块**（page.texts）是文本，
 * 让它们进全文搜索：搜「第三章重点」能定位到那一页所在的文档。
 *
 * 快速路径：正文里既没有 note 也没有 texts 标记 ⇒ 直接返回空串（绝大多数手写板没写过备注，
 * 保存路径上零解析开销）；有标记才做一次完整解析（坏页按 parseInkBody 的规则丢，搜索只看到活下来的页）。
 */
export function inkToSearchText(content: string | null | undefined, maxChars = 20000): string {
  if (!content || content.length > MAX_INK_BODY_CHARS) return "";
  if (!content.includes('"note"') && !content.includes('"texts"')) return "";
  const doc = parseInkBody(content);
  if (!doc) return "";
  const parts: string[] = [];
  let length = 0;
  for (const page of doc.pages) {
    const chunks = [page.note, ...(page.texts ?? []).map((item) => item.text)];
    for (const chunk of chunks) {
      const text = (chunk ?? "").trim();
      if (!text) continue;
      parts.push(text);
      length += text.length + 1;
      if (length >= maxChars) return parts.join("\n").slice(0, maxChars);
    }
  }
  return parts.join("\n").slice(0, maxChars);
}

export function inkStrokePointCount(doc: InkDoc): number {
  return doc.pages.reduce((sum, page) => sum + page.strokes.reduce((n, stroke) => n + stroke.points.length, 0), 0);
}
