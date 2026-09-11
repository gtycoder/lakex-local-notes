/**
 * 附件预览控制器（桌面/移动端共用，与 imagePreview 同款模块级单例 pub/sub）。
 *
 * 打开时携带平台动作处理器（onOpen/onShowInFolder）：
 * - 桌面：native.openAttachment（系统默认应用）/ native.showAttachmentInFolder
 * - 移动端：分享面板 / 打开（后续接入）
 * overlay 组件订阅本控制器渲染；PDF/音视频内联预览、其他类型显示信息 + 操作按钮。
 */
import { parseLocalAssetUrl, type LocalAssetRef } from "../../core/assetUrl.js";
import { fileKindOf, type AttachmentKind } from "../../core/fileCard.js";

export interface AttachmentPreviewItem {
  /** 显示/预览用 URL（桌面/移动端统一 canonical http URL） */
  src: string;
  name: string;
  size: number;
  ref: LocalAssetRef | null;
  kind: AttachmentKind;
}

export interface AttachmentPreviewState {
  item: AttachmentPreviewItem;
  /** 平台动作：用系统应用打开（桌面 shell.openPath；移动端分享） */
  onOpen: ((item: AttachmentPreviewItem) => void) | null;
  /** 平台动作：在文件管理器中显示（桌面；移动端可为 null） */
  onShowInFolder: ((item: AttachmentPreviewItem) => void) | null;
}

type Listener = (state: AttachmentPreviewState | null) => void;

let current: AttachmentPreviewState | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) {
    try { l(current); } catch { /* 渲染层异常不影响其他订阅者 */ }
  }
}

/** 由 src 构建预览条目（解析本地资产引用 + 类型分流）。 */
export function buildAttachmentPreviewItem(src: string, name: string, size: number): AttachmentPreviewItem {
  return {
    src,
    name: name || (src.split("/").pop() ?? "附件"),
    size: typeof size === "number" ? size : 0,
    ref: parseLocalAssetUrl(src),
    kind: fileKindOf(name || src),
  };
}

export function openAttachmentPreview(
  item: AttachmentPreviewItem,
  onOpen: ((item: AttachmentPreviewItem) => void) | null,
  onShowInFolder: ((item: AttachmentPreviewItem) => void) | null,
): void {
  current = { item, onOpen, onShowInFolder };
  emit();
}

export function closeAttachmentPreview(): void {
  current = null;
  emit();
}

