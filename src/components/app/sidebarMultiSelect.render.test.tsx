
// @vitest-environment jsdom
/**
 * 桌面目录树多选（261106 task-81）：⌘/Ctrl 切换、Shift 区间（跳过笔记本）、Esc/点空白清空、
 * 右键批量菜单（文档：创建副本/移动/移入回收站；分组：移动）、batch_notes 实参、成功清空刷新、
 * 部分失败保留选择 + 汇总提示；以及「创建副本」（261106）单条右键 + 多选菜单第 1 项 + duplicate_notes 实参。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

const mocks = vi.hoisted(() => ({ batchNotes: vi.fn(), duplicateNotes: vi.fn(), listQuickNoteTags: vi.fn(), exportNotesBatch: vi.fn(), openExportDir: vi.fn(), pickExportDir: vi.fn() }));
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
  localStorage.clear();
  mocks.batchNotes.mockReset();
  mocks.duplicateNotes.mockReset();
  mocks.listQuickNoteTags.mockReset();
  mocks.pickExportDir.mockReset();
  mocks.pickExportDir.mockResolvedValue("/tmp/export");
  mocks.exportNotesBatch.mockReset();
  mocks.openExportDir.mockReset();
  mocks.openExportDir.mockResolvedValue({ ok: true, path: "/tmp/export" });
  mocks.listQuickNoteTags.mockResolvedValue([
    { id: "t1", name: "灵感", createdAt: "t", updatedAt: "t" },
    { id: "t2", name: "项目", createdAt: "t", updatedAt: "t" },
  ]);
  mocks.batchNotes.mockImplementation(async (request: { action: string; ids: string[] }) => ({
    ok: true,
    results: request.ids.map((id) => ({ id, ok: true })),
    summary: { total: request.ids.length, done: request.ids.length, failed: 0 },
  }));
  mocks.duplicateNotes.mockImplementation(async (request: { ids: string[] }) => ({
    ok: true,
    results: request.ids.map((id) => ({ id, ok: true, newId: id + "-copy" })),
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
const selectedCount = (): number => document.querySelectorAll(".is-multi-selected").length;
const bar = (): HTMLElement | null => selectedCount() > 0 ? document.querySelector<HTMLElement>(".is-multi-selected") : null;
const barCount = (): string | null | undefined => selectedCount() > 0 ? "已选 " + selectedCount() + " 项" : undefined;
/** 多选工具条已移除；批量动作统一从右键菜单触发。 */
const barButton = (text: string): HTMLButtonElement | undefined => {
  if (!document.querySelector('[role="menu"]')) {
    const selected = document.querySelector<HTMLElement>(".is-multi-selected");
    const id = selected?.getAttribute("data-tree-node-id");
    if (!id) throw new Error("当前没有选中行");
    rightClick(id);
  }
  return menuItems().find((btn) => (btn.textContent ?? "").trim() === text);
};
/** 工具条迁入右键菜单后，点击必须先打开菜单，再在独立 act 里触发。 */
const clickBarButton = (text: string): void => {
  const button = barButton(text);
  if (!button) throw new Error("找不到批量菜单项：" + text);
  act(() => { button.click(); });
};
const dialogButton = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('.confirm-dialog button, [role="dialog"] button')].find((btn) => (btn.textContent ?? "").trim() === text);
const rightClick = (id: string) => act(() => {
  row(id).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
});
const menuItems = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')];
const menuItem = (text: string): HTMLButtonElement => {
  const found = menuItems().find((btn) => (btn.textContent ?? "").trim() === text);
  if (!found) throw new Error("找不到菜单项：" + text);
  return found;
};

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
    clickBarButton("全选");
    expect(barCount()).toBe("已选 4 项"); // g1 + n1 + n2 + n3
    // 含分组 ⇒ 创建副本/移入回收站禁用；打标签入口已彻底移除
    expect(barButton("移动…")).toBeTruthy();
    expect(barButton("创建副本")?.disabled).toBe(true);
    expect(barButton("移入回收站")?.disabled).toBe(true);
    expect(barButton("打标签…")).toBeUndefined();
  });
});

