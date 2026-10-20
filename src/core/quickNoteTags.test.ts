import { describe, expect, it } from "vitest";
import {
  MAX_QUICK_NOTE_TAG_LENGTH,
  MAX_QUICK_NOTE_TAGS,
  addQuickNoteTag,
  buildQuickNoteTagIndex,
  filterQuickNotesByTag,
  normalizeQuickNoteTag,
  normalizeQuickNoteTags,
  removeQuickNoteTag,
} from "./quickNoteTags";

describe("quickNoteTags", () => {
  it("归一标签名并拒绝空名、保留筛选名与超长名", () => {
    expect(normalizeQuickNoteTag("  aaa   bbb  ")).toBe("aaa bbb");
    expect(normalizeQuickNoteTag("e\u0301")).toBe("é");
    expect(() => normalizeQuickNoteTag("   ")).toThrow("标签名不能为空");
    expect(() => normalizeQuickNoteTag("无标签")).toThrow("筛选状态");
    expect(() => normalizeQuickNoteTag("x".repeat(MAX_QUICK_NOTE_TAG_LENGTH + 1))).toThrow("不能超过");
  });

  it("标签列表去重、保持顺序并限制每条小记上限", () => {
    expect(normalizeQuickNoteTags(undefined)).toEqual([]);
    expect(normalizeQuickNoteTags([" 待办 ", "灵感", "待办"])).toEqual(["待办", "灵感"]);
    expect(() => normalizeQuickNoteTags(Array.from({ length: MAX_QUICK_NOTE_TAGS + 1 }, (_, i) => `t${i}`))).toThrow("最多");
  });

  it("新标签插到最前；重复添加不改变顺序", () => {
    expect(addQuickNoteTag(["待办"], "灵感")).toEqual(["灵感", "待办"]);
    expect(addQuickNoteTag(["灵感", "待办"], "灵感")).toEqual(["灵感", "待办"]);
    expect(removeQuickNoteTag(["灵感", "待办"], "灵感")).toEqual(["待办"]);
  });

  it("从全部有效小记派生标签计数与无标签数量", () => {
    const index = buildQuickNoteTagIndex([
      { tags: ["待办", "灵感"] },
      { tags: ["待办", "待办"] },
      { tags: [] },
    ]);
    expect(index.tags).toEqual([{ name: "待办", count: 2 }, { name: "灵感", count: 1 }]);
    expect(index.untaggedCount).toBe(1);
  });

  it("标签筛选支持全部、单标签与无标签", () => {
    const notes = [
      { id: "a", tags: ["待办", "灵感"] },
      { id: "b", tags: ["待办"] },
      { id: "c", tags: [] },
    ];
    expect(filterQuickNotesByTag(notes, { kind: "all" }).map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(filterQuickNotesByTag(notes, { kind: "tag", name: "灵感" }).map((n) => n.id)).toEqual(["a"]);
    expect(filterQuickNotesByTag(notes, { kind: "untagged" }).map((n) => n.id)).toEqual(["c"]);
  });
});
