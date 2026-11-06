// @vitest-environment jsdom
/** 桌面「置顶」区渲染（261107）：顶部独立分组、可折叠、分组带子级、入口点击/右键。 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";
import { SidebarPinnedSection } from "./SidebarPinnedSection";

const node = (id: string, nodeType: TreeNode["nodeType"], parentId: string | null, sortOrder: number, title = id): TreeNode => ({
  id, title, parentId, sortOrder, nodeType, noteFileId: nodeType === "note" ? id : null,
  kind: "doc", icon: null, createdAt: "t", updatedAt: "t", isConflict: false,
} as TreeNode);

const NODES = [
  node("nb", "notebook", null, 0),
  node("g1", "group", "nb", 0, "分组"),
  node("n1", "note", "g1", 0, "子文档"),
  node("n2", "note", "nb", 1, "另一篇"),
];
const locked = new Set<string>();

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const render = (pinnedIds: string[], over: Partial<Parameters<typeof SidebarPinnedSection>[0]> = {}) => {
  const props = {
    nodes: NODES,
    pinnedIds,
    activeId: null,
    lockedNoteIds: locked,
    open: true,
    onToggleOpen: vi.fn(),
    onSelect: vi.fn(),
    onContextMenu: vi.fn(),
    onReorder: vi.fn(),
    ...over,
  };
  act(() => root.render(createElement(SidebarPinnedSection, props)));
  return props;
};
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-pinned-node-id]")];

describe("桌面置顶区", () => {
  it("无置顶项时不渲染（不占目录空间）", () => {
    render([]);
    expect(document.querySelector(".sidebar-pinned")).toBeNull();
  });

  it("笔记本不可置顶：即使传入笔记本 id 也不渲染（组件层兜底）", () => {
    render(["nb"]);
    expect(document.querySelector(".sidebar-pinned")).toBeNull();
  });

  it("顶部独立分组：标题「置顶」+ 分隔线 + 按存储顺序渲染入口", () => {
    render(["n2", "n1"]);
    expect(document.querySelector(".sidebar-pinned__header")?.textContent).toContain("置顶");
    expect(document.querySelector(".sidebar-pinned__divider")).not.toBeNull();
    expect(rows().map((row) => row.dataset.pinnedNodeId)).toEqual(["n2", "n1"]);
  });

  it("分组置顶时连同子级显示；分组可单独折叠", () => {
    render(["g1"]);
    expect(rows().map((row) => row.dataset.pinnedNodeId)).toEqual(["g1", "n1"]);
    act(() => { document.querySelector<HTMLElement>('[data-pinned-node-id="g1"] .tree-chevron')!.click(); });
    expect(rows().map((row) => row.dataset.pinnedNodeId)).toEqual(["g1"]);
  });

  it("整段可折叠（onToggleOpen）；折叠后不渲染行", () => {
    const props = render(["n1"], { open: false, onToggleOpen: vi.fn() });
    expect(rows()).toHaveLength(0);
    act(() => { document.querySelector<HTMLElement>(".sidebar-pinned__header")!.click(); });
    expect(props.onToggleOpen).toHaveBeenCalledTimes(1);
  });

  it("文档入口点击 = 打开文档；右键走单条菜单回调", () => {
    const props = render(["n1"]);
    act(() => { document.querySelector<HTMLElement>('[data-pinned-node-id="n1"]')!.click(); });
    expect(props.onSelect).toHaveBeenCalledWith("n1");
    act(() => {
      document.querySelector<HTMLElement>('[data-pinned-node-id="n1"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    expect(props.onContextMenu).toHaveBeenCalledTimes(1);
  });

  it("同一节点既被单独置顶、又在置顶父级下时，只作为顶层入口出现一次", () => {
    render(["g1", "n1"]);
    expect(rows().map((row) => row.dataset.pinnedNodeId)).toEqual(["g1", "n1"]);
    // g1 子树里的 n1 被跳过（顶层已出现），不会出现两个 n1
    expect(rows().filter((row) => row.dataset.pinnedNodeId === "n1")).toHaveLength(1);
  });
});
