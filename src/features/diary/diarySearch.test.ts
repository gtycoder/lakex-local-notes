import { describe, expect, it } from "vitest";
import { filterDiarySearchHits } from "./diarySearch";

/** 搜索结果按「日记条目文档 id 集合」收窄：只留 note 类命中，小记/非日记文档一律排除。 */
describe("日记搜索结果收窄（待接 SearchPanel 的纯判据）", () => {
  const ids = new Set(["note-1109", "note-1108"]);
  it("只留日记条目；保持原顺序、不改字段", () => {
    const hits = [
      { id: "note-1109", title: "2026-11-09", snippet: "", matchType: "body" as const },
      { id: "note-other", title: "别的文档", snippet: "", matchType: "title" as const },
      { id: "note-1108", title: "2026-11-08", snippet: "", matchType: "title" as const },
    ];
    expect(filterDiarySearchHits(hits, ids).map((hit) => hit.id)).toEqual(["note-1109", "note-1108"]);
  });

  it("小记命中永不算日记（即使 id 撞名）；缺 kind 按 note 处理", () => {
    const hits = [
      { id: "note-1109", kind: "quick-note" as const, title: "小记", snippet: "", matchType: "body" as const },
      { id: "note-1109", title: "日记", snippet: "", matchType: "body" as const },
    ];
    expect(filterDiarySearchHits(hits, ids)).toHaveLength(1);
    expect(filterDiarySearchHits(hits, ids)[0].kind).toBeUndefined();
  });

  it("空集合 / 空结果都返回空数组（不抛错）", () => {
    expect(filterDiarySearchHits([], ids)).toEqual([]);
    expect(filterDiarySearchHits([{ id: "note-1109", title: "x", snippet: "", matchType: "body" }], new Set<string>())).toEqual([]);
  });
});
