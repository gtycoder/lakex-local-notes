/**
 * 图片卡片内核桥（SelectionToolbar 专用）。
 *
 * 原则（用户 260924 立规）：**组件自己写，能力必须走内核**——这里只做两件事：
 *   1. 从内核图片卡实例读当前状态（cardData getters）；
 *   2. 触发内核既有能力（卡 UI 的裁剪态 `setCro`）。
 * 不在这里自实现任何图片渲染/裁剪/样式逻辑（样式/宽度/链接等一律走 updateImageData，
 * 批量走 cardBatchApply，见 SelectionToolbar）。
 *
 * 内核落点（LAKEX-CONTRACT §5.10 八已回填）：
 *   - cardEl._neRef._virtualNode._instance（或 ._instance）= 卡实例；其 cardData/_cardData = 数据 getter。
 *   - 卡实例 ._\$cardUI = 图片卡 UI 组件实例，含 setCro / getCroping / _cropImageOp（交互式裁剪）。
 *   - 样式值 = 内核 CSS 已定义的 \`ne-image-style-{none|stroke|shadow}\`。
 */
export interface ImageMeta {
  originalWidth: number;
  originalHeight: number;
  width: number;
  rotation: number;
  style: string;
  link: string;
  title: string;
  showTitle: boolean;
  /** 块级对齐（内核 `ne-alignment`，非 cardValue —— 见 LAKEX-CONTRACT 排查）。 */
  alignment: string;
  /** 卡片边距（内核 card spacing：both/top/bottom 或空）。 */
  spacing: string;
  /** 链接是否「在当前页面打开」（内核 linkExternal 的反）。 */
  linkSelf: boolean;
}

interface ImageCardData {
  getOriginalWidth?: () => number;
  getOriginalHeight?: () => number;
  getUserWidth?: () => number;
  getRotation?: () => number;
  getStyle?: () => string;
  getLink?: () => string;
  getTitle?: () => string;
  showTitle?: () => boolean;
  getCardSpacing?: () => string | undefined;
  isOpenLinkInSelf?: () => boolean;
  setCardSpacing?: (value: string | null) => void;
  sync?: (b?: boolean) => void;
}

interface ImageCardUi {
  setCro?: (value: boolean) => void;
  getCroping?: () => boolean;
}

interface CardRef {
  _virtualNode?: { _instance?: unknown };
  _instance?: unknown;
}

function cardRef(cardEl: HTMLElement): CardRef | undefined {
  return (cardEl as unknown as { _neRef?: CardRef })._neRef;
}

function cardData(cardEl: HTMLElement): ImageCardData | undefined {
  const ref = cardRef(cardEl);
  const inst = (ref?._virtualNode?._instance ?? ref?._instance) as { cardData?: ImageCardData; _cardData?: ImageCardData } | undefined;
  return inst?.cardData ?? inst?._cardData;
}

function cardUi(cardEl: HTMLElement): ImageCardUi | undefined {
  const ref = cardRef(cardEl);
  const inst = (ref?._virtualNode?._instance ?? ref?._instance) as { _$cardUI?: ImageCardUi } | undefined;
  return inst?._$cardUI;
}

/** 内核 CSS 支持的图片样式（ne-image-style-*）。label 用云端语雀文案。 */
export const IMAGE_STYLE_OPTIONS = [
  { value: "none", label: "无样式" },
  { value: "stroke", label: "图片描边" },
  { value: "shadow", label: "图片阴影" },
] as const;

/** 从内核图片卡实例读当前状态（cardData getters → DOM 回退）。 */
export function readImageMeta(cardEl: HTMLElement): ImageMeta {
  const cd = cardData(cardEl);
  const img = cardEl.querySelector("img");
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    originalWidth: num(cd?.getOriginalWidth?.()) ?? img?.naturalWidth ?? 320,
    originalHeight: num(cd?.getOriginalHeight?.()) ?? img?.naturalHeight ?? 240,
    width: num(cd?.getUserWidth?.()) ?? num(img?.clientWidth) ?? 0,
    rotation: num(cd?.getRotation?.()) ?? 0,
    style: (cd?.getStyle?.() as string) || "none",
    link: (cd?.getLink?.() as string) || "",
    title: (cd?.getTitle?.() as string) || "",
    showTitle: cd?.showTitle?.() === true,
    alignment: cardEl.closest("[ne-alignment]")?.getAttribute("ne-alignment") || "left",
    spacing: (cd?.getCardSpacing?.() as string) || "",
    linkSelf: cd?.isOpenLinkInSelf?.() === true,
  };
}

/** 边距 = 内核 card spacing（cardValue.__spacing，值 both/top/bottom）。走 cardData.setCardSpacing
 *  （内核 card-data.ts 34729；null = 清空 ⇒ 紧凑）。不用自造的 margin 字段（内核不认）。 */
export function setImageSpacing(cardEl: HTMLElement, value: "both" | "top" | "bottom" | null): boolean {
  const cd = cardData(cardEl);
  if (typeof cd?.setCardSpacing !== "function") return false;
  try { cd.setCardSpacing(value); cd.sync?.(false); return true; } catch { return false; }
}

/** 是否处于内核交互式裁剪态（裁剪时浮框应让位）。 */
export function isImageCropping(cardEl: HTMLElement): boolean {
  try { return cardUi(cardEl)?.getCroping?.() === true; } catch { return false; }
}

/** 进入内核交互式裁剪态（_handleCropOK / 取消由内核 UI 自己处理）。 */
export function enterImageCrop(cardEl: HTMLElement): boolean {
  const ui = cardUi(cardEl);
  if (typeof ui?.setCro !== "function") return false;
  try { ui.setCro(true); return true; } catch { return false; }
}
