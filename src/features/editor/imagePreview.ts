/**
 * 图片放大预览控制器（Lake envAdapter.previewImgs → 共享 Lightbox）。
 *
 * Lake 图片卡片点击时（allowClickToMaximize）派发 previewImgs 事件，
 * payload 为文档内全部图片数组 + 当前索引（天然画廊）。本控制器是模块级
 * 单例 pub/sub：lakeRuntime 的 envAdapter 调 open()，ImageLightbox 订阅渲染，
 * 无需经过 React props 层层传递（桌面/移动端共用同一套）。
 */

import { parseLocalAssetUrl } from "../../core/assetUrl.js";

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

/** 预览用的图片身份键：本地资产只比**磁盘名**（正文里没带访问令牌、DOM 里带了），其余比去 query/hash 的原串。 */
export function previewImageKey(src: string): string {
  const ref = parseLocalAssetUrl(src);
  if (ref?.filename) return ref.filename;
  return src.split("?")[0].split("#")[0];
}

/**
 * 从 Lake 正文按**文档顺序**取出全部图片（内核产出的 image 卡片 + 裸 <img>）。
 *
 * 为什么不能用 DOM 收集：编辑态开了虚拟渲染 + cardLazyInit，视口外的卡片**根本不在 DOM 里**，
 * 于是「文档 10 张图，预览只数到 2 张、左右切不过去」（用户 260928 实测复现）。
 * 内核这个构建里 allowClickToMaximize 无效、拿不到 previewImgs 回调，正文才是权威列表。
 * 不去重：同一张图在文中出现两次就该有两张可切（DOM 顺序与正文顺序同序）。
 */
export function extractImagesFromContent(content: string): PreviewImage[] {
  if (!content) return [];
  const out: PreviewImage[] = [];
  const push = (src: string) => {
    const clean = src.trim();
    if (clean) out.push({ src: clean });
  };
  // ① 内核产出的图片卡片：<card ... name="image" ... value="data:{encodeURIComponent(JSON)}">
  for (const tag of content.match(/<card\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*"image"/i.test(tag)) continue;
    const value = /\bvalue\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (!value) continue;
    let raw = value.startsWith("data:") ? value.slice(5) : value;
    try { raw = decodeURIComponent(raw); } catch { /* 原样解析 */ }
    try {
      const data = JSON.parse(raw) as { src?: unknown };
      if (typeof data.src === "string") push(data.src);
    } catch { push(raw); }   // 值本身就是 URL 的旧形态
  }
  // ② 裸 <img>（历史/异常形态；内核会把它当远程图改写，这里只保证预览不缺图）
  for (const tag of content.match(/<img\b[^>]*>/gi) ?? []) {
    const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (src) push(src);
  }
  return out;
}

/**
 * 给编辑器宿主挂图片双击放大预览监听（桌面 EditorTab / 共享 LakeEditor 共用）。
 * - **双击**触发（用户确认：单击留给选中/改图片大小，单击预览太容易误触）；
 *   捕获阶段监听 dblclick（不 preventDefault，Lake 行为照常）。
 * - `resolveImages` 提供**权威全量列表**（正文解析的），DOM 只用来定位"双击的是哪一张"：
 *   DOM 图片是正文列表的一个**子序列**（虚拟渲染只渲染视口内），按顺序贪心对齐即可，
 *   同一张图出现两次也不会跳错；解析不到或不给 resolver 时回退旧的 DOM 收集。
 * - 返回清理函数（组件卸载时移除）。
 */
export function attachImagePreviewClick(host: HTMLElement, resolveImages?: () => PreviewImage[]): () => void {
  const onDoubleClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;
    const img = target.closest("img.ne-image") as HTMLImageElement | null;
    if (!img || !host.contains(img)) return;
    const elements = Array.from(host.querySelectorAll<HTMLImageElement>("img.ne-image"));
    const domIndex = elements.indexOf(img);
    const fallback = () => {
      if (elements.length === 0) return;
      const i = domIndex < 0 ? 0 : domIndex;
      openImagePreview(elements.map((el) => ({ src: el.currentSrc || el.src })), i);
    };
    const resolved = resolveImages?.() ?? [];
    if (resolved.length === 0) { fallback(); return; }
    let index = -1;
    let cursor = 0;
    for (let i = 0; i <= domIndex; i += 1) {
      const key = previewImageKey(elements[i].currentSrc || elements[i].src);
      let found = -1;
      for (let j = cursor; j < resolved.length; j += 1) {
        if (previewImageKey(resolved[j].src) === key) { found = j; break; }
      }
      if (found >= 0) { cursor = found + 1; if (i === domIndex) index = found; }
    }
    openImagePreview(resolved, index < 0 ? 0 : index);
  };
  host.addEventListener("dblclick", onDoubleClick, true);
  return () => host.removeEventListener("dblclick", onDoubleClick, true);
}
