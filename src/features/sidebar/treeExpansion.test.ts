// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearExpandedNodeIds, pruneExpandedNodeIds, readExpandedNodeIds, writeExpandedNodeIds } from "./treeExpansion";
import type { TreeNode } from "../../core/sharedTypes";

const KEY = "lakex-local-notes-v3.sidebar-expanded";
const node = (id: string, parentId: string | null = null, nodeType: TreeNode["nodeType"] = "group"): TreeNode => ({ id, parentId, nodeType } as TreeNode);

beforeEach(() => {
  localStorage.clear();
  clearExpandedNodeIds();
});

describe("目录展开态的设备本地记忆（261121 用户报「收起后重开又全展开」）", () => {
  it("没有记录 = null（调用方走默认展开，老用户升级不改观感）", () => {
    expect(readExpandedNodeIds()).toBeNull();
  });

  it("写读往返；**空数组要原样记住**（用户主动全部收起 ≠ 从没记过）", () => {
    writeExpandedNodeIds(["a", "b"]);
    expect(readExpandedNodeIds()).toEqual(["a", "b"]);
    writeExpandedNodeIds([]);
    expect(readExpandedNodeIds()).toEqual([]);
  });

  it("写入去重；坏 JSON / 非数组一律回落 null（不阻塞目录渲染）", () => {
    writeExpandedNodeIds(["a", "a", "b"]);
    expect(readExpandedNodeIds()).toEqual(["a", "b"]);
    localStorage.setItem(KEY, "{oops");
    expect(readExpandedNodeIds()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ not: "array" }));
    expect(readExpandedNodeIds()).toBeNull();
  });

  it("本地存储不可用（隐私模式/配额满）时读写都不抛", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      expect(() => writeExpandedNodeIds(["a"])).not.toThrow();
      expect(readExpandedNodeIds()).toBeNull();
      expect(() => clearExpandedNodeIds()).not.toThrow();
    } finally {
      setItem.mockRestore();
      getItem.mockRestore();
    }
  });

  it("按当前树裁剪：删掉的节点 id 不残留、重复只留一份", () => {
    const nodes = [node("n1", null, "notebook"), node("g1"), node("d1", "g1", "note")];
    expect(pruneExpandedNodeIds(["n1", "gone", "g1", "n1", "d1"], nodes)).toEqual(["n1", "g1", "d1"]);
    expect(pruneExpandedNodeIds(["gone"], nodes)).toEqual([]);
  });
});
