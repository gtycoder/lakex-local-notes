/**
 * 画板文档（kind="board"）正文模型。
 *
 * 独立画板 = 一个文档一张无限画布，**不挂 Lake 内核**：
 * - 引擎来自 `lakex-drawnix`（plait-board/drawnix 的 MIT 抽取）+ `@plait/*`；编辑器是 vendor 的
 *   `DrawnixBoardCore`，它只吃 `{ value, readOnly, locale, theme, ai, onChange }`，运行时不 import 内核
 *   （卡片层的 CardResizer / editor 上下文在独立文档里都不需要）。
 * - 正文落 `boards/{id}.board.json`：与 `sheets/` `bitables/` 同构，是内部 JSON，**不喂 Lake 解析器**。
 * - `elements` 就是文档内画板卡（`cards/DrawingBoard`）的 `plaitValue`，所以
 *   「文档内画板卡 ↔ 独立画板文档」可无损互搬，无需任何格式转换。
 *
 * 与卡片值（`IDrawingBoardCardValue`）的差异：卡片为了 HTML 渲染/剪贴板会额外持久化
 * `previewImage`（整幅 PNG data URL，实测占文档体积 90%+）与 `cardHeight`；独立文档不需要，
 * 只存场景 + 视口。
 */

/** 起始模板（与卡片 preset 同一套取值）。`drawing` = 空白画布。 */
export type BoardPreset = "drawing" | "flowchart" | "uml" | "mindmap";

/** 视口 = Plait 的 `{ x, y, zoom }`（仅视图状态，不影响内容）。 */
export interface BoardViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface BoardDoc {
  kind: "board";
  version: 1;
  engine: "drawnix";
  preset: BoardPreset;
  /** 起始模板是否已落地（与卡片 `presetInitialized` 同义，防清空画布后重开又长出模板）。 */
  presetInitialized?: boolean;
  /** Plait 场景树（Drawnix 的 elements）。保持 unknown[]：core 不依赖 @plait/* 类型。 */
  elements: unknown[];
  /**
   * 视口；缺失/非法 = 打开时自适应。
   *
   * **历史字段，宿主已不再写入**（260926 B）：视图（平移位置 / 缩放）改由本机记忆承担
   * （`src/features/board/boardViewStore.ts`，L3 设备本地）——写正文会让缩放/平移把文档标脏
   * 并触发同步上传。桌面打开时只把它当**兜底**（本机记忆没有时才用），移动端只读查看器
   * 仍按「没有视口就 fit 内容」工作。
   */
  viewport?: BoardViewport | null;
}

/** 正文里的类型判别字段（与旧库/坏数据区分）。 */
export const BOARD_BODY_KIND = "board" as const;

export function normalizeBoardPreset(value: unknown): BoardPreset {
  return value === "flowchart" || value === "uml" || value === "mindmap" ? value : "drawing";
}

function normalizeViewport(value: unknown): BoardViewport | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const zoom = Number(raw.zoom);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) return null;
  if (zoom <= 0) return null;
  return { x, y, zoom };
}

export function createBoardDoc(preset: BoardPreset = "drawing"): BoardDoc {
  return {
    kind: BOARD_BODY_KIND,
    version: 1,
    engine: "drawnix",
    preset: normalizeBoardPreset(preset),
    elements: [],
    viewport: null,
  };
}

export function emptyBoardBody(): string {
  return boardToBody(createBoardDoc("drawing"));
}

/**
 * 正文 → BoardDoc（归一化，**不抛错**）：坏数据/空正文当作空白画板打开，避免打不开。
 * 兼容 `elements` 与卡片序列化里的 `plaitValue` 两种键名。
 */
export function parseBoardBody(content: string | null | undefined): BoardDoc {
  if (!content) return createBoardDoc();
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return createBoardDoc();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return createBoardDoc();
  const record = raw as Record<string, unknown>;
  const elements = Array.isArray(record.elements)
    ? (record.elements as unknown[])
    : Array.isArray(record.plaitValue)
      ? (record.plaitValue as unknown[])
      : [];
  const doc: BoardDoc = {
    kind: BOARD_BODY_KIND,
    version: 1,
    engine: "drawnix",
    preset: normalizeBoardPreset(record.preset),
    elements,
    viewport: normalizeViewport(record.viewport ?? record.plaitViewport),
  };
  if (record.presetInitialized === true) doc.presetInitialized = true;
  return doc;
}

/** 序列化（稳定字段顺序：kind → version → engine → preset → … → elements → viewport）。 */
export function boardToBody(doc: BoardDoc): string {
  const out: Record<string, unknown> = {
    kind: BOARD_BODY_KIND,
    version: 1,
    engine: "drawnix",
    preset: normalizeBoardPreset(doc.preset),
  };
  if (doc.presetInitialized) out.presetInitialized = true;
  out.elements = Array.isArray(doc.elements) ? doc.elements : [];
  const viewport = normalizeViewport(doc.viewport);
  if (viewport) out.viewport = viewport;
  return JSON.stringify(out);
}

/** 画板卡（文档内）的序列化形态 → BoardDoc：用于「卡片 ↔ 独立画板文档」互搬。 */
export function boardDocFromCardValue(value: unknown): BoardDoc {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const doc = createBoardDoc(normalizeBoardPreset(record.preset));
  doc.elements = Array.isArray(record.plaitValue) ? (record.plaitValue as unknown[]) : [];
  doc.viewport = normalizeViewport(record.plaitViewport);
  if (record.presetInitialized === true) doc.presetInitialized = true;
  return doc;
}

/** 独立画板文档 → 画板卡片值（worker 只产出内核认得的字段，不带独立文档自己的 kind/version）。 */
export function cardValueFromBoardDoc(doc: BoardDoc): Record<string, unknown> {
  const out: Record<string, unknown> = {
    version: 2,
    engine: "drawnix",
    preset: normalizeBoardPreset(doc.preset),
    plaitValue: Array.isArray(doc.elements) ? doc.elements : [],
  };
  if (doc.presetInitialized) out.presetInitialized = true;
  const viewport = normalizeViewport(doc.viewport);
  if (viewport) out.plaitViewport = viewport;
  return out;
}

/** 搜索文本：场景树里的文字（图形标签 / 文本块 / 思维导图节点 / 连接线标签）。 */
function collectElementText(node: unknown, out: string[], depth: number): void {
  if (!node || depth > 16 || out.length > 2000) return;
  if (Array.isArray(node)) {
    for (const item of node) collectElementText(item, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === "string") {
      if (key === "text" || key === "label" || key === "title" || key === "content") {
        const trimmed = value.trim();
        if (trimmed) out.push(trimmed);
      }
      continue;
    }
    if (value && typeof value === "object") collectElementText(value, out, depth + 1);
  }
}

/**
 * 正文 → 搜索/缓存用纯文本（`store.searchTextFor` 的 board 分支）。
 * 空画布返回空串（搜索只命中标题）。
 */
export function boardToSearchText(content: string | null | undefined, maxChars = 20000): string {
  const doc = parseBoardBody(content);
  const parts: string[] = [];
  collectElementText(doc.elements, parts, 0);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.slice(0, maxChars);
}
