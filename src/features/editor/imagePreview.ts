/**
 * 图片放大预览控制器（Lake envAdapter.previewImgs → 共享 Lightbox）。
 *
 * Lake 图片卡片点击时（allowClickToMaximize）派发 previewImgs 事件，
 * payload 为文档内全部图片数组 + 当前索引（天然画廊）。本控制器是模块级
 * 单例 pub/sub：lakeRuntime 的 envAdapter 调 open()，ImageLightbox 订阅渲染，
 * 无需经过 React props 层层传递（桌面/移动端共用同一套）。
 */

import { trackImmersivePreview } from "../../lib/immersivePreview";
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
  trackImmersivePreview("image", closeImagePreview);
  emit();
}

export function closeImagePreview(): void {
  current = null;
  trackImmersivePreview("image", null);
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

export interface AttachImagePreviewOptions {
  /**
   * 触发方式（261112 用户定稿：**点击看图片、双击编辑**）：
   * - `"dblclick"`（默认，桌面）：单击留给选中/改尺寸，双击看大图；
   * - `"tap"`（移动端）：**单击看大图**（判定窗内、几乎同一点再按下 = 双击 ⇒ 取消预览、
   *   交给宿主/内核做「编辑」）。判据挂在 `pointerdown` 上，见下方常量注释。
   */
  tap?: boolean;
}

/**
 * 触屏「单击 vs 双击」判定窗（ms）：窗口内、几乎同一点（≤ `TAP_SAME_POINT_PX`）再次按下 = 双击（编辑）。
 *
 * 为什么是 `pointerdown` 而不是 `click`：Android WebView 的 click 要等 ~150ms 才派发（还要再等系统
 * 双击判定），实测两次点按的 click 间隔可达 **251ms**；且内核第一次点按后会重渲染图片卡
 * （DOM 元素被换掉）⇒ 比 click、比元素身份都会把双击误判成两次单击（设备实测：写作卡里双击弹大图）。
 */
const TAP_DOUBLE_CLICK_WINDOW_MS = 300;
/** 两次按下位置差 ≤ 该值视为「同一张图上的双击」（DOM 可能已被内核重渲染，不能比元素身份）。 */
const TAP_SAME_POINT_PX = 28;
/** 按下后移动超过该值 = 滚动/拖拽，取消这次单击预览。 */
const TAP_MOVE_CANCEL_PX = 12;

/**
 * 给编辑器宿主挂图片放大预览监听（桌面 EditorTab / 共享 LakeEditor / 小记写作卡共用）。
 * - 触发：默认**双击**（桌面：单击留给选中/改图片大小）；传 `{ tap: true }` 时改为
 *   **移动端单击**（判定窗内同位置第二击 = 双击/编辑）—— 详见 `AttachImagePreviewOptions`。
 *   两种模式都在捕获阶段监听、**不 preventDefault**（宿主/内核行为照常）。
 * - `resolveImages` 提供**权威全量列表**（正文解析的），DOM 只用来定位"双击的是哪一张"：
 *   DOM 图片是正文列表的一个**子序列**（虚拟渲染只渲染视口内），按顺序贪心对齐即可，
 *   同一张图出现两次也不会跳错；解析不到或不给 resolver 时回退旧的 DOM 收集。
 * - 返回清理函数（组件卸载时移除）。
 */
export function attachImagePreviewClick(host: HTMLElement, resolveImages?: () => PreviewImage[], options: AttachImagePreviewOptions = {}): () => void {
  const targetImage = (event: Event): HTMLImageElement | null => {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return null;
    const img = target.closest("img.ne-image") as HTMLImageElement | null;
    return img && host.contains(img) ? img : null;
  };
  /** 打开某张图对应的画廊（DOM 只用来定位；列表来自 resolver）。 */
  const openFor = (img: HTMLImageElement) => {
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

  if (!options.tap) {
    const onDoubleClick = (event: MouseEvent) => { const img = targetImage(event); if (img) openFor(img); };
    host.addEventListener("dblclick", onDoubleClick, true);
    return () => host.removeEventListener("dblclick", onDoubleClick, true);
  }

  // 移动端「点击看图片、双击编辑」。**判定必须挂在 pointerdown 上，不能挂 click**：
  // Android WebView 的 click 要等 ~150ms 才派发（还要再等双击判定），实测两次点按的 click 间隔
  // 会超过任何合理窗口；而 pointerdown 是即时的。判据用「时间窗 + 位置」而不是 DOM 元素身份
  // —— 内核第一次点按后会重渲染图片卡（选中态），元素会被换掉（设备实测：写作卡里双击弹了大图）。
  //
  // - 单击：按下后等一个判定窗再开预览（期间手指滑动超过阈值 = 滚动，取消）；
  // - 双击：窗口内、几乎同一点（≤ SAME_POINT_PX）第二次按下 ⇒ 取消预览，交给内核做编辑；
  // - 不 preventDefault：宿主/内核的点击/选中行为照常。
  let timer: number | null = null;
  let pending: { x: number; y: number; at: number; img: HTMLImageElement } | null = null;
  const clearPending = () => {
    if (timer !== null) { window.clearTimeout(timer); timer = null; }
    pending = null;
  };
  const onPointerDown = (event: PointerEvent) => {
    const img = targetImage(event);
    if (!img) return;
    const now = Date.now();
    const { clientX: x, clientY: y } = event;
    if (pending && now - pending.at <= TAP_DOUBLE_CLICK_WINDOW_MS
      && Math.hypot(x - pending.x, y - pending.y) <= TAP_SAME_POINT_PX) {
      clearPending(); // 双击 = 编辑
      return;
    }
    clearPending();
    pending = { x, y, at: now, img };
    timer = window.setTimeout(() => {
      timer = null;
      pending = null;
      // 300ms 后元素可能已被内核重渲染替换 ⇒ 按坐标找回当前挂载的那张图，找不到才用按下时的元素
      // （jsdom / 老内核没有 elementFromPoint ⇒ 直接回退，不抛）。
      let live: HTMLImageElement = img;
      try {
        const hit = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
        const found = (hit as HTMLElement | null)?.closest?.("img.ne-image") as HTMLImageElement | null;
        if (found && host.contains(found)) live = found;
      } catch { /* 取不到坐标命中 ⇒ 用按下时的元素 */ }
      if (live.isConnected) openFor(live);
    }, TAP_DOUBLE_CLICK_WINDOW_MS);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pending) return;
    if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > TAP_MOVE_CANCEL_PX) clearPending();
  };
  host.addEventListener("pointerdown", onPointerDown, true);
  host.addEventListener("pointermove", onPointerMove, true);
  host.addEventListener("pointercancel", clearPending, true);
  host.addEventListener("scroll", clearPending, true);
  return () => {
    clearPending();
    host.removeEventListener("pointerdown", onPointerDown, true);
    host.removeEventListener("pointermove", onPointerMove, true);
    host.removeEventListener("pointercancel", clearPending, true);
    host.removeEventListener("scroll", clearPending, true);
  };
}
