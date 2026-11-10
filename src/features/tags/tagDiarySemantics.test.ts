/**
 * 「标签空间不聚合日记」的语义锁（261109 日记 v1 收尾；docs/DIARY.md 决策 10「不打标」）。
 *
 * 只读确认（本文件不改实现）：桌面 `features/tags/tagsModel.buildTagAggregate`（移动端
 * `mobile/tags/tagAggregate.aggregateTagRows` 同口径）的判据 = **documentLinks 命中**，
 * 聚合层**没有**任何 `space` / 日记判据。所以「标签空间不聚合日记」的真实保证是数据前提：
 * 日记空间不提供标签入口 ⇒ 日记文档不产生 tag 关系。
 *
 * 本测试把这条前提写成夹具（同标签下同时有日记文档 + 普通文档，关系表只有普通文档）：
 *  · 目录计数 / 聚合列表都只出现普通文档；
 *  · 并显式记录第二条口径 —— 关系表里若有日记文档（异常数据），它**会**被聚合。
 *    哪天产品要改成"聚合层按 space 过滤"，必须先回 docs/DIARY.md 裁决并同步本文件。
 */
import { describe, expect, it } from "vitest";
import type { NoteSummary, QuickNoteListSummary, QuickNoteTag } from "../../lib/types";
import { buildTagAggregate, buildTagDirectory } from "./tagsModel";

const T = "2026-11-10T00:00:00.000Z";
const note = (over: Partial<NoteSummary> & { id: string }): NoteSummary => ({
  title: over.id, parentId: null, sortOrder: 0, updatedAt: T, isConflict: false, ...over,
});
const tag = (id: string, name: string): QuickNoteTag => ({ id, name, createdAt: T, updatedAt: T });

/** 夹具：普通文档在「工作」本，日记文档在日记本月分组下（标题即日期），两者同在一个标签下。 */
const NORMAL = note({ id: "note-normal", title: "周报", parentId: "nb-work", sortOrder: 0 });
const DIARY = note({ id: "note-diary", title: "2026-11-09", parentId: "m11", sortOrder: 0 });
const NOTES = [NORMAL, DIARY];
const TAGS = [tag("t1", "项目")];
/** 日记空间不打标 ⇒ 关系表只可能出现普通文档。 */
const LINKS = { [NORMAL.id]: ["t1"] };

describe("标签空间不聚合日记（数据前提 + 聚合口径）", () => {
  it("日记文档没有标签关系时：只聚合普通文档，目录计数也只算它", () => {
    const aggregate = buildTagAggregate({ tagId: "t1", documentLinks: LINKS, notes: NOTES, quickNotes: [] as QuickNoteListSummary[] });
    expect(aggregate.docs.map((item) => item.id)).toEqual([NORMAL.id]);
    expect(aggregate.docs.some((item) => item.title === DIARY.title)).toBe(false);
    expect(aggregate.total).toBe(1);

    const directory = buildTagDirectory({ tags: TAGS, documentLinks: LINKS, notes: NOTES, quickNotes: [] });
    expect(directory.map((entry) => entry.docCount)).toEqual([1]);
  });

  it("口径记录：聚合层不按 space 过滤 —— 关系表里若出现日记文档，照常聚合（保证来自「不打标」）", () => {
    const polluted = { ...LINKS, [DIARY.id]: ["t1"] };
    const aggregate = buildTagAggregate({ tagId: "t1", documentLinks: polluted, notes: NOTES, quickNotes: [] });
    expect(aggregate.docs.map((item) => item.id).sort()).toEqual([DIARY.id, NORMAL.id].sort());
    // 这是"当前判据"的证明，不是期望行为：修复入口 = 不给日记文档写 tag 关系（docs/DIARY.md 决策 10）。
  });
});
