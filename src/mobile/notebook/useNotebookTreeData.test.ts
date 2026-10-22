// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  listNotebookTree: vi.fn(),
  listTreeNodes: vi.fn(),
}));

vi.mock("../bridge", () => ({
  bridge: {
    listNotebookTree: bridgeMocks.listNotebookTree,
    listTreeNodes: bridgeMocks.listTreeNodes,
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
  bridgeMocks.listNotebookTree.mockResolvedValue([
    { id: "g1", title: "分组", kind: "group", parentId: "nb1", sortOrder: 2, icon: null },
    { id: "n2", title: "后", kind: "note", parentId: "nb1", sortOrder: 2, icon: null },
    { id: "n1", title: "前", kind: "note", parentId: "nb1", sortOrder: 1, icon: null },
  ]);
  bridgeMocks.listTreeNodes.mockResolvedValue([
    { id: "nb1", title: "笔记本", icon: "book" },
  ]);
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
    expect(data.tree.map((item) => item.id)).toEqual(["g1", "n2", "n1"]);
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

  it("loadTree 可重新读取并刷新笔记本元数据", async () => {
    await render();
    bridgeMocks.listTreeNodes.mockResolvedValueOnce([{ id: "nb1", title: "新标题", icon: null }]);
    await act(async () => { await data.loadTree(); });
    expect(data.title).toBe("新标题");
    expect(data.notebookIcon).toBeNull();
  });
});
