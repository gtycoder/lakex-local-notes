/**
 * 浮动工具栏纯逻辑（定位 / active 态解析 / 图片尺寸档位）：不碰 DOM，便于单测。
 * 触发 = 文字选区 或 图片选中；两种形态由 SelectionToolbar.tsx 各自渲染。
 */
export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number; }

/** 浮框与锚点的间距 / 与视口边缘的最小留白（px）。 */
export const TOOLBAR_GAP = 8;
export const TOOLBAR_MARGIN = 8;

export interface ToolbarPosition { left: number; top: number; placement: "above" | "below"; }

/** 锚点矩形 → 浮框左上角（视口坐标系，position: fixed）。空间不足翻到下方并做边缘钳制。 */
export function computeToolbarPosition(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  topLimit = TOOLBAR_MARGIN,
): ToolbarPosition {
  const rawAbove = anchor.top - size.height - TOOLBAR_GAP;
  const placement: "above" | "below" = rawAbove >= topLimit ? "above" : "below";
  const top = placement === "above"
    ? rawAbove
    : Math.min(anchor.bottom + TOOLBAR_GAP, Math.max(TOOLBAR_MARGIN, viewport.height - size.height - TOOLBAR_MARGIN));
  const centered = anchor.left + anchor.width / 2 - size.width / 2;
  const maxLeft = Math.max(TOOLBAR_MARGIN, viewport.width - size.width - TOOLBAR_MARGIN);
  const left = Math.min(Math.max(centered, TOOLBAR_MARGIN), maxLeft);
  return { left, top, placement };
}

/** queryCommandValue 可能返回数组（多节点选区）：
 *  • `[true]` / `["true"]` = 生效；`[null]` / `[]` = 未生效；
 *  • 也可能直接返回 true / false / 1 / "true" / "1"。
 * （实测：String([true]) === "true" 会骗过标量判断，故必须单独解数组。） */
export function unwrapValue(value: unknown): unknown {
  return Array.isArray(value) ? (value.length > 0 ? value[0] : undefined) : value;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}

/** 内核 queryCommandValue 的 active 判定（标量或数组皆可）。 */
export function isMarkActive(value: unknown): boolean {
  return Array.isArray(value) ? value.some(truthy) : truthy(value);
}

/** 背景色「无填充」的持久值（内核 bg-color descriptor 的 `transparent`）。 */
export const TRANSPARENT_COLOR = "transparent";

/**
 * 颜色「本体」点击后的内核命令决策（对齐 kernel *-toolbar-descriptor 的 onEvent('select')）：
 *   - 文字色：所选视觉值 == 正文色(`editor.text.color`) ⇒ clearColor；否则 color(持久值)；
 *   - 背景色：持久值空/transparent ⇒ clearBgColor；已等于当前选区 bgColor ⇒ clearBgColor（再次点击取消）；否则 bgColor(持久值)。
 * 纯函数便于单测；命令实际执行由调用方 `run`。
 */
export function colorApplyCommand(
  variant: "text" | "bg",
  input: { visual: string; persistent: unknown; normalText: string; currentBg?: unknown },
): { command: string; arg?: unknown } {
  if (variant === "text") {
    return input.visual === input.normalText
      ? { command: "clearColor" }
      : { command: "color", arg: input.persistent };
  }
  if (!input.persistent || input.persistent === TRANSPARENT_COLOR) return { command: "clearBgColor" };
  return input.persistent === input.currentBg
    ? { command: "clearBgColor" }
    : { command: "bgColor", arg: input.persistent };
}

/** 字号 active：queryCommandValue('fontsize') 返回 px 数值或 "null"。 */
export function toFontSize(value: unknown): number | null {
  if (value === null || value === undefined || value === "null" || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 图片尺寸档位：按原图宽度取比例（小/中/大），原始 = 原宽。 */
export const IMAGE_SIZE_SCALES = { small: 0.3, medium: 0.5, large: 0.8 } as const;
export type ImageSizePreset = "small" | "medium" | "large" | "original";
export function imageSizeWidth(preset: ImageSizePreset, originalWidth: number): number {
  const base = Number.isFinite(originalWidth) && originalWidth > 0 ? originalWidth : 320;
  if (preset === "original") return Math.max(1, Math.round(base));
  return Math.max(16, Math.round(base * IMAGE_SIZE_SCALES[preset]));
}

/** 从 canonical 资源 URL 解析 {noteId, filename}；解析不到返回 null（data:/外链 不支持复制下载）。 */
export function parseAssetRef(src: string): { noteId: string; filename: string } | null {
  const m = /\/([0-9a-fA-F-]{36})\/([^/?#]+)(?:[?#]|$)/.exec(src);
  if (!m) return null;
  try { return { noteId: m[1], filename: decodeURIComponent(m[2]) }; } catch { return { noteId: m[1], filename: m[2] }; }
}
