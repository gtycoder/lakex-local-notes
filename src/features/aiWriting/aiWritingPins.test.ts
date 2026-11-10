// @vitest-environment jsdom
/**
 * 置顶对话（261110 用户定稿：搜索 + 置顶，不做对话分组）。
 * 判据在 core（splitPinnedConversations）+ 设备本地存储（本文件），组件只渲染。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { loadPinnedIds, prunePinnedIds, savePinnedIds, togglePinnedId } from "./aiWritingPins";

const KEY = "lakex-local-notes-v3.aiwriting.pins";

describe("aiWritingPins（设备本地置顶）", () => {
  beforeEach(() => { localStorage.clear(); });

  it("未设置/坏数据 ⇒ 空数组（不抛错）", () => {
    expect(loadPinnedIds()).toEqual([]);
    localStorage.setItem(KEY, "not-json");
    expect(loadPinnedIds()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(loadPinnedIds()).toEqual([]);
  });

  it("读写的过滤与去重：空串/非字符串/重复都丢掉；空数组 = 删键", () => {
    savePinnedIds(["a", "a", "", 42 as unknown as string, "b"]);
    expect(loadPinnedIds()).toEqual(["a", "b"]);
    savePinnedIds([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("切换置顶：新置顶放最前；再切换一次移除", () => {
    expect(togglePinnedId([], "a")).toEqual(["a"]);
    expect(togglePinnedId(["a"], "b")).toEqual(["b", "a"]);
    expect(togglePinnedId(["b", "a"], "a")).toEqual(["b"]);
  });

  it("剪枝：只保留仍存在的会话 id（顺序不变）", () => {
    expect(prunePinnedIds(["a", "b", "c"], new Set(["c", "a"]))).toEqual(["a", "c"]);
  });
});