export function subscribeAttachmentPreview(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 从 file 卡片的 React fiber 读取 cardData（src/name/size）。
 * 该构建的 inline file 卡片（.ne-card-file）不可点击也无 href，DOM 上拿不到 src；
 * cardData 挂在渲染组件的 fiber.memoizedProps 上（getSrc/getName/getSize 稳定存在）。
 * 注意：__reactFiber$ 挂在文件芯片（.ne-card-file）等内部元素上，卡片根 ne-card 没有——
 * 因此从交互元素开始向上找。防御式：找不到 cardData 时回退 href。
 */
function readFileCardData(start: HTMLElement, card: HTMLElement): { src: string; name: string; size: number } | null {
  const fiberKey = Object.keys(start).find((k) => k.startsWith("__reactFiber$")) ?? Object.keys(card).find((k) => k.startsWith("__reactFiber$"));
  if (fiberKey) {
    const holder = (Object.keys(start).some((k) => k === fiberKey) ? start : card) as unknown as Record<string, unknown>;
    let fiber = holder[fiberKey] as { memoizedProps?: Record<string, unknown>; return?: unknown } | null;
    for (let i = 0; fiber && i < 12; i++) {
      const cd = fiber.memoizedProps?.cardData as { getSrc?: () => string; getName?: () => string; getSize?: () => number } | null;
      if (cd && typeof cd.getSrc === "function") {
        try {
          const src = cd.getSrc();
          if (typeof src === "string" && src) {
            return {
              src,
              name: (typeof cd.getName === "function" ? cd.getName() : "") || src.split("/").pop() || "附件",
              size: typeof cd.getSize === "function" ? cd.getSize() || 0 : 0,
            };
          }
        } catch { /* 读取失败走 href 兜底 */ }
      }
      fiber = fiber.return as { memoizedProps?: Record<string, unknown>; return?: unknown } | null;
    }
  }
  const href = card.querySelector("a[href]")?.getAttribute("href");
  if (href) {
    return { src: href, name: card.querySelector("a[href]")?.textContent?.trim() || href.split("/").pop() || "附件", size: 0 };
  }
  return null;
}

/**
 * 从右键目标解析卡片资产（图片 / 视频 / 音频 / file 卡），返回与附件预览同构的条目。
 * - image：取 <img src>；video/audio：取 <video>/<audio src>；file：走 fiber cardData（同点击路径）。
 * - 解析不到（如行内 data: URL 图片、非资产卡片）返回 null，由调用方回退到文本菜单。
 */
/** 从 URL 取干净文件名：优先本地资产引用还原（query/hash 不影响扩展名判定）。 */
function assetNameFromUrl(src: string): string {
  const ref = parseLocalAssetUrl(src);
  if (ref?.filename) return ref.filename;
  try { return decodeURIComponent(new URL(src).pathname.split("/").pop() || "") || "附件"; }
  catch { return src.split("?")[0].split("#")[0].split("/").pop() || "附件"; }
}

export function resolveCardAsset(start: HTMLElement): AttachmentPreviewItem | null {
  const card = start.closest("ne-card") as HTMLElement | null;
  if (!card) return null;
  const cardName = card.getAttribute("data-card-name") || card.getAttribute("name") || "";
  if (cardName === "image") {
    const src = card.querySelector("img")?.getAttribute("src") || "";
    return src ? buildAttachmentPreviewItem(src, assetNameFromUrl(src), 0) : null;
  }
  if (cardName === "video" || cardName === "audio") {
    const src = (card.querySelector("video,audio") as HTMLMediaElement | null)?.getAttribute("src") || "";
    return src ? buildAttachmentPreviewItem(src, assetNameFromUrl(src), 0) : null;
  }
  if (cardName === "file" || cardName === "attachment") {
    const data = readFileCardData(card, card);
    return data ? buildAttachmentPreviewItem(data.src, data.name, data.size) : null;
  }
  return null;
}

/**
 * 宿主级「清理 Lake 卡片 hover 残留」绑定（桌面/移动端共用）：
 * 光标离开卡片/宿主时直接移除 ne-card-hovered，背景随光标离开立即消失；
 * 打开系统应用/播放器遮罩或快速点击时 mouseleave/pointerout 可能被吞，pointerdown 兜底清理。
 * 返回的清理函数用于移除监听。
 */
export function createCardHoverResidueCleaner(host: HTMLElement): () => void {
  const clearCard = (card: Element): void => {
    try {
      card.classList.remove("ne-card-hovered");
      card.querySelectorAll(".ne-card-hovered").forEach((el) => el.classList.remove("ne-card-hovered"));
    } catch { /* 忽略 */ }
  };
  const clean = (): void => {
    try {
      host.querySelectorAll(".ne-card-hovered").forEach((el) => el.classList.remove("ne-card-hovered"));
    } catch { /* 忽略 */ }
  };
  // 光标离开卡片：relatedTarget 不在该卡片内 → 移除该卡片 hovered 背景。
  const onPointerOut = (event: PointerEvent): void => {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") return;
    const card = target.closest("ne-card, [data-card-name]") as Element | null;
    if (!card) return;
    const rel = event.relatedTarget as Element | null;
    if (rel && (rel === card || card.contains(rel))) return; // 仍在卡内（跨子元素移动不清理）
    clearCard(card);
  };
  host.addEventListener("pointerdown", clean, true);
  host.addEventListener("pointerout", onPointerOut, true);
  return () => {
    host.removeEventListener("pointerdown", clean, true);
    host.removeEventListener("pointerout", onPointerOut, true);
  };
}

/**
 * 给编辑器宿主挂文件卡片点击监听（桌面/移动端共用）。
 * 命中 file 卡片的文件芯片（.ne-card-file：图标/文件名/大小区域）或链接/按钮时
 * 解析 src（fiber cardData → 兜底 href）→ onOpen。不 preventDefault 其它区域，
 * 编辑器内点卡片空白处仍走 Lake 选中行为。
 * 返回清理函数。
 */
export function attachFileCardClick(
  host: HTMLElement,
  onOpen: (src: string, name: string, size: number) => void,
): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== "function") return;
    // 命中 file 卡片的交互元素：文件芯片（inline）/ 链接 / 预览下载按钮
    const interactive = target.closest(
      'ne-card[data-card-name="file"] .ne-card-file, ne-card[data-card-name="file"] a, [data-testid*="btn-preview"], [data-testid*="btn-download"]',
    ) as HTMLElement | null;
    if (!interactive) return;
    const card = interactive.closest('ne-card[data-card-name="file"]') as HTMLElement | null;
    if (!card || !host.contains(card)) return;
    const data = readFileCardData(interactive, card);
    if (!data) return;
    event.preventDefault();
    event.stopPropagation();
    onOpen(data.src, data.name, data.size);
    // 打开系统应用/内嵌播放器后，鼠标离开卡片的 leave 事件可能被遮罩/系统窗口吞掉，
    // Lake 的 ne-card-hovered 残留 → 卡片背景一直蓝色着色。点击后主动清理。
    try {
      card.classList.remove("ne-card-hovered");
      card.querySelectorAll(".ne-card-hovered").forEach((el) => el.classList.remove("ne-card-hovered"));
    } catch { /* 忽略 */ }
  };
  host.addEventListener("click", onClick, true);
  return () => host.removeEventListener("click", onClick, true);
}
