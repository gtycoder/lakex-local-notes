// @vitest-environment jsdom
/**
 * 目录右键「在上方新建 / 在下方新建」（261120 用户点单）：
 * 两个入口各自拉**我们自己的新建二级菜单**（CREATE_CHILD_ITEMS 六项），选完走统一新建弹窗，
 * 并把「同父级锚点」透传给 onCreate：
 *   上方 = 锚点 sortOrder − 1（第 4 参），下方 = 锚点 sortOrder ⇒ store 在同一事务里把新节点插到紧邻上/下。
 * 同时钉死：**没有第三个独立「新建」**；分组/笔记本行没有任何新建入口。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

const mocks = vi.hoisted(() => ({ batchNotes: vi.fn(), duplicateNotes: vi.fn(), listQuickNoteTags: vi.fn(), createQuickNoteTag: vi.fn(), exportNotesBatch: vi.fn(), openExportDir: vi.fn(), pickExportDir: vi.fn() }));
vi.mock("../../lib/native", () => ({ native: mocks }));

// Submenu 保留 label + children（本测试要按「上方/下方」分组点条目），其余浮层简化。
vi.mock("../ui/Overlay", () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement("div", { role: "menu" }, children),
  Popover: ({ children }: { children: ReactNode }) => children,
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open === false ? null : createElement("div", { role: "dialog" }, children),
  NativeDialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open === false ? null : createElement("div", { role: "dialog" }, children),
  Submenu: ({ label, children }: { label?: ReactNode; children: ReactNode }) =>
    createElement("div", { "data-submenu": "1" }, createElement("div", { "data-submenu-label": "1" }, label), children),
}));

import { Sidebar } from "./Sidebar";

type Props = Parameters<typeof Sidebar>[0];
const node = (id: string, nodeType: TreeNode["nodeType"], parentId: string | null, sortOrder = 0): TreeNode => ({
  id, workspaceId: "default", parentId, nodeType, title: id,
  noteFileId: nodeType === "note" ? id : null, sortOrder, createdAt: "t", updatedAt: "t", isConflict: false,
} as TreeNode);
const NODES = [
  node("nb", "notebook", null),
  node("g1", "group", "nb"),
  node("n1", "note", "g1", 2),   // 锚点 sortOrder = 2
];

let host: HTMLDivElement;
let root: Root;
let props: Props;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  mocks.batchNotes.mockReset();
  mocks.duplicateNotes.mockReset();
  mocks.listQuickNoteTags.mockReset().mockResolvedValue([]);
  mocks.createQuickNoteTag.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    nodes: NODES, activeId: null, search: "", mode: "docked", width: 260, minWidth: 200, maxWidth: 480,
    onSearch: () => {}, onRefreshTree: () => {}, onSelect: () => {},
    onCreate: vi.fn(), onRename: () => {}, onMoveNode: () => {}, onRequestDelete: () => {},
    onCopyMarkdown: () => {}, onExportAs: () => {}, onCopyPaths: () => {}, onSetIcon: () => {},
    onShowInfo: () => {}, onOpenHistory: () => {}, lockedNoteIds: new Set(),
    onToggleLockNote: () => {}, revealNodeId: null, onRevealConsumed: () => {},
    pendingRenameId: null, onPendingRenameConsumed: () => {},
    onPreviewEnter: () => {}, onPreviewLeave: () => {}, onResizeActiveChange: () => {},
    onWidthChange: () => {}, onWidthCommit: () => {}, onToggleDock: () => {}, docked: true,
  } as unknown as Props;
  act(() => { root.render(createElement(Sidebar, props)); });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const row = (id: string) => document.body.querySelector<HTMLElement>('[data-tree-node-id="' + id + '"]')!;
const rightClick = (id: string) => act(() => {
  row(id).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
});
const menuButtons = () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menu"] button')];
const submenus = () => [...document.body.querySelectorAll<HTMLElement>("[data-submenu]")];
const submenuByLabel = (text: string) =>
  submenus().find((s) => (s.querySelector("[data-submenu-label]")?.textContent ?? "").includes(text))!;

/** 在指定子菜单里点一个创建项，并在统一弹窗里用默认名提交。 */
const createFrom = async (sub: HTMLElement, label: string) => {
  const item = [...sub.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === label)!;
  act(() => { item.click(); });
  // 统一新建弹窗（NamePromptDialog）里的名称输入框
  const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
  });
};

describe("目录右键 上下方新建（二级菜单）", () => {
  it("两个入口各带我们自己的新建清单（6 项），且没有第三个独立「新建」", () => {
    rightClick("n1");
    const labels = submenus().map((s) => (s.querySelector("[data-submenu-label]")?.textContent ?? "").trim()).filter((t) => t !== "导出");
    expect(labels).toEqual(["在上方新建", "在下方新建"]);
    const items = [...submenuByLabel("在上方新建").querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
    expect(items).toEqual(["新建文档", "新建表格", "新建多维表", "新建画板", "新建手写板", "新建分组"]);
    // 没有第三个「新建」：主菜单里不存在文案恰好是「新建」的按钮
    expect(menuButtons().some((b) => (b.textContent ?? "").trim() === "新建")).toBe(false);
  });

  it("上方新建 → 锚点 = sortOrder-1；下方新建 → 锚点 = sortOrder（六种 kind 都透传）", async () => {
    rightClick("n1");
    await createFrom(submenuByLabel("在上方新建"), "新建表格");
    expect(props.onCreate).toHaveBeenLastCalledWith("usheet", "g1", expect.any(String), 1); // 2-1

    rightClick("n1");
    await createFrom(submenuByLabel("在下方新建"), "新建多维表");
    expect(props.onCreate).toHaveBeenLastCalledWith("bitable", "g1", expect.any(String), 2);

    rightClick("n1");
    await createFrom(submenuByLabel("在上方新建"), "新建分组");
    expect(props.onCreate).toHaveBeenLastCalledWith("group", "g1", expect.any(String), 1);
  });

  it("笔记本 / 分组行没有任何新建入口", () => {
    rightClick("nb");
    expect(submenus().length).toBe(0);
    expect(menuButtons().some((b) => (b.textContent ?? "").includes("新建"))).toBe(false);
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

    rightClick("g1");
    expect(submenus().length).toBe(0);
    expect(menuButtons().some((b) => (b.textContent ?? "").includes("新建"))).toBe(false);
  });
});
