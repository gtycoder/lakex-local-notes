/**
 * 手写板文档（kind="ink"）正文模型。
 *
 * 只存**矢量笔迹**：页面、背景模板、笔迹点和笔刷参数。PNG 仅用于缩略图/导出，永不作为正文。
 * 页面坐标统一为 A4 96dpi 逻辑尺寸（794 × 1123），桌面与移动端按容器缩放显示。
 */
export const INK_DOC_KIND = "ink" as const;
export const INK_DOC_VERSION = 1 as const;
export const INK_PAGE_WIDTH = 794;
export const INK_PAGE_HEIGHT = 1123;
export const MAX_INK_BODY_CHARS = 16 * 1024 * 1024;

export const INK_BACKGROUNDS = ["blank", "lined", "grid", "dot"] as const;
export type InkBackground = (typeof INK_BACKGROUNDS)[number];

export const INK_TOOLS = ["pen", "highlighter"] as const;
export type InkTool = (typeof INK_TOOLS)[number];

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
  strokes: InkStroke[];
}

export interface InkDoc {
  kind: typeof INK_DOC_KIND;
  version: typeof INK_DOC_VERSION;
  pages: InkPage[];
  activePageId?: string;
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
  return { id: record.id, width, height, background: record.background, strokes };
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
  if (record.kind !== INK_DOC_KIND || record.version !== INK_DOC_VERSION) return null;
  if (!Array.isArray(record.pages) || record.pages.length === 0 || record.pages.length > MAX_PAGES) return null;
  const pages: InkPage[] = [];
  const ids = new Set<string>();
  let totalStrokes = 0;
  let totalPoints = 0;
  for (const rawPage of record.pages) {
    const page = normalizePage(rawPage);
    if (!page || ids.has(page.id)) return null;
    totalStrokes += page.strokes.length;
    totalPoints += page.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
    if (totalStrokes > MAX_TOTAL_STROKES || totalPoints > MAX_TOTAL_POINTS) return null;
    ids.add(page.id);
    pages.push(page);
  }
  const activePageId = typeof record.activePageId === "string" && ids.has(record.activePageId)
    ? record.activePageId
    : pages[0].id;
  return { kind: INK_DOC_KIND, version: INK_DOC_VERSION, pages, activePageId };
}

/** 稳定字段顺序，便于 hash / diff / S3 对象复用。 */
export function inkToBody(doc: InkDoc): string {
  const pages = doc.pages.map((page) => ({
    id: page.id,
    width: page.width,
    height: page.height,
    background: page.background,
    strokes: page.strokes.map((stroke) => ({
      id: stroke.id,
      tool: stroke.tool,
      color: stroke.color,
      width: stroke.width,
      points: stroke.points.map((point) => {
        const out: Record<string, number> = { x: point.x, y: point.y, pressure: point.pressure };
        if (point.t !== undefined) out.t = point.t;
        return out;
      }),
    })),
  }));
  const activePageId = doc.activePageId && pages.some((page) => page.id === doc.activePageId)
    ? doc.activePageId
    : pages[0]?.id;
  return JSON.stringify({
    kind: INK_DOC_KIND,
    version: INK_DOC_VERSION,
    pages,
    ...(activePageId ? { activePageId } : {}),
  });
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
