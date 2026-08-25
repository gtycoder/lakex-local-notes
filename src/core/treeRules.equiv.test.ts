/**
 * Phase 0B 等价验证：移动端 folders CRUD 与桌面 tree_nodes 目录语义一致。
 * 核心规则 = MAX(sort_order)+1（桌面 store.nextSortOrder 与移动端 bridge 共用 treeRules.nextSortOrder）。
 * 注意：桌面有默认笔记本种子（notebook-personal 占 sortOrder 0），首个用户 notebook 是 1；
 * 移动端 folders 表无种子，首个是 0——两端行为一致（MAX+1），只是初始 MAX 不同。
 * 断言：桌面 createNotebook 的 sortOrder == 该父级当前 MAX+1（与 treeRules.nextSortOrder 一致）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../../electron/store.js";
import { assertRootConstraint, assertTreeNodeTitle, nextSortOrder } from "./treeRules.js";

function makeStore(): { store: Store; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "lake-equiv-"));
  return { store: new Store(dir), dir };
}

describe("目录规则两端等价（桌面 Store vs 共享 treeRules）", () => {
  it("桌面 createNotebook.sortOrder == 根层 MAX+1（treeRules.nextSortOrder 语义）", () => {
    const { store, dir } = makeStore();
    const nb1 = store.createNotebook("工作");
    // 桌面有默认笔记本种子：首个用户 notebook 应为 MAX(null)+1（含种子）
    const all = store.listTreeNodes().filter((n) => n.nodeType === "notebook" && n.parentId === null);
    const max = Math.max(...all.map((n) => n.sortOrder));
    expect(nb1.sortOrder).toBe(max); // 新建的排最后
    expect(nb1.sortOrder).toBe(nextSortOrder(max - 1)); // MAX+1 与共享规则一致
    // 第二个 notebook 递增
    const nb2 = store.createNotebook("生活");
    expect(nb2.sortOrder).toBe(nb1.sortOrder + 1);
    expect(nb2.sortOrder).toBe(nextSortOrder(nb1.sortOrder));
    rmSync(dir, { recursive: true, force: true });
  });

  it("group 子级：桌面 == 该父级 MAX+1，与共享 nextSortOrder 一致", () => {
    const { store, dir } = makeStore();
    const nb = store.createNotebook("工作");
    const g1 = store.createGroup(nb.id, "A");
    const g2 = store.createGroup(nb.id, "B");
    expect(g1.sortOrder).toBe(0); // 空父级首个 group 为 0
    expect(g2.sortOrder).toBe(nextSortOrder(g1.sortOrder)); // 1
    rmSync(dir, { recursive: true, force: true });
  });

  it("空标题校验：桌面与移动端一致拒绝空白（C3 加固后两端都走共享 assertTreeNodeTitle）", () => {
    const { store, dir } = makeStore();
    // 桌面 createNotebook/createGroup 已加固（共享 assertTreeNodeTitle + AppError 包装）
    expect(() => store.createNotebook("  ")).toThrowError(/不能为空/);
    expect(() => store.createNotebook("")).toThrowError(/不能为空/);
    // 共享规则拒绝空白
    expect(() => assertTreeNodeTitle("  ")).toThrowError(/不能为空/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("根层约束：桌面 moveTreeNode 边界保护 vs 共享 assertRootConstraint", () => {
    expect(() => assertRootConstraint("notebook", "g1")).toThrowError(/根层/);
    expect(() => assertRootConstraint("group", null)).toThrowError(/目录节点下/);
  });
});