describe("目录树多选：批量动作", () => {
  it("文档：移入回收站（二次确认）→ batch_notes.trash 实参；成功后刷新 + 清空", async () => {
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    clickBarButton("移入回收站");
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
    expect(barButton("移入回收站")?.disabled).toBe(true);
    clickBarButton("移动…");
    // 261106 task-90：移动目标 = 思源式目录树弹窗；选中 g1 ⇒ g1/g2 禁用并给原因
    expect(document.querySelector('[role="tree"][aria-label="目标位置"]')).not.toBeNull();
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".move-target-tree-dialog__item")];
    const selfRow = rows.find((btn) => (btn.textContent ?? "").includes("g1"))!;
    expect(selfRow.disabled).toBe(true);
    expect(selfRow.textContent).toContain("不能移动到自身或子项内部");
    const target = rows.find((btn) => (btn.textContent ?? "").includes("nb"))!;
    expect(target).toBeTruthy();
    act(() => { target.click(); });
    await act(async () => { dialogButton("移动到此处")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.batchNotes).toHaveBeenCalledWith({ action: "move", ids: ["g1"], parentId: "nb" });
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
    clickBarButton("移入回收站");
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
    clickBarButton("移入回收站");
    await act(async () => { dialogButton("移入回收站")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(barCount()).toBe("已选 1 项");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("未移入回收站");
    expect(props.onRefreshTree).not.toHaveBeenCalled();
  });
});
describe("单条右键「移动…」：与多选共用同一棵树形弹窗", () => {
  it("右键文档 → 移动… → 选中目标确认 ⇒ batch_notes.move（ids 长度 1）并刷新", async () => {
    render();
    rightClick("n1");
    const moveItem = menuItem("移动…");
    expect(moveItem).toBeTruthy();
    act(() => { moveItem.click(); });
    expect(document.querySelector('[role="tree"][aria-label="目标位置"]')).not.toBeNull();
    const target = [...document.querySelectorAll<HTMLButtonElement>(".move-target-tree-dialog__item")].find((btn) => (btn.textContent ?? "").includes("nb"))!;
    act(() => { target.click(); });
    await act(async () => { dialogButton("移动到此处")!.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.batchNotes).toHaveBeenCalledWith({ action: "move", ids: ["n1"], parentId: "nb" });
    expect(props.onRefreshTree).toHaveBeenCalled();
    expect(document.querySelector('[role="tree"]')).toBeNull();
  });
});
describe("多选右键菜单（261106 task-88；261106 副本第 4 项；261107 置顶）：七项 + 批量导出 + 创建副本", () => {
  it("多选态右键 = 七项：置顶 / 创建副本 / 移动… / 导出… / 全选 / 取消选择 / 移入回收站", () => {
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    rightClick("n2");
    expect(menuItems().map((btn) => (btn.textContent ?? "").trim())).toEqual(["置顶", "创建副本", "移动…", "导出…", "全选", "取消选择", "移入回收站"]);
    expect(menuItems()).toHaveLength(7);
    expect(menuItems()[6].className).toContain("danger");
  });

  it("多选「置顶」⇒ 多项写入设备本地（原目录不动）+ 提示条；再选同批变为「取消置顶」", async () => {
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    rightClick("n2");
    await act(async () => { menuItem("置顶").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(JSON.parse(localStorage.getItem("lakex-local-notes-v3.sidebar-pinned") ?? "[]")).toEqual(["n1", "n2"]);
    expect(document.querySelector(".tree-batch-notice__text")?.textContent).toContain("已置顶 2 项");
    // 原目录结构不变：行仍在 n1/n2 位置
    expect(row("n1")).toBeTruthy();
    // 再选同批，菜单应显示「取消置顶」
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    rightClick("n2");
    expect(menuItems()[0].textContent).toContain("取消置顶");
  });

  it("导出… → exportNotesBatch({ ids })；成功提示「导出 N 项」+ 打开所在文件夹", async () => {
    mocks.exportNotesBatch.mockResolvedValue({
      ok: true,
      results: [{ id: "n1", ok: true, path: "/tmp/export/n1.pdf" }, { id: "n2", ok: true, path: "/tmp/export/n2.pdf" }],
      summary: { total: 2, done: 2, failed: 0, skipped: 0 },
      dirPath: "/tmp/export",
    });
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    rightClick("n2");
    await act(async () => { menuItem("导出…").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.pickExportDir).toHaveBeenCalledTimes(1);
    expect(mocks.exportNotesBatch).toHaveBeenCalledWith({ ids: ["n1", "n2"], dirPath: "/tmp/export" });
    const notice = document.querySelector(".tree-batch-notice__text")?.textContent ?? "";
    expect(notice).toContain("导出 2 项");
    const openFolder = [...document.querySelectorAll<HTMLButtonElement>(".tree-batch-notice button")].find((btn) => (btn.textContent ?? "").trim() === "打开所在文件夹")!;
    act(() => { openFolder.click(); });
    expect(mocks.openExportDir).toHaveBeenCalledWith("/tmp/export");
  });

  it("用户取消目录（pickExportDir 返回 null）⇒ 不收集、不导出、不提示失败", async () => {
    mocks.pickExportDir.mockResolvedValue(null);
    render();
    clickRow("n1", { metaKey: true });
    rightClick("n1");
    await act(async () => { menuItem("导出…").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.exportNotesBatch).not.toHaveBeenCalled();
    expect(document.querySelector(".tree-batch-notice__text")).toBeNull();
    expect(document.body.textContent).not.toContain("导出失败");
  });

  it("board 等被跳过：提示「跳过 K（画板需要先打开再单独导出）」", async () => {
    mocks.exportNotesBatch.mockResolvedValue({
      ok: true,
      results: [{ id: "d1", ok: true, path: "/tmp/export/a.pdf" }, { id: "b1", ok: false, skipped: true, reason: "画板需要先打开再单独导出" }],
      summary: { total: 2, done: 1, failed: 0, skipped: 1 },
      dirPath: "/tmp/export",
    });
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    rightClick("n2");
    await act(async () => { menuItem("导出…").click(); await Promise.resolve(); await Promise.resolve(); });
    const notice = document.querySelector(".tree-batch-notice__text")?.textContent ?? "";
    expect(notice).toContain("导出 1 项");
    expect(notice).toContain("跳过 1");
    expect(notice).toContain("画板需要先打开再单独导出");
  });

  it("分组多选：创建副本禁用（只有文档可以创建副本）+ title 理由；移入回收站禁用；移动/导出可用", () => {
    render();
    clickRow("g1", { metaKey: true });
    rightClick("g1");
    const buttons = menuItems();
    // 置顶对分组也可用（设备本地入口，不改目录）
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    expect(buttons[1].getAttribute("title")).toContain("只有文档可以创建副本");
    expect(buttons[6].disabled).toBe(true);
    expect(buttons[6].getAttribute("title")).toContain("分组不能移入回收站");
    expect(buttons[2].disabled).toBe(false);
    expect(buttons[3].disabled).toBe(false);
  });

  it("多选创建副本：菜单 → duplicate_notes({ ids }) → 刷新 + 「已创建 N 个副本」+ 清空选择", async () => {
    render();
    clickRow("n1", { metaKey: true });
    clickRow("n2", { metaKey: true });
    rightClick("n2");
    await act(async () => { menuItem("创建副本").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.duplicateNotes).toHaveBeenCalledWith(expect.objectContaining({ ids: ["n1", "n2"] }));
    expect(props.onRefreshTree).toHaveBeenCalled();
    expect(barCount()).toBeUndefined();
    expect(document.querySelector('[role="status"]')?.textContent).toBe("已创建 2 个副本");
  });

  it("单条右键按组加分隔线（文档 5 组 / 分组 3 组 / 笔记本 2 组）", () => {
    render();
    const tokens = (): string[] => {
      // 只取最外层菜单：导出是子菜单，内层项不能算进主菜单分组。
      const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].find((el) => !el.parentElement?.closest('[role="menu"]'));
      if (!menu) return [];
      return [...menu.querySelectorAll<HTMLElement>('button, [role="separator"]')]
        .filter((el) => el.closest('[role="menu"]') === menu)
        .map((el) => (el.getAttribute("role") === "separator" ? "---" : (el.textContent ?? "").trim()))
        // 导出是子菜单（DOM 内联展开），其子项不计入主菜单分组。
        .filter((label) => !/^导出为|^导出资料/.test(label));
    };

    rightClick("n1");
    // 导出子菜单在 jsdom 里内联展开（真实 UI 是折叠子菜单）⇒ 只断言主菜单分组；分组 4 = 锁定 + 导出。
    expect(tokens()).toEqual([
      "重命名", "置顶", "---",
      "创建副本", "移动…", "---",
      "历史版本", "标签…", "属性", "---",
      "锁定（只读）", "---",
      "删除",
    ]);
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

    rightClick("g1");
    expect(tokens()).toEqual(["重命名", "置顶", "移动…", "---", "删除"]);
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

    rightClick("nb");
    expect(tokens()).toEqual(["重命名", "---", "删除"]);
  });

  it("单条右键「置顶」⇒ 写入设备本地 + 出现置顶区；再次右键变为「取消置顶」", () => {
    render();
    rightClick("n1");
    expect(menuItems().map((btn) => (btn.textContent ?? "").trim())).toContain("置顶");
    act(() => { menuItem("置顶").click(); });
    expect(JSON.parse(localStorage.getItem("lakex-local-notes-v3.sidebar-pinned") ?? "[]")).toEqual(["n1"]);
    expect(document.querySelector(".sidebar-pinned")).not.toBeNull();
    expect(document.querySelector('[data-pinned-node-id="n1"]')).not.toBeNull();
    // 原目录不动：同一篇仍在原位置
    expect(row("n1")).toBeTruthy();

    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    rightClick("n1");
    expect(menuItems().map((btn) => (btn.textContent ?? "").trim())).toContain("取消置顶");
  });

  it("未多选时右键仍是旧菜单（不只四项；文档行有「创建副本」、分组行没有）", () => {
    render();
    rightClick("n1");
    const texts = menuItems().map((btn) => (btn.textContent ?? "").trim());
    expect(texts.length).toBeGreaterThan(3);
    expect(texts).toContain("重命名");
    expect(texts).toContain("创建副本");
    expect(texts).toContain("删除");
    expect(texts).not.toContain("导出…");

    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    rightClick("g1");
    const groupTexts = menuItems().map((btn) => (btn.textContent ?? "").trim());
    expect(groupTexts).toContain("重命名");
    expect(groupTexts).toContain("置顶");
    expect(groupTexts).not.toContain("创建副本");

    // 笔记本不可置顶（用户 261107）：右键菜单只有重命名/删除，没有置顶项
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    rightClick("nb");
    const notebookTexts = menuItems().map((btn) => (btn.textContent ?? "").trim());
    expect(notebookTexts).not.toContain("置顶");
    expect(notebookTexts).not.toContain("取消置顶");
  });
});

describe("创建副本入口（261106）：单条右键 + 多选右键菜单", () => {
  it("文档行 → duplicate_notes({ ids: [id] }) → 刷新 + 「已创建 1 个副本」", async () => {
    render();
    rightClick("n1");
    await act(async () => { menuItem("创建副本").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.duplicateNotes).toHaveBeenCalledWith(expect.objectContaining({ ids: ["n1"] }));
    expect(props.onRefreshTree).toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')?.textContent).toBe("已创建 1 个副本");
  });

  it("创建副本前先 flush 未保存编辑（顺序：flush → duplicate_notes）", async () => {
    const order: string[] = [];
    props.onBeforeDuplicate = vi.fn(async () => { order.push("flush"); });
    mocks.duplicateNotes.mockImplementationOnce(async (request: { ids: string[] }) => {
      order.push("dup");
      return { ok: true, results: request.ids.map((id) => ({ id, ok: true, newId: id + "-copy" })), summary: { total: 1, done: 1, failed: 0 } };
    });
    render();
    rightClick("n1");
    await act(async () => { menuItem("创建副本").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(order).toEqual(["flush", "dup"]);
  });

  it("失败（如正文缺失）：显示可读原因，不刷新", async () => {
    mocks.duplicateNotes.mockResolvedValueOnce({
      ok: false, results: [{ id: "n1", ok: false, reason: "body-missing" }], summary: { total: 1, done: 0, failed: 1 }, reason: "body-missing",
    });
    render();
    rightClick("n1");
    await act(async () => { menuItem("创建副本").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(props.onRefreshTree).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')?.textContent).toContain("正文文件缺失");
  });

  it("多选右键菜单也有「创建副本」（文档选择时可用，分组选择时禁用）", async () => {
    render();
    clickRow("n1", { metaKey: true });
    clickBarButton("创建副本"); await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.duplicateNotes).toHaveBeenCalledWith(expect.objectContaining({ ids: ["n1"] }));
    expect(document.querySelector('[role="status"]')?.textContent).toBe("已创建 1 个副本");
  });
});