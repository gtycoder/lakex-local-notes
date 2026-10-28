// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  getWorkspaceSnapshot: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    getWorkspaceSnapshot: bridgeMocks.getWorkspaceSnapshot,
  },
}));

import { useNotebookTreeData } from "./useNotebookTreeData";

type Data = ReturnType<typeof useNotebookTreeData>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let data: Data;

function Harness() {
  data = useNotebookTreeData("nb1");
  return null;
}

const render = async () => {
  await act(async () => { root.render(createElement(Harness)); });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  bridgeMocks.getWorkspaceSnapshot.mockResolvedValue({
    notebook: { id: "nb1", title: "笔记本", icon: "book", nodeType: "notebook" },
    tree: [
      { id: "g1", title: "分组", kind: "group", parentId: "nb1", sortOrder: 2, icon: null },
      { id: "n2", title: "后", kind: "note", parentId: "nb1", sortOrder: 2, icon: null },
      { id: "n1", title: "前", kind: "note", parentId: "nb1", sortOrder: 1, icon: null },
      { id: "n3", title: "子文档", kind: "note", parentId: "g1", sortOrder: 1, icon: null },
    ],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("useNotebookTreeData", () => {
  it("加载当前笔记本子树、标题与图标", async () => {
    await render();
    expect(data.tree.map((item) => item.id)).toEqual(["g1", "n2", "n1", "n3"]);
    expect(data.title).toBe("笔记本");
    expect(data.notebookIcon).toBe("book");
    expect(data.expanded.has("nb1")).toBe(true);
  });

  it("子节点按 sortOrder 排序，展开集合支持切换与幂等展开", async () => {
    await render();
    expect(data.childrenOf("nb1").map((item) => item.id)).toEqual(["n1", "g1", "n2"]);
    act(() => data.toggleGroup("g1"));
    expect(data.expanded.has("g1")).toBe(true);
    act(() => data.toggleGroup("g1"));
    expect(data.expanded.has("g1")).toBe(false);
    act(() => { data.expandGroup("g1"); data.expandGroup("g1"); });
    expect(data.expanded.has("g1")).toBe(true);
  });

  it("可见行 = 展开分支的扁平行（折叠时不含子行；展开父节点后子行紧随、depth+1）", async () => {
    await render();
    expect(data.visibleRows.map((row) => row.item.id)).toEqual(["n1", "g1", "n2"]);
    expect(data.visibleRows.every((row) => row.depth === 0)).toBe(true);

    act(() => data.expandGroup("g1"));
    expect(data.visibleRows.map((row) => row.item.id)).toEqual(["n1", "g1", "n3", "n2"]);
    const child = data.visibleRows.find((row) => row.item.id === "n3");
    expect(child?.depth).toBe(1);
  });

  it("itemById 走索引（替代 tree.find）；firstNote 深度优先取第一篇文档", async () => {
    await render();
    expect(data.itemById("n2")?.title).toBe("后");
    expect(data.itemById("missing")).toBeUndefined();
    expect(data.firstNote?.id).toBe("n1");
  });

  it("loadTree 可重新读取并刷新笔记本元数据", async () => {
    await render();
    bridgeMocks.getWorkspaceSnapshot.mockResolvedValueOnce({
      notebook: { id: "nb1", title: "新标题", icon: null, nodeType: "notebook" },
      tree: data.tree,
    });
    await act(async () => { await data.loadTree(); });
    expect(data.title).toBe("新标题");
    expect(data.notebookIcon).toBeNull();
  });

  it("tree 变化才重建索引：未变时 childrenOf 引用稳定（不会每次渲染 filter 一遍）", async () => {
    await render();
    const firstRef = data.childrenOf;
    bridgeMocks.getWorkspaceSnapshot.mockResolvedValueOnce({
      notebook: { id: "nb1", title: "笔记本", icon: "book", nodeType: "notebook" },
      tree: data.tree,
    });
    await act(async () => { await data.loadTree(); });
    expect(data.childrenOf).toBe(firstRef);
  });
});
