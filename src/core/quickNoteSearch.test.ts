import { describe, expect, it } from "vitest";
import { filterQuickNotesByQuery, quickNoteMatchesQuery } from "./quickNoteSearch";

const notes = [
  { id: "a", previewText: "今天写 Lake 内核", content: { text: "今天写 Lake 内核", tags: ["灵感"] } },
  { id: "b", previewText: "购物清单", content: { text: "牛奶 鸡蛋", tags: [] } },
  { id: "c", previewText: "", content: { text: "", tags: ["Lake笔记"] } },
];

describe("小记列表本地搜索", () => {
  it("空查询返回全部；命中纯文本/标签，大小写不敏感", () => {
    expect(filterQuickNotesByQuery(notes, "  ").map((note) => note.id)).toEqual(["a", "b", "c"]);
    expect(filterQuickNotesByQuery(notes, "lake").map((note) => note.id)).toEqual(["a", "c"]);
    expect(filterQuickNotesByQuery(notes, "牛奶").map((note) => note.id)).toEqual(["b"]);
    expect(filterQuickNotesByQuery(notes, "不存在").map((note) => note.id)).toEqual([]);
  });

  it("标签也算命中；预览文本缺失时退回 content.text", () => {
    expect(quickNoteMatchesQuery({ content: { text: "正文" } }, "正文")).toBe(true);
    expect(quickNoteMatchesQuery({ content: { tags: ["待办"] } }, "待办")).toBe(true);
    expect(quickNoteMatchesQuery({ previewText: "预览" }, "预览")).toBe(true);
  });
});
