// @vitest-environment jsdom
/**
 * 目录树多选的页头/底部条（261106 task-8）——手机抽屉 WorkspaceDrawers 与平板 WorkspaceTreePanel：
 * · 浏览态：有可选文档时页头出现「选择」入口，没有则不出现；
 * · 选择态：页头换成 取消 / 已选 N / 全选；底部条 = 创建副本 / 移动… / 移入回收站（aria-pressed 显式给出）。
 * 只验组件接线与 a11y；动作语义见 useTreeSelection.render.test。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../editor/OutlineSheet", () => ({ OutlineSheet: () => null }));

import { WorkspaceDrawers } from "./WorkspaceDrawers";
import { WorkspaceTreePanel } from "./WorkspacePanels";

const ACTIONS = [
  { id: "duplicate", label: "创建副本", ariaPressed: false },
  { id: "move", label: "移动…", ariaPressed: false },
  { id: "trash", label: "移入回收站", danger: true, ariaPressed: false },
];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

async function mount(node: ReturnType<typeof createElement>): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
}

const drawerProps = (over: Record<string, unknown> = {}) => ({
  sidebarOpen: true,
  outlineOpen: false,
  title: "笔记本",
  nbIcon: null,
  renamingId: null,
  notebookId: "nb1",
  renameValue: "",
  onRenameChange: () => undefined,
  onRenameCommit: () => undefined,
  onRenameCancel: () => undefined,
  treeList: createElement("div", { className: "side-panel-body" }, "行"),
  onOpenSidebar: () => undefined,
  onOpenCreate: () => undefined,
  editor: null,
  onCloseOutline: () => undefined,
  ...over,
});

const treePanelProps = (over: Record<string, unknown> = {}) => ({
  open: true,
  pinned: false,
  title: "笔记本",
  nbIcon: null,
  list: createElement("div", { className: "pad-tree__list" }, "行"),
  onNew: () => undefined,
  onTogglePin: () => undefined,
  onClose: () => undefined,
  ...over,
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe("手机抽屉：选择入口 / 选择态页头与底部条", () => {
  it("浏览态：有可选文档时有「选择」按钮，没有时不出现", async () => {
    const onEnterSelect = vi.fn();
    await mount(createElement(WorkspaceDrawers, drawerProps({ canSelect: true, onEnterSelect })));
    const entry = host.querySelector('[aria-label="选择文档"]') as HTMLButtonElement;
    expect(entry?.textContent).toBe("选择");
    await act(async () => { entry.click(); });
    expect(onEnterSelect).toHaveBeenCalledTimes(1);

    await act(async () => { root!.render(createElement(WorkspaceDrawers, drawerProps({ canSelect: false }))); });
    expect(host.querySelector('[aria-label="选择文档"]')).toBeNull();
  });

  it("选择态：页头 = 取消 / 已选 N / 全选；底部条三个动作（aria-pressed 显式给出）", async () => {
    const onCancelSelect = vi.fn();
    const onToggleAllSelect = vi.fn();
    const onSelectionAction = vi.fn();
    await mount(createElement(WorkspaceDrawers, drawerProps({
      selecting: true,
      selectionCount: 2,
      selectionAllSelected: false,
      selectionActions: ACTIONS,
      onCancelSelect,
      onToggleAllSelect,
      onSelectionAction,
    })));
    const head = host.querySelector('[role="toolbar"][aria-label="多选操作"]')!;
    expect(head.textContent).toContain("已选 2");
    const headButtons = [...head.querySelectorAll("button")];
    expect(headButtons.map((button) => button.textContent?.trim())).toEqual(["取消", "全选"]);
    await act(async () => { headButtons[0].click(); });
    expect(onCancelSelect).toHaveBeenCalledTimes(1);
    await act(async () => { headButtons[1].click(); });
    expect(onToggleAllSelect).toHaveBeenCalledTimes(1);
    // 浏览态的「新建/收起/选择」在选择态收起（模态）
    expect(host.querySelector('[aria-label="新建"]')).toBeNull();
    expect(host.querySelector('[aria-label="选择文档"]')).toBeNull();

    const bar = host.querySelector('[role="group"][aria-label="批量操作"]')!;
    const buttons = [...bar.querySelectorAll("button")];
    expect(buttons.map((button) => (button.textContent ?? "").trim())).toEqual(["创建副本", "移动…", "移入回收站"]);
    for (const button of buttons) expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { buttons[0].click(); });
    expect(onSelectionAction).toHaveBeenCalledWith("duplicate");
  });
});

describe("平板悬浮树面板：同一套选择态接线", () => {
  it("选择态：页头换成选择顶栏，底部条出现；浏览态有「选择」入口", async () => {
    const onSelectionAction = vi.fn();
    await mount(createElement(WorkspaceTreePanel, treePanelProps({
      canSelect: true,
      selecting: true,
      selectionCount: 1,
      selectionAllSelected: true,
      selectionActions: ACTIONS,
      onSelectionAction,
    })));
    expect(host.querySelector('[role="toolbar"][aria-label="多选操作"]')!.textContent).toContain("已选 1");
    expect(host.querySelector('[role="toolbar"][aria-label="多选操作"]')!.textContent).toContain("全不选");
    expect(host.querySelector('[role="group"][aria-label="批量操作"]')).not.toBeNull();
    await act(async () => { root!.render(createElement(WorkspaceTreePanel, treePanelProps({ canSelect: true }))); });
    expect(host.querySelector('[aria-label="选择文档"]')).not.toBeNull();
    expect(host.querySelector('[role="group"][aria-label="批量操作"]')).toBeNull();
  });
});
