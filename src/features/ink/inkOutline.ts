/**
 * 手写板「大纲 / 页目录」= 纯派生（261104 十八批）。
 *
 * 为什么需要：一本 300 页的书靠底部缩略图横条翻页太慢；大纲只列「有批注的页 + 书签」，
 * 一屏能看到十几页、点一下直跳。它是**视图**，不落盘、不进正文（书签才是设备本地数据）。
 *
 * 纯函数、无 DOM：方便单测，也方便将来在移动端复用同一份筛选逻辑。
 */
import type { InkBookmark } from "./inkBookmarks.js";

/** 大纲只关心页面这几个字段（避免把整个 InkPage 类型拖进来）。 */
export interface InkOutlinePage {
  id: string;
  /** 有笔迹的页才算「有内容」。 */
  strokeCount: number;
  /** 图片页 / PDF 页（有背景图）。 */
  hasBackgroundImage: boolean;
}

export interface InkOutlineEntry {
  pageId: string;
  /** 1-based 页码（与 UI「第 n / N 页」同口径）。 */
  pageNumber: number;
  strokeCount: number;
  hasBackgroundImage: boolean;
  bookmarked: boolean;
  /** 书签备注（没写就是 undefined，UI 显示页码）。 */
  label?: string;
}

/** 大纲显示范围：只看批注（默认）/ 全部页 / 只看书签。 */
export type InkOutlineMode = "all" | "annotated" | "bookmarks";

/** 三种范围的中文名（面板按钮直接显示当前范围，避免"点了不知道在切什么"）。 */
export const INK_OUTLINE_MODE_LABELS: Record<InkOutlineMode, string> = {
  annotated: "只看批注",
  all: "全部页",
  bookmarks: "只看书签",
};

/** 循环切换顺序（annotated → all → bookmarks → annotated）。 */
export function nextInkOutlineMode(mode: InkOutlineMode): InkOutlineMode {
  if (mode === "annotated") return "all";
  if (mode === "all") return "bookmarks";
  return "annotated";
}

/** 页元信息 → 大纲条目（顺序 = 正文页序；已删除页对应的书签自然不出现）。 */
export function buildInkOutline(
  pages: readonly InkOutlinePage[],
  bookmarks: readonly InkBookmark[],
  mode: InkOutlineMode = "annotated",
): InkOutlineEntry[] {
  const byPage = new Map(bookmarks.map((item) => [item.pageId, item]));
  const entries: InkOutlineEntry[] = [];
  pages.forEach((page, index) => {
    const bookmark = byPage.get(page.id);
    const annotated = page.strokeCount > 0 || page.hasBackgroundImage;
    // 「只看书签」：有书签的页一律列（哪怕空白页）；其余两种模式按上面规则过滤。
    if (mode === "bookmarks" && !bookmark) return;
    if (mode === "annotated" && !annotated && !bookmark) return;
    entries.push({
      pageId: page.id,
      pageNumber: index + 1,
      strokeCount: page.strokeCount,
      hasBackgroundImage: page.hasBackgroundImage,
      bookmarked: Boolean(bookmark),
      ...(bookmark?.label ? { label: bookmark.label } : {}),
    });
  });
  return entries;
}

/** 大纲标题里的一句摘要（书签数 / 有批注页数）。 */
export function inkOutlineSummary(entries: readonly InkOutlineEntry[]): string {
  const bookmarked = entries.filter((item) => item.bookmarked).length;
  const annotated = entries.filter((item) => item.strokeCount > 0).length;
  return `${annotated} 页有批注 · ${bookmarked} 个书签`;
}

/** 书签在页序里的位置（给缩略图条打标用；只返回存在的页）。 */
export function bookmarkPageIds(bookmarks: readonly InkBookmark[], pages: readonly { id: string }[]): Set<string> {
  const known = new Set(pages.map((page) => page.id));
  return new Set(bookmarks.filter((item) => known.has(item.pageId)).map((item) => item.pageId));
}
