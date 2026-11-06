// @vitest-environment jsdom
/** 桌面「置顶」设备本地存储（261107）：纯读写 + 保序 + 批量 + 拖拽重排。 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  isPinnedTreeId,
  readPinnedOpen,
  readPinnedTreeIds,
  reorderPinnedTreeIds,
  setPinnedTreeIds,
  togglePinnedTreeId,
  writePinnedOpen,
  writePinnedTreeIds,
} from "./pinnedTree";

beforeEach(() => {
  localStorage.clear();
});

describe("桌面置顶（设备本地）", () => {
  it("默认空；toggle 追加/移除且返回切换后的状态", () => {
    expect(readPinnedTreeIds()).toEqual([]);
    expect(togglePinnedTreeId("a")).toBe(true);
    expect(togglePinnedTreeId("b")).toBe(true);
    expect(readPinnedTreeIds()).toEqual(["a", "b"]);
    expect(isPinnedTreeId("a")).toBe(true);
    expect(togglePinnedTreeId("a")).toBe(false);
    expect(readPinnedTreeIds()).toEqual(["b"]);
  });

  it("批量置顶按传入顺序追加（已存在保持原位）；批量取消只删目标，不误伤其它", () => {
    writePinnedTreeIds(["a"]);
    expect(setPinnedTreeIds(["c", "b", "a"], true)).toEqual(["a", "c", "b"]);
    expect(setPinnedTreeIds(["c"], false)).toEqual(["a", "b"]);
  });

  it("拖拽重排：拖到目标前/后；id 不存在时原序返回", () => {
    const ids = ["a", "b", "c"];
    expect(reorderPinnedTreeIds(ids, "c", "a", "before")).toEqual(["c", "a", "b"]);
    expect(reorderPinnedTreeIds(ids, "a", "c", "after")).toEqual(["b", "c", "a"]);
    expect(reorderPinnedTreeIds(ids, "a", "a", "before")).toEqual(ids);
    expect(reorderPinnedTreeIds(ids, "zz", "a", "before")).toEqual(ids);
  });

  it("坏 JSON 回落空表；展开态默认开、可持久化", () => {
    localStorage.setItem("lakex-local-notes-v3.sidebar-pinned", "{bad");
    expect(readPinnedTreeIds()).toEqual([]);
    expect(readPinnedOpen()).toBe(true);
    writePinnedOpen(false);
    expect(readPinnedOpen()).toBe(false);
  });
});
