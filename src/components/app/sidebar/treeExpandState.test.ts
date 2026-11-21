/**
 * 桌面目录树展开态单测（261119 用户点单）：
 * ① 收起某节点 ⇒ 整棵子树展开态全部清除（3 层验证）；
 * ② 再点展开 ⇒ 只开一级（子级可见、子级自身保持收起，孙子收起）；
 * ③ 展开-收起-再展开循环幂等；
 * ④ 展开态不持久化（本就无持久化：注释写明 + 无任何存储/设备状态读写断言）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../../lib/types";
import { toggleExpandedNode } from "./treeExpandState";

const node = (id: string, parentId: string | null, nodeType: TreeNode["nodeType"] = "group"): TreeNode => ({
  id,
  parentId,
  workspaceId: "default",
  nodeType,
  title: id,
  noteFileId: nodeType === "note" ? id : null,
  sortOrder: 0,
  createdAt: "t",
  updatedAt: "t",
  isConflict: false,
});

// 三层以上：nb（笔记本）> g1 > g2 > g3 > n（文档）；g1 另有直接文档子级 leaf。
const NODES: TreeNode[] = [
  node("nb", null, "notebook"),
  node("g1", "nb"),
  node("g2", "g1"),
  node("g3", "g2"),
  node("n", "g3", "note"),
  node("leaf", "g1", "note"),
];

const sorted = (ids: ReadonlySet<string>): string[] => [...ids].sort();

describe("① 收起清子树展开态", () => {
  it("收起中间节点：自身与三层后代全部清除，祖先/兄弟保留", () => {
    const openAll = new Set(["nb", "g1", "g2", "g3"]);
    const next = toggleExpandedNode(openAll, "g1", NODES);
    expect(sorted(next)).toEqual(["nb"]);
    // 不就地修改传入集合
    expect(sorted(openAll)).toEqual(["g1", "g2", "g3", "nb"]);
  });

  it("收起根节点：整棵子树（含各层文档）清空", () => {
    const next = toggleExpandedNode(new Set(["nb", "g1", "g2", "g3"]), "nb", NODES);
    expect(sorted(next)).toEqual([]);
  });

  it("收起叶子容器：只影响自己那一支，不碰兄弟分支", () => {
    // nb > g1 > {g2 > g3, leaf}，另造一个兄弟分支 gX
    const nodes = [...NODES, node("gX", "nb"), node("gXChild", "gX")];
    const next = toggleExpandedNode(new Set(["nb", "g1", "g2", "g3", "gX", "gXChild"]), "g2", nodes);
    expect(sorted(next)).toEqual(["gX", "gXChild", "nb", "g1"].sort());
  });
});

describe("② 再点展开只开一级", () => {
  it("收起再展开：直接子级可见但保持收起，孙子不展开", () => {
    let state = toggleExpandedNode(new Set(["nb", "g1", "g2", "g3"]), "g1", NODES); // 收起
    state = toggleExpandedNode(state, "g1", NODES); // 再展开
    expect(sorted(state)).toEqual(["g1", "nb"]);
    expect(state.has("g2")).toBe(false); // 子级自身保持收起
    expect(state.has("g3")).toBe(false); // 孙子收起
    expect(state.has("n")).toBe(false);
    expect(state.has("leaf")).toBe(false);
  });

  it("展开侧同样清子树：后代被其它入口写回过也只开一级（首次展开只开一级）", () => {
    // 模拟：g1 收起期间，同步新增容器的自动展开把 g2/g3 写回展开集
    const polluted = new Set(["nb", "g2", "g3"]);
    const next = toggleExpandedNode(polluted, "g1", NODES);
    expect(sorted(next)).toEqual(["g1", "nb"]);
  });

  it("逐级按需展开：一级一级点开才逐层可见", () => {
    let state = toggleExpandedNode(new Set(["nb"]), "g1", NODES);
    expect(sorted(state)).toEqual(["g1", "nb"]);
    state = toggleExpandedNode(state, "g2", NODES);
    expect(sorted(state)).toEqual(["g1", "g2", "nb"]);
    state = toggleExpandedNode(state, "g3", NODES);
    expect(sorted(state)).toEqual(["g1", "g2", "g3", "nb"]);
  });
});

describe("③ 展开-收起-再展开循环幂等", () => {
  it("两态来回切换，重复循环结果不变", () => {
    const base = new Set(["nb"]);
    const open1 = toggleExpandedNode(base, "g1", NODES);
    const closed1 = toggleExpandedNode(open1, "g1", NODES);
    expect(sorted(closed1)).toEqual(sorted(base));
    for (let round = 0; round < 3; round += 1) {
      const openN = toggleExpandedNode(closed1, "g1", NODES);
      expect(sorted(openN)).toEqual(sorted(open1));
      const closedN = toggleExpandedNode(openN, "g1", NODES);
      expect(sorted(closedN)).toEqual(sorted(base));
    }
  });

  it("深层展开后收起再展开：孙子级不被记住（回到一级）", () => {
    let state = toggleExpandedNode(new Set<string>(), "g1", NODES);
    state = toggleExpandedNode(state, "g2", NODES);
    state = toggleExpandedNode(state, "g3", NODES);
    expect(sorted(state)).toEqual(["g1", "g2", "g3"]);
    state = toggleExpandedNode(state, "g1", NODES); // 收起全部
    expect(sorted(state)).toEqual([]);
    state = toggleExpandedNode(state, "g1", NODES); // 再展开只开一级
    expect(sorted(state)).toEqual(["g1"]);
    // 再来一轮，结论不变
    state = toggleExpandedNode(state, "g1", NODES);
    state = toggleExpandedNode(state, "g1", NODES);
    expect(sorted(state)).toEqual(["g1"]);
  });
});

describe("④ 展开态 = 设备本地记忆（261121 用户报「收起后重开又全展开」⇒ 反转 261119 的会话内口径）", () => {
  const SIDEBAR = readFileSync(new URL("../Sidebar.tsx", import.meta.url), "utf8");
  const EXPAND = readFileSync(new URL("./treeExpandState.ts", import.meta.url), "utf8");
  const STORE = readFileSync(new URL("../../../features/sidebar/treeExpansion.ts", import.meta.url), "utf8");

  it("存储单一来源：treeExpansion.ts 用 localStorage，且明确「空数组 = 主动全部收起」", () => {
    expect(STORE).toContain("lakex-local-notes-v3.sidebar-expanded");
    expect(STORE).toContain("localStorage");
    expect(STORE).toContain("空数组 = 用户主动全部收起");
    // 切换语义模块不碰存储（单一职责；注释里提到不算）
    const code = EXPAND.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/localStorage/);
  });

  it("接线：初始值优先读记忆、没有记忆才默认展开；树同步后才写回；refresh 只裁剪", () => {
    expect(SIDEBAR).toContain("readExpandedNodeIds()");
    expect(SIDEBAR).toContain("writeExpandedNodeIds([...expanded])");
    expect(SIDEBAR).toContain("pruneExpandedNodeIds([...base], props.nodes)");
    expect(SIDEBAR).toContain("new Set(stored ?? autoExpanded(props.nodes))");
    // 启动空树不许写回（否则把"没记录"写成"全部收起"）
    expect(SIDEBAR).toContain("if (!treeSyncedRef.current) return;");
  });

  it("行切换仍走 toggleExpandedNode（收起清整棵子树）", () => {
    expect(SIDEBAR).toContain("setExpanded((current) => toggleExpandedNode(current, id, props.nodes))");
  });

  it("启动首帧空树不把全部笔记本当「新节点」展开（261122 真因：记忆被全量展开覆盖）", () => {
    // prevNodeIds 必须是 null 起手（= 未建立基线），第一次拿到真实树只记基线
    expect(SIDEBAR).toContain("useRef<Set<string> | null>(null)");
    expect(SIDEBAR).toContain("if (prevNodeIds.current === null) {");
    expect(SIDEBAR).toContain("只**建立基线**、不展开");
    // 仍然保留「同步新出现的容器自动展开」
    expect(SIDEBAR).toContain("!prevIds.has(n.id)");
  });

  it("冷启动不替用户展开「当前文档的祖先」（有记忆时严格按记忆渲染）", () => {
    expect(SIDEBAR).toContain("严格按上次记忆渲染");
    expect(SIDEBAR).toContain("if (restoredExpandedRef.current.stored !== null) return;");
    expect(SIDEBAR).toContain("startupFollowRef");
  });
});
