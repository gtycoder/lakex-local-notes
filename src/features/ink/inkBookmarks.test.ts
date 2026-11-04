// @vitest-environment jsdom
/**
 * 书签（设备本地视图）+ 大纲派生（261104 十八批）。
 * 钉住：读写容错、同页 toggle、上限、坏值回退、大纲筛选（只列有批注/书签）、页码口径、摘要。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  INK_BOOKMARK_KEY_PREFIX,
  MAX_INK_BOOKMARKS,
  clearInkBookmarks,
  inkBookmarkKey,
  isBookmarked,
  readInkBookmarks,
  removeInkBookmark,
  toggleInkBookmark,
} from "./inkBookmarks";
import { bookmarkPageIds, buildInkOutline, inkOutlineSummary, type InkOutlinePage } from "./inkOutline";

beforeEach(() => {
  localStorage.clear();
});

describe("手写板书签（设备本地）", () => {
  it("toggle：同页加/取消；不同页各一条；key 带 noteId 前缀", () => {
    expect(toggleInkBookmark("n1", "p1").map((item) => item.pageId)).toEqual(["p1"]);
    expect(toggleInkBookmark("n1", "p2").map((item) => item.pageId)).toEqual(["p1", "p2"]);
    expect(toggleInkBookmark("n1", "p1").map((item) => item.pageId)).toEqual(["p2"]);
    expect(inkBookmarkKey("n1")).toBe(INK_BOOKMARK_KEY_PREFIX + "n1");
    // 不同文档互不影响
    expect(readInkBookmarks("n2")).toEqual([]);
  });

  it("坏值/缺字段/重复页：读出来是干净的数组，不抛错", () => {
    localStorage.setItem(inkBookmarkKey("n1"), "{bad json");
    expect(readInkBookmarks("n1")).toEqual([]);
    localStorage.setItem(inkBookmarkKey("n1"), JSON.stringify([
      { pageId: "p1", at: "2026-01-01T00:00:00.000Z" },
      { pageId: "p1", at: "2026-01-02T00:00:00.000Z" },
      { pageId: "", at: "x" },
      { nope: 1 },
      null,
      { pageId: "p2", label: "  重点  ", at: "2026-01-03T00:00:00.000Z" },
    ]));
    const list = readInkBookmarks("n1");
    expect(list.map((item) => item.pageId)).toEqual(["p1", "p2"]);
    expect(list[1].label).toBe("重点");
  });

  it("上限：超过 MAX 后不再写入；remove/isBookmarked 正确", () => {
    for (let index = 0; index < MAX_INK_BOOKMARKS + 5; index += 1) toggleInkBookmark("n1", "p" + index);
    expect(readInkBookmarks("n1").length).toBe(MAX_INK_BOOKMARKS);
    const list = readInkBookmarks("n1");
    expect(isBookmarked(list, "p0")).toBe(true);
    expect(isBookmarked(list, "p999")).toBe(false);
    expect(removeInkBookmark("n1", "p0").some((item) => item.pageId === "p0")).toBe(false);
    clearInkBookmarks("n1");
    expect(readInkBookmarks("n1")).toEqual([]);
  });
});

const pages: InkOutlinePage[] = [
  { id: "p1", strokeCount: 0, hasBackgroundImage: true },   // PDF 页：算有内容
  { id: "p2", strokeCount: 0, hasBackgroundImage: false },  // 空白页
  { id: "p3", strokeCount: 3, hasBackgroundImage: false },  // 有笔迹
  { id: "p4", strokeCount: 0, hasBackgroundImage: false },  // 空白但打了书签
];

describe("大纲派生", () => {
  it("annotated 模式：只列「有笔迹 / 有页图 / 有书签」的页，页码是正文页序", () => {
    const bookmarks = [{ pageId: "p4", at: "2026-01-01T00:00:00.000Z", label: "结论" }];
    const entries = buildInkOutline(pages, bookmarks, "annotated");
    expect(entries.map((item) => [item.pageNumber, item.pageId])).toEqual([[1, "p1"], [3, "p3"], [4, "p4"]]);
    expect(entries[2].bookmarked).toBe(true);
    expect(entries[2].label).toBe("结论");
  });

  it("all 模式：整本页序都在；被删页的书签自然不出现", () => {
    const bookmarks = [{ pageId: "gone", at: "2026-01-01T00:00:00.000Z" }];
    const entries = buildInkOutline(pages, bookmarks, "all");
    expect(entries.map((item) => item.pageNumber)).toEqual([1, 2, 3, 4]);
    expect(entries.some((item) => item.pageId === "gone")).toBe(false);
  });

  it("摘要与缩略图标位", () => {
    const bookmarks = [{ pageId: "p4", at: "2026-01-01T00:00:00.000Z" }, { pageId: "gone", at: "2026-01-01T00:00:00.000Z" }];
    const entries = buildInkOutline(pages, bookmarks, "annotated");
    // 「有批注」只算有笔迹的页（PDF 页图不算批注，但它仍会出现在大纲里）
    expect(inkOutlineSummary(entries)).toBe("1 页有批注 · 1 个书签");
    expect([...bookmarkPageIds(bookmarks, pages)]).toEqual(["p4"]);
  });
});