/**
 * 手写板「大纲 / 页目录」= 纯派生（261104 十八批；十九批换成页备注）。
 *
 * 为什么需要：一本 300 页的书靠底部缩略图横条翻页太慢；大纲只列「有批注 / 有备注」的页，
 * 一屏十几行、点一下直跳。它是**视图**，不落盘。
 *
 * 261104 二十批：设备本地「书签」升级成**正文里的页备注**（`page.note`，随 v4 同步）——
 * 这样换设备也能看到「这一页写了什么」，且不再有两套标记语义（书签 vs 备注）。
 */
import type { InkPage } from "../../core/inkDoc.js";

/** 大纲只关心页面这几个字段（避免把整个 InkPage 类型拖进来）。 */
export interface InkOutlinePage {
  id: string;
  /** 有笔迹的页才算「有内容」。 */
  strokeCount: number;
  /** 图片页 / PDF 页（有背景图）。 */
  hasBackgroundImage: boolean;
  /** v4 页备注（有备注的页在「只看备注」下也列）。 */
  note?: string;
}

export interface InkOutlineEntry {
  pageId: string;
  /** 1-based 页码（与 UI「第 n / N 页」同口径）。 */
  pageNumber: number;
  strokeCount: number;
  hasBackgroundImage: boolean;
  /** 页备注（v4 正文数据）。 */
  note?: string;
}

/** 大纲显示范围：只看批注（默认）/ 全部页 / 只看有备注。 */
export type InkOutlineMode = "all" | "annotated" | "noted";

/** 三种范围的中文名（面板按钮直接显示当前范围，避免"点了不知道在切什么"）。 */
export const INK_OUTLINE_MODE_LABELS: Record<InkOutlineMode, string> = {
  annotated: "只看批注",
  all: "全部页",
  noted: "只看有备注",
};

/** 循环切换顺序（annotated → all → noted → annotated）。 */
export function nextInkOutlineMode(mode: InkOutlineMode): InkOutlineMode {
  if (mode === "annotated") return "all";
  if (mode === "all") return "noted";
  return "annotated";
}

/** 页元信息 → 大纲条目（顺序 = 正文页序）。 */
export function buildInkOutline(
  pages: readonly InkOutlinePage[],
  mode: InkOutlineMode = "annotated",
): InkOutlineEntry[] {
  const entries: InkOutlineEntry[] = [];
  pages.forEach((page, index) => {
    const note = page.note?.trim() ? page.note.trim() : undefined;
    const annotated = page.strokeCount > 0 || page.hasBackgroundImage;
    // 「只看有备注」只列写过备注的页；其余两种模式按「有内容」过滤，但有备注的页一定列出。
    if (mode === "noted" && !note) return;
    if (mode === "annotated" && !annotated && !note) return;
    entries.push({
      pageId: page.id,
      pageNumber: index + 1,
      strokeCount: page.strokeCount,
      hasBackgroundImage: page.hasBackgroundImage,
      ...(note ? { note } : {}),
    });
  });
  return entries;
}

/** 大纲标题里的一句摘要（有批注页数 / 有备注页数）。 */
export function inkOutlineSummary(entries: readonly InkOutlineEntry[]): string {
  const noted = entries.filter((item) => item.note).length;
  const annotated = entries.filter((item) => item.strokeCount > 0).length;
  return `${annotated} 页有批注 · ${noted} 页有备注`;
}

/** 有备注的页 id（缩略图条打点用；只返回存在的页）。 */
export function notedPageIds(pages: readonly Pick<InkPage, "id" | "note">[]): Set<string> {
  return new Set(pages.filter((page) => (page.note ?? "").trim().length > 0).map((page) => page.id));
}
