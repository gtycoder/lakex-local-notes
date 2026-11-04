/**
 * 手写板「页面大纲」= 纯派生（261104 十八批；二十六批改为「页签」语义）。
 *
 * 为什么需要：一本 300 页的书靠横向缩略图翻页太慢；大纲只列「有批注 / 有页签」的页，点一下直跳。
 * 它是**视图**，不落盘。
 *
 * 页签 = `page.note` 字段存在（**空串也是页签 = 纯标记**，非空 = 标记 + 一句话说明），随 v4 正文同步。
 */
import type { InkPage } from "../../core/inkDoc.js";

/** 大纲只关心页面这几个字段（避免把整个 InkPage 类型拖进来）。 */
export interface InkOutlinePage {
  id: string;
  /** 有笔迹的页才算「有内容」。 */
  strokeCount: number;
  /** 图片页 / PDF 页（有背景图）。 */
  hasBackgroundImage: boolean;
  /** v4 页签（字段存在即为有页签；空串 = 纯标记）。 */
  note?: string;
}

export interface InkOutlineEntry {
  pageId: string;
  /** 1-based 页码（与 UI「第 n / N 页」同口径）。 */
  pageNumber: number;
  strokeCount: number;
  hasBackgroundImage: boolean;
  /** 有页签（无论有没有文字）。 */
  hasTab: boolean;
  /** 页签文字（纯标记时没有这个字段）。 */
  note?: string;
}

/** 筛选：全部页 / 只看批注 / 只看页签。 */
export type InkOutlineMode = "all" | "annotated" | "tabbed";

/** 筛选 chip 文案（面板上直接显示）。 */
export const INK_OUTLINE_MODE_LABELS: Record<InkOutlineMode, string> = {
  all: "全部",
  annotated: "批注",
  tabbed: "页签",
};

/** 三档的固定顺序（chips 排布）。 */
export const INK_OUTLINE_MODES: readonly InkOutlineMode[] = ["all", "annotated", "tabbed"];

/** 页元信息 → 大纲条目（顺序 = 正文页序）。 */
export function buildInkOutline(
  pages: readonly InkOutlinePage[],
  mode: InkOutlineMode = "annotated",
): InkOutlineEntry[] {
  const entries: InkOutlineEntry[] = [];
  pages.forEach((page, index) => {
    const hasTab = page.note !== undefined;
    const note = hasTab && page.note ? page.note.trim() : "";
    const annotated = page.strokeCount > 0 || page.hasBackgroundImage;
    if (mode === "tabbed" && !hasTab) return;
    if (mode === "annotated" && !annotated) return;
    entries.push({
      pageId: page.id,
      pageNumber: index + 1,
      strokeCount: page.strokeCount,
      hasBackgroundImage: page.hasBackgroundImage,
      hasTab,
      ...(note ? { note } : {}),
    });
  });
  return entries;
}

/** 摘要：有批注页数 / 页签数（按全文统计，不受筛选影响）。 */
export function inkOutlineSummary(pages: readonly InkOutlinePage[]): string {
  let annotated = 0;
  let tabs = 0;
  for (const page of pages) {
    if (page.strokeCount > 0 || page.hasBackgroundImage) annotated += 1;
    if (page.note !== undefined) tabs += 1;
  }
  return `${annotated} 页有批注，${tabs} 个页签`;
}

/**
 * 大纲里的「查找」：**只能搜页签文字与页码**（笔迹没有 OCR，不可文本检索）。
 * 空查询返回原数组引用（面板据此跳过重算）。
 */
export function filterInkOutline(entries: readonly InkOutlineEntry[], query: string): readonly InkOutlineEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => (
    String(entry.pageNumber) === needle
    || String(entry.pageNumber).includes(needle)
    || (entry.note ?? "").toLowerCase().includes(needle)
  ));
}

/** 有页签的页 id（缩略图打点用；只返回存在的页）。 */
export function tabPageIds(pages: readonly Pick<InkPage, "id" | "note">[]): Set<string> {
  return new Set(pages.filter((page) => page.note !== undefined).map((page) => page.id));
}
