import { describe, expect, it } from "vitest";
import {
  EMPTY_TAG_SELECTION,
  buildTagAggregate,
  buildTagDirectory,
  documentCountByTag,
  filterTreeByTagSelection,
  isTagSelectionActive,
  matchesTagSelection,
  normalizeDocumentTagLinks,
  quickNoteCountByTag,
  toggleTagSelection,
} from "./tagsModel";
import type { NoteSummary, QuickNoteListSummary, QuickNoteTag } from "../../lib/types";

const tag = (id: string, name: string, updatedAt = "2026-11-01T00:00:00.000Z"): QuickNoteTag => ({
  id, name, createdAt: updatedAt, updatedAt,
});
const note = (id: string, title: string, updatedAt: string): NoteSummary => ({ id, title, parentId: "nb1", sortOrder: 0, updatedAt, isConflict: false } as NoteSummary);
const quick = (id: string, previewText: string, updatedAt: string, tagIds: string[]): QuickNoteListSummary => ({
  id, createdAt: updatedAt, updatedAt, previewText, imageCount: 0, contentHash: "h", syncState: "synced", isConflict: false, tagIds, tags: [], assetMimeTypes: [],
});

describe("标签目录（quick-notes tags + 文档关系 + 小记列表）", () => {
  it("保持目录顺序；文档/小记计数按引用去重（目录已是 active-only）", () => {
    const tags = [tag("t1", "灵感"), tag("t2", "项目")];
    const links = { n1: ["t1", "t2"], n2: ["t1"], n3: ["t1", "t1"] };
    const quickNotes = [quick("q1", "小记 1", "2026-11-02", ["t1"]), quick("q2", "小记 2", "2026-11-03", ["t1", "t2"])];
    const dir = buildTagDirectory({ tags, documentLinks: links, quickNotes });
    expect(dir.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(dir[0]).toMatchObject({ name: "灵感", docCount: 3, quickNoteCount: 2 });
    expect(dir[1]).toMatchObject({ docCount: 1, quickNoteCount: 1 });
    // 0 引用标签也保留（刚创建、还没挂任何内容）
    expect(buildTagDirectory({ tags: [tag("t0", "空标签")], documentLinks: {}, quickNotes: [] })[0]).toMatchObject({ docCount: 0, quickNoteCount: 0 });
  });

  it("关系表脏数据兜底（非数组/非字符串/空数组丢弃）", () => {
    expect(normalizeDocumentTagLinks(null)).toEqual({});
    expect(normalizeDocumentTagLinks({ n1: "t1", n2: ["t1", 2], n3: ["t1", "t1"], n4: [] })).toEqual({ n3: ["t1"] });
    expect(documentCountByTag({ a: ["x", "x", "y"], b: ["x"] })).toEqual(new Map([["x", 2], ["y", 1]]));
    expect(quickNoteCountByTag([quick("q", "p", "T", ["x", "x", "y"])])).toEqual(new Map([["x", 1], ["y", 1]]));
  });
});

describe("标签聚合列表（文档分组 + 小记分组，按更新时间倒序，可切）", () => {
  const notes = [note("n1", "文档一", "2026-11-01T00:00:00.000Z"), note("n2", "文档二", "2026-11-05T00:00:00.000Z"), note("n3", "文档三", "2026-11-03T00:00:00.000Z")];
  const quickNotes = [quick("q1", "小记一", "2026-11-02T00:00:00.000Z", ["t1"]), quick("q2", "小记二", "2026-11-04T00:00:00.000Z", ["t1"])];
  const links = { n1: ["t1"], n2: ["t1"], n3: ["t2"] };

  it("两组分别按更新时间倒序；不命中标签的不出现；带文档类型（只读预览据此选视图）", () => {
    const result = buildTagAggregate({ tagId: "t1", documentLinks: links, notes, quickNotes });
    expect(result.docs.map((item) => item.id)).toEqual(["n2", "n1"]);
    expect(result.docs[0].docKind).toBe("doc");
    expect(result.quickNotes.map((item) => item.id)).toEqual(["q2", "q1"]);
    expect(result.total).toBe(4);
  });

  it("切换只看文档 / 只看小记（不改变组内顺序）", () => {
    const docsOnly = buildTagAggregate({ tagId: "t1", documentLinks: links, notes, quickNotes, filter: "doc" });
    expect(docsOnly.quickNotes).toEqual([]);
    expect(docsOnly.docs.map((item) => item.id)).toEqual(["n2", "n1"]);
    const quickOnly = buildTagAggregate({ tagId: "t1", documentLinks: links, notes, quickNotes, filter: "quickNote" });
    expect(quickOnly.docs).toEqual([]);
    expect(quickOnly.quickNotes.map((item) => item.id)).toEqual(["q2", "q1"]);
  });

  it("未选标签 / 标签下无内容 ⇒ 空", () => {
    expect(buildTagAggregate({ tagId: null, documentLinks: links, notes, quickNotes })).toMatchObject({ total: 0 });
    expect(buildTagAggregate({ tagId: "t-none", documentLinks: links, notes, quickNotes })).toMatchObject({ docs: [], quickNotes: [], total: 0 });
  });

  it("同一更新时间用 id 兜底排序，结果稳定", () => {
    const same = [note("b", "B", "2026-11-05T00:00:00.000Z"), note("a", "A", "2026-11-05T00:00:00.000Z")];
    const result = buildTagAggregate({ tagId: "t1", documentLinks: { a: ["t1"], b: ["t1"] }, notes: same, quickNotes: [] });
    expect(result.docs.map((item) => item.id)).toEqual(["b", "a"]);
  });
});

describe("侧栏按标签筛选（包含/排除，reuse 小记语义）", () => {
  it("包含=必须同时具备；排除=不能出现任何一个；无筛选恒 true", () => {
    expect(matchesTagSelection([], EMPTY_TAG_SELECTION)).toBe(true);
    const include = { include: ["t1", "t2"], exclude: [] };
    expect(matchesTagSelection(["t1", "t2", "t3"], include)).toBe(true);
    expect(matchesTagSelection(["t1"], include)).toBe(false);
    const exclude = { include: [], exclude: ["t2"] };
    expect(matchesTagSelection(["t1"], exclude)).toBe(true);
    expect(matchesTagSelection(["t1", "t2"], exclude)).toBe(false);
    expect(isTagSelectionActive(EMPTY_TAG_SELECTION)).toBe(false);
  });

  it("切换同一标签在包含/排除之间互斥", () => {
    let selection = toggleTagSelection(EMPTY_TAG_SELECTION, "t1", "include");
    expect(selection).toEqual({ include: ["t1"], exclude: [] });
    selection = toggleTagSelection(selection, "t1", "exclude");
    expect(selection).toEqual({ include: [], exclude: ["t1"] });
    selection = toggleTagSelection(selection, "t1", "exclude");
    expect(selection).toEqual({ include: [], exclude: [] });
    selection = toggleTagSelection({ include: ["t2"], exclude: ["t1"] }, "t1", "include");
    expect(selection).toEqual({ include: ["t2", "t1"], exclude: [] });
  });

  it("筛选目录树：文档按关系命中，祖先链保留，无筛选返回原引用", () => {
    const nodes = [
      { id: "nb1", nodeType: "notebook", parentId: null, noteFileId: null },
      { id: "g1", nodeType: "group", parentId: "nb1", noteFileId: null },
      { id: "n1", nodeType: "note", parentId: "g1", noteFileId: "n1" },
      { id: "n2", nodeType: "note", parentId: "nb1", noteFileId: "n2" },
      { id: "nb2", nodeType: "notebook", parentId: null, noteFileId: null },
      { id: "n3", nodeType: "note", parentId: "nb2", noteFileId: "n3" },
    ];
    const links = { n1: ["t1"], n2: ["t2"], n3: ["t1"] };
    expect(filterTreeByTagSelection(nodes, links, EMPTY_TAG_SELECTION)).toBe(nodes);
    const filtered = filterTreeByTagSelection(nodes, links, { include: ["t1"], exclude: [] });
    expect(filtered.map((node) => node.id)).toEqual(["nb1", "g1", "n1", "nb2", "n3"]);
    // 空树不会误删祖先：只留命中文档的祖先链
    const excluded = filterTreeByTagSelection(nodes, links, { include: [], exclude: ["t1"] });
    expect(excluded.map((node) => node.id)).toEqual(["nb1", "n2"]);
  });
});
