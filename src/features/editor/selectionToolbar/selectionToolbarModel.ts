/**
 * 浮动工具栏纯逻辑（定位 / active 态解析 / 图片尺寸档位）：不碰 DOM，便于单测。
 * 触发 = 文字选区 或 图片选中；两种形态由 SelectionToolbar.tsx 各自渲染。
 */
export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number; }

/** 浮框与锚点的间距 / 与视口边缘的最小留白（px）。 */
const TOOLBAR_GAP = 8;
export const TOOLBAR_MARGIN = 8;

export interface ToolbarPosition { left: number; top: number; placement: "above" | "below"; }

/** 锚点矩形 → 浮框左上角（视口坐标系，position: fixed）。空间不足翻到下方并做边缘钳制。 */
export function computeToolbarPosition(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  topLimit = TOOLBAR_MARGIN,
  allowBelow = true,
): ToolbarPosition {
  const rawAbove = anchor.top - size.height - TOOLBAR_GAP;
  // allowBelow=false：浮栏**只放在选区上方**（用户 261004：一直保持在上边、只随选区改位置）；
  // 上方放不下时由调用方收起浮栏，而不是翻到下方（下方档仍夹 topLimit，兜其它调用方）。
  const placement: "above" | "below" = !allowBelow || rawAbove >= topLimit ? "above" : "below";
  // 下方档必须夹 topLimit：选区被滚到顶部时 anchor.bottom 会落进/越过顶界（内核固定工具栏底边 /
  // 编辑区上沿），只按 anchor 定位会把浮栏甩到顶栏里（用户 261004 报「滚动后浮栏干到顶栏」）。
  const belowTop = Math.min(anchor.bottom + TOOLBAR_GAP, Math.max(TOOLBAR_MARGIN, viewport.height - size.height - TOOLBAR_MARGIN));
  const top = placement === "above"
    ? rawAbove
    : Math.max(topLimit, belowTop);
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

/** 内核 CommandState 枚举（bundle 实测：-1 Unavailable / 0 NotExecuted / 1 Executed / 2 Unknown）。
 *  块级命令（列表/待办/引用）的 checked/disabled 判据，与内核固定栏状态按钮同源。 */
export function isCommandExecuted(value: unknown): boolean { return value === 1; }
export function isCommandUnavailable(value: unknown): boolean { return value === -1; }

/** 背景色「无填充」的持久值（内核 bg-color descriptor 的 `transparent`）。 */
const TRANSPARENT_COLOR = "transparent";

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
const IMAGE_SIZE_SCALES = { small: 0.3, medium: 0.5, large: 0.8 } as const;
export type ImageSizePreset = "small" | "medium" | "large" | "original";
export function imageSizeWidth(preset: ImageSizePreset, originalWidth: number): number {
  const base = Number.isFinite(originalWidth) && originalWidth > 0 ? originalWidth : 320;
  if (preset === "original") return Math.max(1, Math.round(base));
  return Math.max(16, Math.round(base * IMAGE_SIZE_SCALES[preset]));
}

export interface SelectionRect { left: number; top: number; width: number; height: number; lineHeight?: number }

/**
 * 把 `Range.getClientRects()` 的**字形盒**矩形还原成内核原生选区的**行盒**。
 *
 * 内核选区由浏览器按行盒绘制，而 getClientRects 给的是字形盒 ⇒ 不撑开就比原生矮一截、行间露缝
 * （用户 261004：「行间距没处理，前后效果不同」）。
 * 做法：每个矩形垂直居中撑到**它自己那一行**的行高（`SelectionRect.lineHeight`，逐片段取，
 * 标题/列表/正文行高不同）→ 按**垂直中心**分组（同一行只保留一个行盒）→ 水平取并集。
 *
 * ⚠️ 分组判据必须是**中心**而不是「矩形相交」：撑开后相邻行首尾相接，用相交会把 2~4 行并成一大块。
 * ⚠️ 这是复刻原生观感的唯一口径：CSS Custom Highlight API（`::highlight()`）在 Chromium 里只画
 *    字形盒，撑不到行盒高度。
 */
export function lineBoxRects(rects: readonly SelectionRect[], defaultLineHeight: number): SelectionRect[] {
  const fallback = Number.isFinite(defaultLineHeight) && defaultLineHeight > 0 ? defaultLineHeight : 0;
  const lhOf = (r: SelectionRect) => { const v = r.lineHeight ?? fallback; return Number.isFinite(v) && v > 0 ? v : 0; };
  if (rects.every((r) => lhOf(r) === 0)) return rects.map((r) => ({ ...r }));
  const expanded = rects.map((r) => {
    const lh = lhOf(r);
    const height = Math.max(r.height, lh);
    // natural 记住原始高度：行盒顶端要取**原始最高**的那个（通常是行盒/块盒），而不是撑开后同高的任意一个
    return { left: r.left, top: r.top - (height - r.height) / 2, width: r.width, height, lh, natural: r.height };
  });
  const center = (r: { top: number; height: number }) => r.top + r.height / 2;
  const groups: typeof expanded[] = [];
  for (const r of expanded.slice().sort((a, b) => center(a) - center(b))) {
    // 同一行：中心相差不到「两者行高的一半」；相邻行相差一个行高 ⇒ 不会串行
    const group = groups.find((g) => Math.abs(center(g[0]) - center(r)) < Math.max(r.lh, g[0].lh) * 0.5);
    if (group) group.push(r); else groups.push([r]);
  }
  return groups.map((g) => {
    const left = Math.min(...g.map((r) => r.left));
    const right = Math.max(...g.map((r) => r.left + r.width));
    const anchor = g.reduce((best, r) => (r.natural > best.natural ? r : best), g[0]);
    return { left, top: anchor.top, width: right - left, height: anchor.height };
  });
}

/** 从 canonical 资源 URL 解析 {noteId, filename}；解析不到返回 null（data:/外链 不支持复制下载）。 */
export function parseAssetRef(src: string): { noteId: string; filename: string } | null {
  const m = /\/([0-9a-fA-F-]{36})\/([^/?#]+)(?:[?#]|$)/.exec(src);
  if (!m) return null;
  try { return { noteId: m[1], filename: decodeURIComponent(m[2]) }; } catch { return { noteId: m[1], filename: m[2] }; }
}
