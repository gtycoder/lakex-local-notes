import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 2000 节点文档树卡死（261027 bug B）的回归栅栏：
 * ① 索引一次 O(n) 构建，childrenOf 不再每次 filter+sort（旧实现 per-node 调用 ⇒ O(n²)）；
 * ② 抽屉树交给 NotebookTreeList 窗口化渲染，工作区不再内联递归渲染整棵树；
 * ③ 行语义（拖拽/长按/行内动作/选中）仍由行上的 data-node-id 与 .mb-row 类承担。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const WORKSPACE = read("./NotebookWorkspace.tsx");
const LIST = read("./NotebookTreeList.tsx");
const HOOK = read("./useNotebookTreeData.ts");
const INDEX = read("./notebookTreeIndex.ts");

describe("文档树索引（O(n) 一次构建）", () => {
  it("索引模块提供分桶 + 可见行 + 首篇文档三个纯函数", () => {
    expect(INDEX).toContain("export function buildNotebookTreeIndex");
    expect(INDEX).toContain("export function flattenVisibleRows");
    expect(INDEX).toContain("export function firstNoteInTree");
    expect(INDEX).toContain("grouped.get(parentId)");
  });

  it("hook 只按 tree 重建索引；childrenOf 不再走 tree.filter（旧 O(n) 每次调用）", () => {
    expect(HOOK).toContain("buildNotebookTreeIndex(tree)");
    expect(HOOK).toContain("useMemo");
    expect(HOOK).toContain("flattenVisibleRows");
    expect(HOOK).not.toMatch(/tree\.filter\(/);
    expect(HOOK).not.toMatch(/\.sort\(/);
  });
});

describe("抽屉树窗口化", () => {
  it("工作区把抽屉交给 NotebookTreeList，不再内联递归 renderBranch", () => {
    expect(WORKSPACE).toContain("<NotebookTreeList");
    expect(WORKSPACE).not.toContain("renderBranch");
    expect(WORKSPACE).not.toMatch(/childrenOf\(notebookId\)\.length === 0/);
  });

  it("大列表用 @tanstack/react-virtual 只挂视口 ± 缓冲（小记时间线同一套）", () => {
    expect(LIST).toContain('from "@tanstack/react-virtual"');
    expect(LIST).toContain("useVirtualizer<HTMLDivElement, HTMLDivElement>");
    expect(LIST).toContain("TREE_VIRTUAL_THRESHOLD = 60");
    expect(LIST).toContain("TREE_OVERSCAN = 8");
    expect(LIST).toContain("measureElement");
    expect(LIST).toMatch(/enabled: virtualEnabled/);
  });

  it("拖拽命中用 closest('[data-node-id]') 解析（窗口化后 elementFromPoint 可能命中 wrapper div）", () => {
    expect(WORKSPACE).toContain('.closest("[data-node-id]")');
    // 行 id 只挂在 <button> 上，wrapper 只带 data-index ⇒ closest 才能穿透包装层拿到行。
    expect(LIST.match(/data-node-id=\{/g)?.length).toBe(1);
    expect(LIST).toContain("data-index={entry.index}");
  });

  it("行语义保留：滚动容器仍是 .side-panel-body，行仍写 data-node-id / data-depth / 落点类", () => {
    expect(LIST).toContain('className="side-panel-body"');
    expect(LIST).toContain("data-node-id={it.id}");
    expect(LIST).toContain("data-depth={row.depth}");
    expect(LIST).toContain("nb-dragging");
    expect(LIST).toContain("drop-line-");
    expect(LIST).toContain("is-selected");
    expect(LIST).toContain("nb-tree-action");
  });
});
