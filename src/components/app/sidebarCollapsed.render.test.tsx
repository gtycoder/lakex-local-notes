// @vitest-environment jsdom
/**
 * 桌面「已收起」笔记本（261120 用户点单）：默认收起、收起后从主列表消失并落到目录底部置底区、
 * 展开后行行为与目录一致、展开态记忆、特殊本（回收站/未分类/日记本）逻辑排除且历史残留被清理。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

vi.mock("../../lib/native", () => ({ native: { batchNotes: vi.fn(), duplicateNotes: vi.fn(), listQuickNoteTags: vi.fn(async () => []), createQuickNoteTag: vi.fn(), exportNotesBatch: vi.fn(), openExportDir: vi.fn(), pickExportDir: vi.fn() } }));
vi.mock("../ui/Overlay", () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement("div", { role: "menu" }, children),
  Popover: ({ children }: { children: ReactNode }) => children,
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) => (open === false ? null : createElement("div", { role: "dialog" }, children)),
  NativeDialog: ({ open, children }: { open?: boolean; children: ReactNode }) => (open === false ? null : createElement("div", { role: "dialog" }, children)),
  Submenu: ({ children }: { children: ReactNode }) => children,
}));

import { Sidebar } from "./Sidebar";

type Props = Parameters<typeof Sidebar>[0];
const node = (id: string, nodeType: TreeNode["nodeType"], parentId: string | null = null, extra: Partial<TreeNode> = {}): TreeNode => ({
  id, workspaceId: "default", parentId, nodeType, title: id,
  noteFileId: nodeType === "note" ? id : null, sortOrder: 0, createdAt: "t", updatedAt: "t", isConflict: false, ...extra,
} as TreeNode);
const NODES = [
  node("nb", "notebook"),
  node("nb2", "notebook"),
  node("n1", "note", "nb"),
  node("notebook-trash", "notebook"),
  node("notebook-uncategorized", "notebook"),
  node("nb-diary", "notebook", null, { space: "diary" }),
];

let host: HTMLDivElement;
let root: Root;
let props: Props;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    nodes: NODES, activeId: null, search: "", mode: "docked", width: 220, minWidth: 160, maxWidth: 400,
    lockedNoteIds: new Set<string>(), revealNodeId: null, pendingRenameId: null,
    onSelect: vi.fn(), onSearch: vi.fn(), onRefreshTree: vi.fn(async () => {}), onCreate: vi.fn(async () => "nb-new"),
    onRename: vi.fn(), onMoveNode: vi.fn(), onRequestDelete: vi.fn(), onCopyMarkdown: vi.fn(),
    onExportAs: vi.fn(), onCopyPaths: vi.fn(), onSetIcon: vi.fn(), onShowInfo: vi.fn(), onOpenHistory: vi.fn(),
    onToggleLockNote: vi.fn(), onRevealConsumed: vi.fn(), onPendingRenameConsumed: vi.fn(),
    onPreviewEnter: vi.fn(), onPreviewLeave: vi.fn(), onResizeActiveChange: vi.fn(),
    onWidthChange: vi.fn(), onWidthCommit: vi.fn(), onTagsChanged: vi.fn(),
  } as unknown as Props;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const render = () => act(() => root.render(createElement(Sidebar, props)));
const navRow = (id: string): HTMLElement | null => document.querySelector<HTMLElement>('.note-list [data-tree-node-id="' + id + '"]');
const collapsedBodyRow = (id: string): HTMLElement | null => document.querySelector<HTMLElement>('.sidebar-collapsed__body [data-tree-node-id="' + id + '"]');
const header = (): HTMLElement | null => document.querySelector<HTMLElement>(".sidebar-collapsed__header");
const rightClick = (id: string) => {
  const target = navRow(id) ?? collapsedBodyRow(id);
  if (!target) throw new Error("找不到行：" + id);
  act(() => { target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })); });
};
const menuTexts = (): string[] => [...document.querySelectorAll('[role="menu"] .ln-menu__item')].map((el) => (el.textContent ?? "").trim());
const clickMenu = (label: string) => {
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] .ln-menu__item')].find((el) => (el.textContent ?? "").trim() === label);
  if (!item) throw new Error("找不到菜单项：" + label);
  act(() => { item.click(); });
};

describe("目录「已收起」笔记本（261120 用户点单）", () => {
  it("默认：没有已收起分区，笔记本都在主列表", () => {
    render();
    expect(header()).toBeNull();
    expect(navRow("nb")).not.toBeNull();
    expect(navRow("nb2")).not.toBeNull();
  });

  it("右键「收起」→ 从主列表消失、落到置底区；分区默认收起，展开后行与目录同款", () => {
    render();
    rightClick("nb");
    expect(menuTexts()).toContain("收起");
    clickMenu("收起");
    // 主列表不再有它；底部区出现（默认收起 ⇒ body 未挂载）
    expect(navRow("nb")).toBeNull();
    expect(header()).not.toBeNull();
    expect(document.querySelector(".sidebar-collapsed__count")?.textContent).toBe("1");
    expect(collapsedBodyRow("nb")).toBeNull();
    // 展开分区：先只出笔记本行 —— 261120 追加口径「已收起里的子级默认也收起」
    act(() => { header()?.click(); });
    expect(collapsedBodyRow("nb")).not.toBeNull();
    expect(collapsedBodyRow("n1")).toBeNull();
    expect(localStorage.getItem("lakex-local-notes-v3.sidebar-collapsed-open")).toBe("1");
  });

  it("取消收起：回到主列表，本地表清空", () => {
    render();
    rightClick("nb");
    clickMenu("收起");
    act(() => { header()?.click(); });
    rightClick("nb");
    expect(menuTexts()).toContain("取消收起");
    clickMenu("取消收起");
    expect(navRow("nb")).not.toBeNull();
    expect(header()).toBeNull();
    expect(localStorage.getItem("lakex-local-notes-v3.sidebar-collapsed-notebooks")).toBe("[]");
  });

  it("已收起里的子级默认收起：分区内可手动逐级展开，且不回写主列表展开态", () => {
    render();
    // 主列表默认展开笔记本（treeExpandState：启动默认展开笔记本/分组）⇒ 子文档可见
    expect(navRow("n1")).not.toBeNull();
    // 收起它：主列表消失，分区默认展开状态 = 收起（即使主列表刚才是展开的）
    rightClick("nb");
    clickMenu("收起");
    act(() => { header()?.click(); });
    expect(collapsedBodyRow("nb")).not.toBeNull();
    expect(collapsedBodyRow("n1")).toBeNull();
    expect(collapsedBodyRow("n3")).toBeNull();
    // 分区内手动展开：只开一级（子文档出现）
    const zoneChevron = collapsedBodyRow("nb")?.querySelector<HTMLButtonElement>(".tree-chevron");
    act(() => { zoneChevron?.click(); });
    expect(collapsedBodyRow("n1")).not.toBeNull();
    // 取消收起：回主列表，主列表记住的展开态仍是展开（分区操作没污染它）
    rightClick("nb");
    clickMenu("取消收起");
    expect(navRow("n1")).not.toBeNull();
  });

  it("特殊本逻辑排除：回收站/未分类/日记本连菜单项都没有", () => {
    render();
    for (const id of ["notebook-trash", "notebook-uncategorized", "nb-diary"]) {
      rightClick(id);
      expect(menuTexts()).not.toContain("收起");
      act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    }
  });

  it("历史残留的非法 id 会被清理（不凭空收起特殊本）", () => {
    localStorage.setItem("lakex-local-notes-v3.sidebar-collapsed-notebooks", JSON.stringify(["nb-diary", "notebook-trash", "nb2"]));
    render();
    expect(JSON.parse(localStorage.getItem("lakex-local-notes-v3.sidebar-collapsed-notebooks") ?? "[]")).toEqual(["nb2"]);
    expect(navRow("nb-diary")).not.toBeNull();
  });

  it("全部收起：主列表显示提示文案，且展开态记忆为收起时不自动展开", () => {
    localStorage.setItem("lakex-local-notes-v3.sidebar-collapsed-notebooks", JSON.stringify(["nb", "nb2"]));
    // 只留两个普通本（特殊本逻辑排除、永远在主列表 ⇒ 不会让主列表空掉）
    act(() => root.render(createElement(Sidebar, { ...props, nodes: [node("nb", "notebook"), node("nb2", "notebook")] })));
    expect(document.querySelector(".note-list .empty-list")?.textContent).toContain("已收起");
    expect(header()).not.toBeNull();
    expect(document.querySelector(".sidebar-collapsed__body")).toBeNull();
  });

  it("特殊本永远在主列表：即使被写进本地表也不会消失", () => {
    localStorage.setItem("lakex-local-notes-v3.sidebar-collapsed-notebooks", JSON.stringify(["notebook-trash", "nb-diary"]));
    render();
    expect(navRow("notebook-trash")).not.toBeNull();
    expect(navRow("nb-diary")).not.toBeNull();
  });
});
