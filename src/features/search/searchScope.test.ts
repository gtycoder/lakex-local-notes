/**
 * 搜索范围筛选 + 标签命中 + 空态引导（纯函数；261106 搜索增强）。
 * 口径：范围是设备本地视图；标签命中由既有 IPC 数据（标签目录 + 关系表 + 摘要）拼接，不新增索引。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_SCOPE,
  SEARCH_SCOPES,
  filterByScope,
  hitKey,
  matchTagSearch,
  mergeSearchHits,
  parseSearchScope,
  searchIdleHint,
  searchNoResultHint,
  type SearchHit,
  type TagSearchIndex,
} from "./searchScope";

const hit = (overrides: Partial<SearchHit> & Pick<SearchHit, "id" | "matchType">): SearchHit => ({
  kind: "note", title: overrides.id, snippet: "",
  ...overrides,
});

const index: TagSearchIndex = {
  tags: [
    { id: "t1", name: "灵感" },
    { id: "t2", name: "项目计划" },
    { id: "t3", name: "P1" },
  ],
  noteLinks: {
    n1: ["t1"],
    n2: ["t1", "t2"],
    n3: ["t3"],
  },
  notes: [
    { id: "n1", title: "文档一", kind: "doc", updatedAt: "2026-11-01T00:00:00.000Z" },
    { id: "n2", title: "文档二", kind: "doc", updatedAt: "2026-11-05T00:00:00.000Z" },
    { id: "n3", title: "文档三", kind: "doc", updatedAt: "2026-11-03T00:00:00.000Z" },
  ],
  quickNotes: [
    { id: "q1", previewText: "小记一", updatedAt: "2026-11-04T00:00:00.000Z", tagIds: ["t2"] },
    { id: "q2", previewText: "小记二", updatedAt: "2026-11-02T00:00:00.000Z", tagIds: [] },
  ],
};

describe("搜索范围（纯逻辑）", () => {
  it("范围清单 = 全部/标题/正文/标签，默认全部；坏值回落默认", () => {
    expect(SEARCH_SCOPES.map((item) => item.id)).toEqual(["all", "title", "body", "tag"]);
    expect(DEFAULT_SEARCH_SCOPE).toBe("all");
    expect(parseSearchScope("body")).toBe("body");
    expect(parseSearchScope("unknown")).toBe("all");
    expect(parseSearchScope(null)).toBe("all");
  });

  it("filterByScope：all 原样；标题/正文/标签各只留自己那一类命中", () => {
    const hits = [hit({ id: "a", matchType: "title" }), hit({ id: "b", matchType: "body" }), hit({ id: "c", matchType: "tag" })];
    expect(filterByScope(hits, "all").map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(filterByScope(hits, "title").map((x) => x.id)).toEqual(["a"]);
    expect(filterByScope(hits, "body").map((x) => x.id)).toEqual(["b"]);
    expect(filterByScope(hits, "tag").map((x) => x.id)).toEqual(["c"]);
    // 不修改入参（纯函数）
    expect(hits).toHaveLength(3);
  });
});

describe("标签命中（用既有数据拼接）", () => {
  it("标签名包含关键词（不区分大小写）⇒ 该标签下的文档 + 小记，按更新时间倒序", () => {
    const hits = matchTagSearch(index, "灵感");
    expect(hits.map((x) => x.id)).toEqual(["n2", "n1"]);
    expect(hits.every((x) => x.matchType === "tag")).toBe(true);
    expect(hits[0].tagNames).toEqual(["灵感"]);
  });

  it("一篇文档命中多个标签时都带上；小记按 tagIds 命中", () => {
    const hits = matchTagSearch(index, "项目");
    expect(hits.map((x) => x.id)).toEqual(["n2", "q1"]);
    expect(hits.find((x) => x.id === "q1")?.kind).toBe("quick-note");
    expect(hits.find((x) => x.id === "q1")?.title).toBe("小记一");
  });

  it("空关键词 / 无标签命中 / 索引不可用 ⇒ 空数组（标题正文搜索不受影响）", () => {
    expect(matchTagSearch(index, "   ")).toEqual([]);
    expect(matchTagSearch(index, "不存在的标签")).toEqual([]);
    expect(matchTagSearch(null, "灵感")).toEqual([]);
  });

  it("结果按 updatedAt 倒序且有序（日期缺失不抛错）", () => {
    const sparse: TagSearchIndex = {
      tags: [{ id: "t1", name: "标签" }],
      noteLinks: { a: ["t1"], b: ["t1"] },
      notes: [{ id: "a", title: "A" }, { id: "b", title: "B", updatedAt: "2026-11-01" }],
      quickNotes: [],
    };
    const hits = matchTagSearch(sparse, "标签");
    expect(hits.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("结果合并", () => {
  it("主进程命中在前，标签命中只补未出现的（按 kind:id 去重）", () => {
    const native = [hit({ id: "n1", matchType: "title" })];
    const tags = [hit({ id: "n1", matchType: "tag" }), hit({ id: "n2", matchType: "tag" }), hit({ id: "q1", kind: "quick-note", matchType: "tag" })];
    const merged = mergeSearchHits(native, tags);
    expect(merged.map(hitKey)).toEqual(["note:n1", "note:n2", "quick-note:q1"]);
    // 重复项保留主进程那条（标题命中优先于标签命中）
    expect(merged[0].matchType).toBe("title");
  });

  it("没有标签命中时原样返回（不复制不必要的排序）", () => {
    const native = [hit({ id: "a", matchType: "body" }), hit({ id: "b", matchType: "title" })];
    expect(mergeSearchHits(native, []).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("空态/无结果引导文案", () => {
  it("空关键词：说明搜标题/正文/标签 + ⌘K 唤起", () => {
    const hint = searchIdleHint();
    expect(hint.title).toContain("标题");
    expect(hint.title).toContain("正文");
    expect(hint.title).toContain("标签");
    expect(hint.detail).toContain("⌘K");
  });

  it("无结果：范围不是全部时给「放宽范围」出口；全部范围时给关键词建议", () => {
    expect(searchNoResultHint("all")).toMatchObject({ broadenToAll: false });
    expect(searchNoResultHint("title")).toMatchObject({ broadenToAll: true });
    expect(searchNoResultHint("title").detail).toContain("标题");
    const tag = searchNoResultHint("tag");
    expect(tag.broadenToAll).toBe(true);
    expect(tag.title).toBe("没有匹配结果");
    expect(tag.detail).toContain("标签");
  });
});
