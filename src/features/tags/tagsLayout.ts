/**
 * 标签空间三栏布局的**纯逻辑**（261105 用户验收：三栏要可拖、宽度设备本地持久化）。
 *
 * 布局：[左目录][handle][中聚合 1fr][handle][右预览]
 * - 左栏 200–480，右栏 240–720，中栏自适应且最小 360；
 * - 窗口过窄（< 三栏最小宽 + 两条 handle）⇒ **退化为固定比例**（不出现负宽/横滚，隐藏 handle）；
 * - 宽度存 localStorage（设备本地，前缀沿用 lakex-local-notes-v3.*），坏值/越界一律回默认。
 *
 * 本文件零 IO、零 DOM：读写 localStorage 的动作在组件里（writeLocalStorage/parse 只用这里的函数）。
 */

export const TAG_DIR_MIN = 200;
export const TAG_DIR_MAX = 480;
export const TAG_PREVIEW_MIN = 240;
export const TAG_PREVIEW_MAX = 720;
export const TAG_AGG_MIN = 360;
/** 两条分隔条占的栅格宽度（每条 5px；窄窗退化时会隐藏）。 */
export const TAG_HANDLE_WIDTH = 5;
export const TAG_HANDLE_TOTAL = TAG_HANDLE_WIDTH * 2;

export const TAG_DIR_DEFAULT = 260;
export const TAG_PREVIEW_DEFAULT = 380;

/** 设备本地键（与侧栏/大纲宽度同前缀；不进同步、不进 git）。 */
export const TAG_LAYOUT_STORAGE_KEY = "lakex-local-notes-v3.tag-space-layout";

export interface TagSpaceWidths {
  /** 左目录栏（px）。 */
  dir: number;
  /** 右预览栏（px）。 */
  preview: number;
}

export const TAG_LAYOUT_DEFAULTS: TagSpaceWidths = { dir: TAG_DIR_DEFAULT, preview: TAG_PREVIEW_DEFAULT };

/** 三栏最小宽 + 两条 handle = 可拖布局的容器下限；低于它就退化为固定比例。 */
export const TAG_LAYOUT_MIN_CONTAINER = TAG_DIR_MIN + TAG_AGG_MIN + TAG_PREVIEW_MIN + TAG_HANDLE_TOTAL;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 左栏宽度夹取（同时保证中栏 ≥ TAG_AGG_MIN、右栏 ≥ 自身当前宽）：
 * 上界 = min(480, 容器 - 右栏 - 中栏最小 - handle 总宽)。容器未知（0）时只做 200–480 的静态夹取。
 */
export function clampTagDirWidth(raw: number, containerWidth: number, previewWidth: number): number {
  const value = finite(raw) ?? TAG_DIR_DEFAULT;
  let upper = TAG_DIR_MAX;
  if (containerWidth > 0) {
    upper = Math.min(TAG_DIR_MAX, containerWidth - previewWidth - TAG_AGG_MIN - TAG_HANDLE_TOTAL);
  }
  upper = Math.max(TAG_DIR_MIN, upper);
  return Math.round(Math.max(TAG_DIR_MIN, Math.min(upper, value)));
}

/** 右预览栏宽度夹取（同时保证中栏 ≥ TAG_AGG_MIN、左栏 ≥ 自身当前宽）。 */
export function clampTagPreviewWidth(raw: number, containerWidth: number, dirWidth: number): number {
  const value = finite(raw) ?? TAG_PREVIEW_DEFAULT;
  let upper = TAG_PREVIEW_MAX;
  if (containerWidth > 0) {
    upper = Math.min(TAG_PREVIEW_MAX, containerWidth - dirWidth - TAG_AGG_MIN - TAG_HANDLE_TOTAL);
  }
  upper = Math.max(TAG_PREVIEW_MIN, upper);
  return Math.round(Math.max(TAG_PREVIEW_MIN, Math.min(upper, value)));
}

/** 解析持久化值：只认 { dir, preview } 两个有限正数；其余（坏 JSON/缺字段/负数）⇒ null 用默认。 */
export function parseStoredTagLayout(raw: string | null | undefined): TagSpaceWidths | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as { dir?: unknown; preview?: unknown };
    const dir = finite(parsed?.dir);
    const preview = finite(parsed?.preview);
    if (dir === null || preview === null || dir <= 0 || preview <= 0) return null;
    return { dir, preview };
  } catch {
    return null;
  }
}

/** 序列化（只存两个数字，避免把别的东西写进设备本地）。 */
export function serializeTagLayout(widths: TagSpaceWidths): string {
  return JSON.stringify({
    dir: Math.round(widths.dir),
    preview: Math.round(widths.preview),
  });
}

/** 容器是否够宽到能拖（不够 ⇒ 固定比例兜底，隐藏 handle）。 */
export function isTagSpaceResizable(containerWidth: number): boolean {
  return Number.isFinite(containerWidth) && containerWidth >= TAG_LAYOUT_MIN_CONTAINER;
}

export interface TagSpaceColumns {
  /** split = 可拖的固定像素 + 中栏 1fr；fallback = 固定比例（窄窗）。 */
  mode: "split" | "fallback";
  /** split 模式的 grid-template-columns 值（px + 1fr）；fallback 为 null（由 CSS 类给比例）。 */
  templateColumns: string | null;
  /** 下面两个宽度是**夹取后**的值（fallback 时也给出，便于 aria-valuenow）。 */
  dir: number;
  preview: number;
}

/**
 * 根据容器宽度与当前宽度求最终栅格：
 * - 够宽 ⇒ split（左/右固定 px、中栏 minmax(360px,1fr)）；
 * - 过窄 ⇒ fallback（返回夹取后的值但 templateColumns=null，CSS 用比例模板 + 隐藏 handle）。
 */
export function resolveTagColumns(containerWidth: number, widths: TagSpaceWidths): TagSpaceColumns {
  if (!isTagSpaceResizable(containerWidth)) {
    return {
      mode: "fallback",
      templateColumns: null,
      dir: clampTagDirWidth(widths.dir, 0, widths.preview),
      preview: clampTagPreviewWidth(widths.preview, 0, widths.dir),
    };
  }
  // 先按静态区间夹右栏，再夹左栏（给中栏/右栏留位），最后按左栏结果复核右栏——
  // 这样两端都超界时也能收敛到「左 ≤480、右 ≤720、中栏 ≥360」而不是互相挤成最小值。
  const previewFirst = clampTagPreviewWidth(widths.preview, 0, 0);
  const dir = clampTagDirWidth(widths.dir, containerWidth, previewFirst);
  const preview = clampTagPreviewWidth(previewFirst, containerWidth, dir);
  return {
    mode: "split",
    templateColumns: `${dir}px ${TAG_HANDLE_WIDTH}px minmax(${TAG_AGG_MIN}px, 1fr) ${TAG_HANDLE_WIDTH}px ${preview}px`,
    dir,
    preview,
  };
}
