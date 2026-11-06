
// @vitest-environment jsdom
/**
 * 桌面目录树多选（261106 task-81）：⌘/Ctrl 切换、Shift 区间（跳过笔记本）、Esc/点空白清空、
 * 浮动操作条（文档：移动/移入回收站/打标签；分组：移动）、batch_notes 实参、成功清空刷新、
 * 部分失败保留选择 + 汇总提示。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

const mocks = vi.hoisted(() => ({ batchNotes: vi.fn(), listQuickNoteTags: vi.fn() }));
vi.mock("../../lib/native", () => ({ native: mocks }));

// 浮层简化实现（与本目录其它 Sidebar 渲染测试同姿势）：只关心接线与实参。
vi.mock("../ui/Overlay", () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement("div", { role: "menu" }, children),
  Popover: ({ children }: { children: ReactNode }) => children,
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open === false ? null : createElement("div", { role: "dialog" }, children),
  Submenu: ({ children }: { children: ReactNode }) => children,
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
  node("n1", "note", "g1", 0),
  node("n2", "note", "g1", 1),
  node("n3", "note", "nb", 1),
];

let host: HTMLDivElement;
let root: Root;
let props: Props;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  mocks.batchNotes.mockReset();
  mocks.listQuickNoteTags.mockReset();
  mocks.listQuickNoteTags.mockResolvedValue([
    { id: "t1", name: "灵感", createdAt: "t", updatedAt: "t" },
    { id: "t2", name: "项目", createdAt: "t", updatedAt: "t" },
  ]);
  mocks.batchNotes.mockImplementation(async (request: { action: string; ids: string[] }) => ({
    ok: true,
    results: request.ids.map((id) => ({ id, ok: true })),
    summary: { total: request.ids.length, done: request.ids.length, failed: 0 },
  }));
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
const row = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-tree-node-id="' + id + '"]');
  if (!found) throw new Error("找不到目录行：" + id);
  return found;
};
const clickRow = (id: string, mods: { metaKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean } = {}) =>
  act(() => { row(id).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...mods })); });
const bar = (): HTMLElement | null => document.querySelector(".tree-selection-bar");
const barCount = (): string | null | undefined => document.querySelector(".tree-selection-bar__count")?.textContent;
const barButton = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>(".tree-selection-bar button")].find((btn) => (btn.textContent ?? "").trim() === text);
const dialogButton = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button, [role="dialog"] button')].find((btn) => (btn.textContent ?? "").trim() === text);

describe("目录树多选：选择语义", () => {
  it("⌘/Ctrl 点切换；普通点击退出多选（行仍走原来的单选行为）", () => {
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    expect(barCount()).toBe("已选 2 项");
    expect(row("n1").classList.contains("is-multi-selected")).toBe(true);

    clickRow("n3");
    expect(bar()).toBeNull();
    expect(props.onSelect).toHaveBeenCalledWith("n3");
  });

  it("Shift 区间按可见顺序取闭区间（跨过笔记本时跳过笔记本）", () => {
    render();
    // 普通点 n1 = 锚点；Shift 点 n3 ⇒ n1,n2,n3（nb/g1 不可选，顺序里没有 g1 只有在锚点是分组时才含）
    clickRow("n1");
    clickRow("n3", { shiftKey: true });
    expect(barCount()).toBe("已选 3 项");
    for (const id of ["n1", "n2", "n3"]) expect(row(id).classList.contains("is-multi-selected")).toBe(true);
    expect(row("nb").classList.contains("is-multi-selected")).toBe(false);
    expect(row("g1").classList.contains("is-multi-selected")).toBe(false);
  });

  it("笔记本不可多选：⌘/Shift 点笔记本既不加入选择集合、也不触发展开/收起", () => {
    render();
    const chevron = (): HTMLButtonElement => row("nb").querySelector("button.tree-chevron")!;
    const before = chevron().getAttribute("aria-label");
    clickRow("nb", { metaKey: true });
    clickRow("nb", { shiftKey: true });
    expect(bar()).toBeNull();
    expect(row("nb").classList.contains("is-multi-selected")).toBe(false);
    expect(chevron().getAttribute("aria-label")).toBe(before);
    // 普通点击笔记本仍然展开/收起（原行为不变）
    clickRow("nb");
    expect(chevron().getAttribute("aria-label")).not.toBe(before);
  });

  it("Esc 清空；点目录空白处清空", () => {
    render();
    clickRow("n1", { metaKey: true });
    expect(bar()).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(bar()).toBeNull();

    clickRow("n1", { metaKey: true });
    const nav = document.querySelector(".tree-list")!;
    act(() => { nav.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    expect(bar()).toBeNull();
  });

  it("「全选」= 当前可见的全部可多选行（含分组；笔记本除外）", () => {
    render();
    clickRow("n1", { metaKey: true });
    act(() => { barButton("全选")!.click(); });
    expect(barCount()).toBe("已选 4 项"); // g1 + n1 + n2 + n3
    // 含分组 ⇒ 只剩「移动…」
    expect(barButton("移动…")).toBeTruthy();
    expect(barButton("移入回收站")).toBeUndefined();
    expect(barButton("打标签…")).toBeUndefined();
  });
});

describe("目录树多选：批量动作", () => {
  it("文档：移入回收站（二次确认）→ batch_notes.trash 实参；成功后刷新 + 清空", async () => {
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    act(() => { barButton("移入回收站")!.click(); });
    expect(document.body.textContent).toContain("把 2 项移入回收站？");
    await act(async () => { dialogButton("移入回收站")!.click(); await Promise.resolve(); await Promise.resolve(); });

    expect(mocks.batchNotes).toHaveBeenCalledWith({ action: "trash", ids: ["n1", "n2"] });
    expect(props.onRefreshTree).toHaveBeenCalled();
    expect(barCount()).toBeUndefined();
    expect(document.querySelector('[role="status"]')?.textContent).toBe("已移入回收站 2 项");
  });

  it("分组（或混选）：只有「移动…」，移动目标层排除选中项及其后代，实参带 parentId", async () => {
    render();
    clickRow("g1", { metaKey: true });
    expect(barButton("移动…")).toBeTruthy();
    expect(barButton("移入回收站")).toBeUndefined();
    act(() => { barButton("移动…")!.click(); });
    // 选中 g1 ⇒ 目标里不能出现 g1 自己
    expect(document.querySelector('[role="listbox"][aria-label="目标位置"]')).not.toBeNull();
    const target = [...document.querySelectorAll<HTMLButtonElement>(".move-target-dialog__item")].find((btn) => (btn.textContent ?? "").includes("nb"));
    expect(target).toBeTruthy();
    await act(async () => { target!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.batchNotes).toHaveBeenCalledWith({ action: "move", ids: ["g1"], parentId: "nb" });
  });

  it("文档：打标签…（追加/移除二选一）→ batch_notes.tag-add 实参", async () => {
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    await act(async () => { barButton("打标签…")!.click(); await Promise.resolve(); });
    expect(mocks.listQuickNoteTags).toHaveBeenCalled();
    const tagRow = [...document.querySelectorAll<HTMLButtonElement>(".batch-tag-dialog__item")].find((btn) => (btn.textContent ?? "").includes("灵感"));
    expect(tagRow).toBeTruthy();
    act(() => { tagRow!.click(); });
    await act(async () => { dialogButton("追加")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.batchNotes).toHaveBeenCalledWith({ action: "tag-add", ids: ["n1", "n2"], tagIds: ["t1"] });
    expect(props.onTagsChanged).toHaveBeenCalled();
  });

  it("部分失败：失败项保持选中 + 可见汇总（成功/失败条数 + 原因）", async () => {
    mocks.batchNotes.mockResolvedValueOnce({
      ok: false,
      results: [{ id: "n1", ok: true }, { id: "n2", ok: false, reason: "already-trashed" }],
      summary: { total: 2, done: 1, failed: 1 },
      reason: "invalid-input",
    });
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    act(() => { barButton("移入回收站")!.click(); });
    await act(async () => { dialogButton("移入回收站")!.click(); await Promise.resolve(); await Promise.resolve(); });

    expect(barCount()).toBe("已选 1 项");
    expect(row("n2").classList.contains("is-multi-selected")).toBe(true);
    expect(row("n1").classList.contains("is-multi-selected")).toBe(false);
    const notice = document.querySelector('[role="status"]')?.textContent ?? "";
    expect(notice).toContain("失败 1 项");
    expect(notice).toContain("已在回收站里");
    expect(props.onRefreshTree).not.toHaveBeenCalled();
  });

  it("整批被拒（如含笔记本/参数不合法）：显示原因，不清空选择，不刷新", async () => {
    mocks.batchNotes.mockResolvedValueOnce({
      ok: false, results: [], summary: { total: 0, done: 0, failed: 0 }, reason: "invalid-input", message: "批量操作参数无效",
    });
    render();
    clickRow("n1", { metaKey: true });
    act(() => { barButton("移入回收站")!.click(); });
    await act(async () => { dialogButton("移入回收站")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(barCount()).toBe("已选 1 项");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("未移入回收站");
    expect(props.onRefreshTree).not.toHaveBeenCalled();
  });
});
