/**
 * 图片放大预览控制器（Lake envAdapter.previewImgs → 共享 Lightbox）。
 *
 * Lake 图片卡片点击时（allowClickToMaximize）派发 previewImgs 事件，
 * payload 为文档内全部图片数组 + 当前索引（天然画廊）。本控制器是模块级
 * 单例 pub/sub：lakeRuntime 的 envAdapter 调 open()，ImageLightbox 订阅渲染，
 * 无需经过 React props 层层传递（桌面/移动端共用同一套）。
 */

export interface PreviewImage {
  /** 显示用 src（桌面/移动端 canonical URL，均可直接 <img>） */
  src: string;
  /** 预览小图（Lake payload 提供，非必需） */
  msrc?: string;
  w?: number;
  h?: number;
  size?: number;
  [key: string]: unknown;
}

export interface ImagePreviewState {
  images: PreviewImage[];
  index: number;
}

type Listener = (state: ImagePreviewState | null) => void;

let current: ImagePreviewState | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) {
    try { l(current); } catch { /* 渲染层异常不影响其他订阅者 */ }
  }
}

/** 打开预览（index 越界收敛到 0）。 */
export function openImagePreview(images: PreviewImage[], index: number): void {
  if (!Array.isArray(images) || images.length === 0) return;
  const i = Number.isFinite(index) ? Math.max(0, Math.min(images.length - 1, Math.floor(index))) : 0;
  current = { images, index: i };
  emit();
}

export function closeImagePreview(): void {
  current = null;
  emit();
}

/** 画廊导航（+1/-1，越界不循环——画廊语义保持顺序浏览）。 */
export function navigateImagePreview(delta: number): void {
  if (!current) return;
  const next = current.index + delta;
  if (next < 0 || next >= current.images.length) return;
  current = { ...current, index: next };
  emit();
}

export function subscribeImagePreview(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 给编辑器宿主挂图片双击放大预览监听（桌面 EditorTab / 共享 LakeEditor 共用）。
 * - **双击**触发（用户确认：单击留给选中/改图片大小，单击预览太容易误触）；
 *   捕获阶段监听 dblclick（不 preventDefault，Lake 行为照常）。
 * - 收集宿主内全部图片（画廊），双击的图定位到当前索引。
 * - 返回清理函数（组件卸载时移除）。
 */
export function attachImagePreviewClick(host: HTMLElement): () => void {
  const onDoubleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;
    const img = target.closest("img.ne-image") as HTMLImageElement | null;
    if (!img || !host.contains(img)) return;
    const images = Array.from(host.querySelectorAll<HTMLImageElement>("img.ne-image"))
      .map((el) => ({ src: el.currentSrc || el.src }));
    if (images.length === 0) return;
    const index = images.findIndex((im) => im.src === img.src);
    openImagePreview(images, index < 0 ? 0 : index);
  };
  host.addEventListener("dblclick", onDoubleClick, true);
  return () => host.removeEventListener("dblclick", onDoubleClick, true);
}
