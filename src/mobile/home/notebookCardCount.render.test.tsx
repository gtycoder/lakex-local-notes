// @vitest-environment jsdom
/**
 * 首页「知识库」卡片计数的渲染/接线护栏（261119 用户点单）：
 * 卡片显示的「N 篇」必须是**整棵子树的文档总数** —— 文档全在 4 层分组里时书卡不能显示「0 篇」。
 * 端到端一截：notebookSubtreeDocCounts 的聚合结果 → NotebookGrid 的 .nb-shelf-count / .nb-row__sub。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";
import { notebookSubtreeDocCounts } from "../notebook/notebookDocCounts";
import { NotebookGrid } from "./NotebookGrid";

const node = (over: Partial<TreeNode> & { id: string; nodeType: TreeNode["nodeType"] }): TreeNode => ({
  workspaceId: "mobile",
  parentId: null,
  title: over.title ?? over.id,
  noteFileId: null,
  sortOrder: 0,
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
  isConflict: false,
  ...over,
} as TreeNode);

/** 现场夹具：4 个分组、文档全在分组里（04-交易 红框场景）+ 一本根直属文档的笔记本。 */
const FOLDERS: TreeNode[] = [
  node({ id: "nb-trading", nodeType: "notebook", title: "04-交易" }),
  node({ id: "nb-root", nodeType: "notebook", title: "根直属" }),
  ...["g1", "g2", "g3", "g4"].map((g, i) => node({ id: g, nodeType: "group", parentId: "nb-trading", title: "分组" + (i + 1) })),
  node({ id: "g-deep", nodeType: "group", parentId: "g4", title: "子分组" }),
];
const NOTES = [
  { id: "n1", parentId: "g1" }, { id: "n2", parentId: "g2" }, { id: "n3", parentId: "g3" },
  { id: "n4", parentId: "g-deep" }, { id: "n5", parentId: "n4" }, // 嵌套文档也算
  { id: "r1", parentId: "nb-root" },
];

describe("首页知识库卡片显示子树文档总数", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("书架卡：文档全在分组里也显示总数 5 篇（不是 0 篇）；根直属那本 1 篇", () => {
    const docCounts = notebookSubtreeDocCounts(FOLDERS, NOTES);
    act(() => {
      root.render(createElement(NotebookGrid, {
        notebooks: FOLDERS.filter((n) => n.nodeType === "notebook"),
        docCounts,
        view: "shelf",
        onOpenNotebook: () => undefined,
      }));
    });
    const cards = [...host.querySelectorAll(".nb-shelf-card")];
    expect(cards.map((c) => c.querySelector(".nb-shelf-count")?.textContent)).toEqual(["5 篇", "1 篇"]);
  });

  it("列表行同口径（.nb-row__sub 的 N 篇 与书卡一致）", () => {
    const docCounts = notebookSubtreeDocCounts(FOLDERS, NOTES);
    act(() => {
      root.render(createElement(NotebookGrid, {
        notebooks: FOLDERS.filter((n) => n.nodeType === "notebook"),
        docCounts,
        view: "list",
        onOpenNotebook: () => undefined,
      }));
    });
    const subs = [...host.querySelectorAll(".nb-row")].map((r) => r.querySelector(".nb-row__sub")?.textContent ?? "");
    expect(subs[0]).toMatch(/^5 篇/);
    expect(subs[1]).toMatch(/^1 篇/);
  });
});
