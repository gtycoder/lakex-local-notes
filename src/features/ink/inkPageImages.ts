/**
 * 页内贴图（v4 `page.images`）的最小操作集（261104 二十一批）。
 *
 * 全部是**纯函数**：不碰 DOM、不读盘，便于单测，也让 InkPad 只关心指针态机。
 * 用户定稿（261104）：插入 = 按原图比例缩到**页宽 40%**、居中；之后再拖动/缩放。
 */
import type { InkPage, InkPageImage } from "../../core/inkDoc.js";

/** 插入默认宽度 = 页宽 × 0.4（用户定稿）。 */
export const INK_IMAGE_DEFAULT_WIDTH_RATIO = 0.4;
/** 最小边长（逻辑 px）：再小就点不中了。 */
export const INK_IMAGE_MIN_EDGE = 24;
/** 拖动时至少留这么多在页内，避免「拖出去找不回来」。 */
const INK_IMAGE_KEEP_VISIBLE = 40;

export interface InkImagePlacementInput {
  id: string;
  url: string;
  /** 原图像素尺寸（读不到就按 4:3 估）。 */
  naturalWidth?: number;
  naturalHeight?: number;
}

/** 按页面尺寸算出插入位置与大小：页宽 40%、保持原图比例、居中。 */
export function placeInkPageImage(page: Pick<InkPage, "width" | "height">, input: InkImagePlacementInput): InkPageImage {
  const naturalWidth = input.naturalWidth && input.naturalWidth > 0 ? input.naturalWidth : 4;
  const naturalHeight = input.naturalHeight && input.naturalHeight > 0 ? input.naturalHeight : 3;
  const width = Math.max(INK_IMAGE_MIN_EDGE, Math.round(page.width * INK_IMAGE_DEFAULT_WIDTH_RATIO * 100) / 100);
  const height = Math.max(INK_IMAGE_MIN_EDGE, Math.round((width * (naturalHeight / naturalWidth)) * 100) / 100);
  return {
    id: input.id,
    url: input.url,
    x: Math.round((page.width - width) / 2 * 100) / 100,
    y: Math.round((page.height - height) / 2 * 100) / 100,
    width,
    height,
  };
}

/** 命中测试：返回最上层的贴图 id（后画的在上），没有命中返回 null。 */
export function hitTestPageImage(page: Pick<InkPage, "images">, point: { x: number; y: number }): string | null {
  const images = page.images ?? [];
  for (let index = images.length - 1; index >= 0; index -= 1) {
    const image = images[index];
    if (point.x >= image.x && point.x <= image.x + image.width && point.y >= image.y && point.y <= image.y + image.height) {
      return image.id;
    }
  }
  return null;
}

/** 移动（拖动落地时调用）：位移后仍保证至少一段留在页内。 */
export function movePageImage(page: InkPage, id: string, dx: number, dy: number): InkPageImage[] | null {
  const images = page.images ?? [];
  const target = images.find((image) => image.id === id);
  if (!target) return null;
  const x = clamp(target.x + dx, -(target.width - INK_IMAGE_KEEP_VISIBLE), page.width - INK_IMAGE_KEEP_VISIBLE);
  const y = clamp(target.y + dy, -(target.height - INK_IMAGE_KEEP_VISIBLE), page.height - INK_IMAGE_KEEP_VISIBLE);
  return images.map((image) => (image.id === id ? { ...image, x: round2(x), y: round2(y) } : image));
}

/** 缩放（以左上角为锚点，保持宽高比）：最小边 24。 */
export function resizePageImage(page: InkPage, id: string, scale: number): InkPageImage[] | null {
  const images = page.images ?? [];
  const target = images.find((image) => image.id === id);
  if (!target) return null;
  const width = Math.max(INK_IMAGE_MIN_EDGE, round2(target.width * scale));
  const height = Math.max(INK_IMAGE_MIN_EDGE, round2(target.height * scale));
  const x = Math.min(target.x, page.width - INK_IMAGE_KEEP_VISIBLE);
  return images.map((image) => (image.id === id ? { ...image, x: round2(x), width, height } : image));
}

/** 删除一张贴图（空数组 = 删除整个字段，避免留下 `images: []`）。 */
export function removePageImage(page: InkPage, id: string): InkPageImage[] {
  return (page.images ?? []).filter((image) => image.id !== id);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
