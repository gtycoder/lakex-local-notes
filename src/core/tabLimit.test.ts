import { describe, expect, it } from "vitest";
import { selectEvictionIds, trimTabsToLimit } from "./tabLimit.js";

const tabs = [
  { noteId: "a", lastAccessedAt: 100 },
  { noteId: "b", lastAccessedAt: 200 },
  { noteId: "c", lastAccessedAt: 300 },
  { noteId: "d", lastAccessedAt: 400 },
];

describe("上限按空间独立计算（261110 用户定稿）", () => {
  const mixed = [
    { noteId: "d1", lastAccessedAt: 100, space: "diary" as const },
    { noteId: "d2", lastAccessedAt: 200, space: "diary" as const },
    { noteId: "d3", lastAccessedAt: 300, space: "diary" as const },
    { noteId: "a", lastAccessedAt: 10 },
    { noteId: "b", lastAccessedAt: 20 },
  ];

  it("日记超限只淘汰日记；文档超限只淘汰文档（互不挤占）", () => {
    expect(selectEvictionIds(mixed, { limit: 2, activeNoteId: "d3", space: "diary" })).toEqual(["d1"]);
    expect(selectEvictionIds(mixed, { limit: 1, activeNoteId: "b", space: "library" })).toEqual(["a"]);
  });

  it("不传 space = 旧行为（全量计数，向后兼容）", () => {
    expect(selectEvictionIds(mixed, { limit: 3, activeNoteId: "d3" })).toEqual(["a", "b"]);
  });

  it("trim 只裁本空间，另一空间原样保留", () => {
    const trimmed = trimTabsToLimit(mixed, { limit: 2, activeNoteId: "d3", space: "diary" });
    expect(trimmed.map((tab) => tab.noteId)).toEqual(["d2", "d3", "a", "b"]);
  });
});

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

  it("protectNoteIds：保存失败的候选被保留且不补位（不顺手淘汰其它未持久化标签）", () => {
    // limit=2 → evictCount=2；LRU 候选 [b,c]，保护 b → 只淘汰 c（不补位淘汰 d）
    expect(selectEvictionIds(tabs, { limit: 2, activeNoteId: "a", protectNoteIds: new Set(["b"]) })).toEqual(["c"]);
    // 未被保护时行为不变
    expect(selectEvictionIds(tabs, { limit: 2, activeNoteId: "a" })).toEqual(["b", "c"]);
    // trim 同样保留受保护者
    const next = trimTabsToLimit(tabs, { limit: 2, activeNoteId: "a", protectNoteIds: new Set(["b"]) });
    expect(next.map((t) => t.noteId)).toEqual(["a", "b", "d"]);
  });

  it("trimTabsToLimit 幂等返回封顶数组", () => {
    const next = trimTabsToLimit(tabs, { limit: 2, activeNoteId: "d", pinnedNoteIds: new Set(["a"]) });
    expect(next.map((t) => t.noteId)).toEqual(["a", "d"]);
    // 已在上限内：原样返回
    const unchanged = trimTabsToLimit(tabs.slice(0, 2), { limit: 2, activeNoteId: "a" });
    expect(unchanged.map((t) => t.noteId)).toEqual(["a", "b"]);
  });
});