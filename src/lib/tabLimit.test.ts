import { describe, expect, it } from "vitest";
import { selectEvictionIds, trimTabsToLimit } from "./tabLimit";

const tabs = [
  { noteId: "a", lastAccessedAt: 100 },
  { noteId: "b", lastAccessedAt: 200 },
  { noteId: "c", lastAccessedAt: 300 },
  { noteId: "d", lastAccessedAt: 400 },
];

describe("selectEvictionIds", () => {
  it("limit=0 不淘汰", () => {
    expect(selectEvictionIds(tabs, { limit: 0, activeNoteId: "a" })).toEqual([]);
  });

  it("未超限不淘汰", () => {
    expect(selectEvictionIds(tabs, { limit: 5, activeNoteId: "a" })).toEqual([]);
  });

  it("按 LRU 淘汰最旧标签", () => {
    expect(selectEvictionIds(tabs, { limit: 3, activeNoteId: "a" })).toEqual(["b"]);
    expect(selectEvictionIds(tabs, { limit: 2, activeNoteId: "a" })).toEqual(["b", "c"]);
  });

  it("激活标签永不淘汰", () => {
    expect(selectEvictionIds(tabs, { limit: 3, activeNoteId: "b" })).toEqual(["a"]);
    expect(selectEvictionIds(tabs, { limit: 1, activeNoteId: "b" })).toEqual(["a", "c", "d"]);
  });

  it("钉住标签保护：有非钉住候选时先淘汰非钉住", () => {
    const pinned = new Set(["a"]);
    expect(selectEvictionIds(tabs, { limit: 3, activeNoteId: null, pinnedNoteIds: pinned })).toEqual(["b"]);
    expect(selectEvictionIds(tabs, { limit: 1, activeNoteId: null, pinnedNoteIds: pinned })).toEqual(["b", "c", "d"]);
  });

  it("全部钉住时按 LRU 淘汰钉住标签（避免无法打开新标签）", () => {
    const pinned = new Set(["a", "b", "c"]);
    expect(selectEvictionIds(tabs, { limit: 3, activeNoteId: "d", pinnedNoteIds: pinned })).toEqual(["a"]);
  });

  it("trimTabsToLimit 幂等返回封顶数组", () => {
    const next = trimTabsToLimit(tabs, { limit: 2, activeNoteId: "d", pinnedNoteIds: new Set(["a"]) });
    expect(next.map((t) => t.noteId)).toEqual(["a", "d"]);
    // 已在上限内：原样返回
    const unchanged = trimTabsToLimit(tabs.slice(0, 2), { limit: 2, activeNoteId: "a" });
    expect(unchanged.map((t) => t.noteId)).toEqual(["a", "b"]);
  });
});
