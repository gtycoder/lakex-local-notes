// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/types";

const rendered = vi.hoisted(() => ({ file: 0 }));
vi.mock("lucide-react", async (original) => {
  const icons = await original<typeof import("lucide-react")>();
  return {
    ...icons,
    File: () => {
      rendered.file++;
      return createElement("svg", { "data-file-icon": "true" });
    },
  };
});
// Floating positioning is unrelated to row memoization; test the public Sidebar, not private exports.
vi.mock("./ui/Overlay", () => ({
  Menu: ({ children }: { children: ReactNode }) =>
    createElement("div", { role: "menu" }, children),
  Popover: ({ children }: { children: ReactNode }) => children,
  Dialog: ({ children }: { children: ReactNode }) =>
    createElement("div", { role: "dialog" }, children),
  Submenu: ({ children }: { children: ReactNode }) => children,
}));
import { Sidebar } from "./Sidebar";

type Props = Parameters<typeof Sidebar>[0];
const makeNode = (
  id: string,
  parentId: string | null,
  type: TreeNode["nodeType"] = "note",
): TreeNode => ({
  id,
  parentId,
  workspaceId: "default",
  nodeType: type,
  title: id,
  noteFileId: type === "note" ? id : null,
  sortOrder: 0,
  createdAt: "t",
  updatedAt: "t",
  syncState: "local",
  isConflict: false,
});
const nodes = [
  makeNode("book", null, "notebook"),
  makeNode("group", "book", "group"),
  ...Array.from({ length: 30 }, (_, i) => makeNode(`n${i}`, "group")),
];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: Props;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    nodes,
    activeId: "n0",
    search: "",
    mode: "docked",
    width: 220,
    minWidth: 160,
    maxWidth: 400,
    lockedNoteIds: new Set(),
    revealNodeId: null,
    pendingRenameId: null,
    onSelect: vi.fn(),
    onSearch: vi.fn(),
    onRefreshTree: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onMoveNode: vi.fn(),
    onRequestDelete: vi.fn(),
    onCopyMarkdown: vi.fn(),
    onExportAs: vi.fn(),
    onCopyPaths: vi.fn(),
    onSetIcon: vi.fn(),
    onShowInfo: vi.fn(),
    onOpenHistory: vi.fn(),
    onToggleLockNote: vi.fn(),
    onRevealConsumed: vi.fn(),
    onPendingRenameConsumed: vi.fn(),
    onPreviewEnter: vi.fn(),
    onPreviewLeave: vi.fn(),
    onResizeActiveChange: vi.fn(),
    onWidthChange: vi.fn(),
    onWidthCommit: vi.fn(),
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = (patch: Partial<Props> = {}) => {
  props = { ...props, ...patch };
  act(() => root.render(createElement(Sidebar, props)));
};
const row = (id: string) =>
  host.querySelector<HTMLElement>(`[data-tree-node-id="${id}"]`)!;
const click = (element: HTMLElement) => act(() => element.click());

describe("目录行缓存：公共 Sidebar 的更新与交互", () => {
  it("切换深层活动文档只重建旧/新行内容，不重建其余图标", () => {
    render();
    rendered.file = 0;
    render({ activeId: "n1" });
    expect(rendered.file).toBeLessThanOrEqual(4);
    expect(host.querySelectorAll(".tree-row.active")).toHaveLength(1);
    expect(row("n1").classList.contains("active")).toBe(true);
    expect(row("n0").classList.contains("active")).toBe(false);
    expect(row("n1").classList.contains("context")).toBe(true);
  });
  it("回调改变时点击使用新回调，不能缓存旧闭包", () => {
    const old = vi.fn(),
      next = vi.fn();
    render({ onSelect: old });
    render({ onSelect: next });
    click(row("n2"));
    expect(old).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith("n2");
  });
  it("重命名、图标与锁定更新仍传入行内容", () => {
    render();
    render({
      nodes: nodes.map((n) =>
        n.id === "n2" ? { ...n, title: "新名称", icon: "⭐" } : n,
      ),
      lockedNoteIds: new Set(["n2"]),
    });
    expect(row("n2").textContent).toContain("新名称");
    expect(row("n2").textContent).toContain("⭐");
    expect(row("n2").querySelector('[aria-label="已锁定"]')).not.toBeNull();
    render({ lockedNoteIds: new Set() });
    expect(row("n2").querySelector('[aria-label="已锁定"]')).toBeNull();
  });
  it("折叠祖先后切到另一文档会重新展开并定位", () => {
    render();
    click(row("group").querySelector<HTMLButtonElement>(".tree-chevron")!);
    expect(row("n1")).toBeNull();
    render({ activeId: "n1" });
    expect(row("n1")).not.toBeNull();
  });
  it("文档被打开不自动展开它的子文档", () => {
    render({ nodes: [...nodes, makeNode("child", "n3")] });
    render({ activeId: "n3" });
    expect(row("child")).toBeNull();
    click(row("n3").querySelector<HTMLButtonElement>(".tree-chevron")!);
    expect(row("child")).not.toBeNull();
  });
  it("筛选与清除后可见行集合正确", () => {
    render();
    render({ search: "n29" });
    expect(row("n29")).not.toBeNull();
    expect(row("n1")).toBeNull();
    render({ search: "" });
    expect(row("n1")).not.toBeNull();
  });
  it("刷新节点集合可以新增、移走和删除行", () => {
    render();
    render({
      nodes: [...nodes.filter((n) => n.id !== "n1"), makeNode("new", "book")],
    });
    expect(row("n1")).toBeNull();
    expect(row("new")).not.toBeNull();
    render({
      nodes: props.nodes.map((n) =>
        n.id === "new" ? { ...n, parentId: "group" } : n,
      ),
    });
    expect(
      row("new")
        .closest(".tree-item")
        ?.parentElement?.closest(".tree-item")
        ?.querySelector(".tree-row")
        ?.getAttribute("data-tree-node-id"),
    ).toBe("group");
  });
  it("行内新建菜单作用于当前行，不吞掉事件", () => {
    render();
    click(
      row("n3").querySelector<HTMLButtonElement>('[aria-label="新建子项"]')!,
    );
    const newDoc = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (e) => e.textContent === "新建文档",
    );
    expect(newDoc).toBeTruthy();
    click(newDoc!);
    expect(props.onCreate).toHaveBeenCalledWith("note", "n3");
  });
  it("稳定保存失败回调源头，避免 onSelect 引用链再次失效", () => {
    const app = readFileSync(path.resolve("src/App.tsx"), "utf8");
    expect(app).toContain("const handleBlockedSave = useCallback(");
    expect(app).toContain("onBlockedSave: handleBlockedSave");
    expect(app).not.toContain("onBlockedSave: () =>");
  });
});
