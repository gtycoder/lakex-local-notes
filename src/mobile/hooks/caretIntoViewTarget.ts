/**
 * useCaretIntoView 的「这个选区到底是不是用户光标」判据（纯函数，单测见 caretIntoViewTarget.test.ts）。
 *
 * 261027 移动端实测：Lake 内核在 mode 切换（viewer ⇄ editor）时会 destroy + `host.replaceChildren()`，
 * Chrome 把 DOM 选区塌到**编辑器宿主 div**（anchorNode.nodeType=1、range.getClientRects().length=0）。
 * 旧实现此时回退 `target.getBoundingClientRect()`，拿到的是「整篇正文」的矩形，再按「把光标滚进容器」
 * 计算 ⇒ 一次滚到文档末尾（实测 scrollTo top=2176，终态 = scrollHeight-clientHeight）。
 * 阅读态本来就没有光标，残留的文本选区同样会被当成光标（切文档 / 开抽屉 / 退出编辑后跳末尾）。
 *
 * 判据：只认**能放光标的叶级节点**；整块/宿主容器的矩形一律不算光标位置。
 * 不记 scrollTop、不做滚动恢复——这里只回答「这个选区给出的位置可信吗」。
 */

export interface CaretRectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface CaretRectInput {
  /** anchorNode.nodeType：3 = 文本 / 1 = 元素 / 其它 */
  anchorNodeType: number;
  /** anchor 是否在当前正文容器（root）内（keep-alive 的其它文档为 false） */
  inRoot: boolean;
  /** anchor 元素是否就是 root 本身（选区落在滚动容器上） */
  anchorIsRoot: boolean;
  /** 选区 range 的 commonAncestorContainer 是否**包住** root（选区跨出了当前正文，不是本容器光标） */
  commonAncestorCoversRoot: boolean;
  /** anchor 元素是否叶级（没有元素子节点）——带子节点的元素是整块/宿主容器，不是光标 */
  anchorIsLeaf: boolean;
  /** range.getClientRects().length */
  rangeRectCount: number;
  /** 选区 range 的 client rect（无 client rect 时传 null） */
  rangeRect: CaretRectLike | null;
  /** 目标元素（closest td/th/... 或 anchor 元素）的 rect */
  targetRect: CaretRectLike | null;
  /** 滚动容器的 clientHeight */
  rootClientHeight: number;
}

/** 叶级元素的 rect 一旦超过容器可视高度的这个比例，就当成"整块"而不是光标。 */
const COVER_RATIO = 0.6;

/** 0×0 的矩形不可能是光标（旧实现的兜底判断，收进判据里）。 */
function viable(rect: CaretRectLike | null): CaretRectLike | null {
  if (!rect) return null;
  if (rect.width <= 0 && rect.height <= 0) return null;
  return rect;
}

/**
 * 叶级块 rect 能否当光标位置的兜底：不能是 0×0，也不能覆盖大半个容器（整块内容）。
 * 261027 设备实测：Android WebView 里折叠 Range 的 getClientRects() 返回 1 个零宽 rect；
 * 但不同内核/版本可能返回 0 个（Chrome 对折叠 Range 的语义并不保证）⇒ 文本 anchor 允许退到
 * 「最近块」的 rect，但仍受这条几何门槛约束，绝不会拿整篇宿主的 rect 顶替。
 */
function smallTargetRect(targetRect: CaretRectLike | null, rootClientHeight: number): CaretRectLike | null {
  const rect = viable(targetRect);
  if (!rect) return null;
  if (rootClientHeight > 0 && rect.height > rootClientHeight * COVER_RATIO) return null;
  return rect;
}

/**
 * 解析出可信的光标矩形；返回 null = 这次选区不是用户光标，不该滚动。
 *
 * 为什么这些情况不算光标：
 * - 不在 root 内 / 选区 commonAncestor 包住 root：那是别的（keep-alive）文档或跨容器的选区；
 * - 文本 anchor 却没有 range 矩形：光标不可见（编辑器正被销毁/重建），**不能**拿整块 rect 顶替；
 * - 元素 anchor 带子节点（.lake-editor / .ne-engine / 段落块）：rect 是整个内容高度，不是光标；
 * - anchor===root：选区就落在滚动容器本身；
 * - 叶级但 rect 高度覆盖大半个容器：那是整块内容（长段落/代码块），同样不是光标。
 */
export function resolveCaretRect(input: CaretRectInput): CaretRectLike | null {
  const {
    anchorNodeType, inRoot, anchorIsRoot, commonAncestorCoversRoot, anchorIsLeaf,
    rangeRectCount, rangeRect, targetRect, rootClientHeight,
  } = input;
  if (!inRoot) return null;
  if (commonAncestorCoversRoot) return null;
  if (anchorNodeType === 3) {
    // 折叠光标的 range rect 在部分内核里为空 ⇒ 退到最近块的 rect，但必须是小块（见 smallTargetRect）。
    return (rangeRectCount > 0 ? viable(rangeRect) : null) ?? smallTargetRect(targetRect, rootClientHeight);
  }
  if (anchorNodeType !== 1) return null;
  if (anchorIsRoot) return null;
  if (rangeRectCount > 0) return viable(rangeRect);
  if (!anchorIsLeaf) return null;
  return smallTargetRect(targetRect, rootClientHeight);
}
