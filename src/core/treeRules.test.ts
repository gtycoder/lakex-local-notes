import { describe, expect, it } from "vitest";
import { assertMoveTarget, assertNodeIcon, assertOrderedChildren, assertRootConstraint, assertTreeNodeTitle, nextSortOrder } from "./treeRules.js";

describe("treeRules 共享目录规则（Phase 0B + P1-5 移动校验）", () => {
  describe("nextSortOrder（对齐桌面 store.ts：MAX(sort_order),-1)+1，空父级首个为 0）", () => {
    it("空父级：首个节点为 0", () => { expect(nextSortOrder(null)).toBe(0); });
    it("已有最大 4 → 5", () => { expect(nextSortOrder(4)).toBe(5); });
    it("MAX=0（首个）→ 1", () => { expect(nextSortOrder(0)).toBe(1); });
    it("与桌面 COALESCE(MAX,-1)+1 语义一致", () => { expect(nextSortOrder(-1)).toBe(0); });
  });

  describe("assertTreeNodeTitle", () => {
    it("正常名称返回 trim 后值", () => { expect(assertTreeNodeTitle("  我的知识库  ")).toBe("我的知识库"); });
    it("空白抛错", () => { expect(() => assertTreeNodeTitle("   ")).toThrow("名称不能为空"); });
    it("空串抛错", () => { expect(() => assertTreeNodeTitle("")).toThrow("名称不能为空"); });
  });

  describe("assertNodeIcon", () => {
    it("null 通过（默认图标）", () => { expect(() => assertNodeIcon(null)).not.toThrow(); });
    it("16 字符内通过", () => { expect(() => assertNodeIcon("📚")).not.toThrow(); });
    it("超长抛错", () => { expect(() => assertNodeIcon("a".repeat(17))).toThrow("无效的图标"); });
  });

  describe("assertRootConstraint（对齐桌面 moveTreeNode 边界保护）", () => {
    it("notebook 根层通过", () => { expect(() => assertRootConstraint("notebook", null)).not.toThrow(); });
    it("notebook 非根层抛错", () => { expect(() => assertRootConstraint("notebook", "g1")).toThrow("notebook 必须位于根层"); });
    it("group 无父节点抛错", () => { expect(() => assertRootConstraint("group", null)).toThrow("note/group 必须位于目录节点下"); });
    it("note 无父节点抛错", () => { expect(() => assertRootConstraint("note", null)).toThrow("note/group 必须位于目录节点下"); });
    it("group 有父节点通过", () => { expect(() => assertRootConstraint("group", "nb1")).not.toThrow(); });
  });

  describe("assertMoveTarget（P1-5，对齐桌面 moveTreeNode）", () => {
    const desc = new Set(["d1"]);
    it("不能移动到自身", () => { expect(() => assertMoveTarget("a", "a", desc, true)).toThrow(/自身/); });
    it("不能移动到后代", () => { expect(() => assertMoveTarget("a", "d1", desc, true)).toThrow(/子节点/); });
    it("父节点不存在", () => { expect(() => assertMoveTarget("a", "x", desc, false)).toThrow(/不存在/); });
    it("合法移动（根层）", () => { expect(() => assertMoveTarget("a", null, desc, true)).not.toThrow(); });
  });

  describe("assertOrderedChildren（P1-5，对齐桌面 validateOrder）", () => {
    it("重复节点", () => { expect(() => assertOrderedChildren(["a","a","b"], ["a","b"], "x")).toThrow(/重复/); });
    it("包含不属于父节点的节点", () => { expect(() => assertOrderedChildren(["a","z"], ["a","b"], "x")).toThrow(/不属于/); });
    it("跨父移动含 movingId 不要求目标父现有子完整", () => { expect(() => assertOrderedChildren(["a"], [], "a")).not.toThrow(); });
    it("同父重排（movingId 已在 currentChildren）完整通过", () => { expect(() => assertOrderedChildren(["b","a"], ["a","b"], "a")).not.toThrow(); });
  });
});
