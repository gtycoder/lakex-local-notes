// @vitest-environment jsdom
/**
 * 261106 修复护栏：目录行 ⋯ 菜单打开期间，目录抽屉/树必须**稳定 open**——
 * 不 remount 树容器、不进入 closing/swiping 相位、滚动位置不丢；关闭菜单后仍 open。
 *
 * 判据单点在 useWorkspaceOverlays.isTreeVisibleForOverlay（menu ⇒ true），本用例锁组件接线：
 * 手机 = .side-panel--left（class on）；平板 = .pad-tree（class is-open）。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OutlineSheet → lakeRuntime（内核）会拉 matchMedia；本用例只验抽屉/树容器的稳定性。
vi.mock("../editor/OutlineSheet", () => ({ OutlineSheet: () => null }));

import { WorkspaceDrawers } from "./WorkspaceDrawers";
import { WorkspaceTreePanel } from "./WorkspacePanels";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

async function mount(node: ReturnType<typeof createElement>): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
}

const drawerProps = (sidebarOpen: boolean) => ({
  sidebarOpen,
  outlineOpen: false,
  title: "笔记本",
  nbIcon: null,
  renamingId: null,
  notebookId: "nb1",
  renameValue: "",
  onRenameChange: () => undefined,
  onRenameCommit: () => undefined,
  onRenameCancel: () => undefined,
  treeList: <div className="side-panel-body"><span>行</span></div>,
  onOpenSidebar: () => undefined,
  onOpenCreate: () => undefined,
  editor: null,
  onCloseOutline: () => undefined,
});

const treePanelProps = (open: boolean) => ({
  open,
  pinned: false,
  title: "笔记本",
  nbIcon: null,
  list: <div className="pad-tree__list"><span>行</span></div>,
  onNew: () => undefined,
  onTogglePin: () => undefined,
  onClose: () => undefined,
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
});

describe("手机抽屉：行菜单打开期间稳定 open（261106）", () => {
  it("menu 打开（sidebarOpen 仍 true）⇒ 同一 aside/树容器、无 closing/swiping、滚动保留", async () => {
    await mount(createElement(WorkspaceDrawers, drawerProps(true)));
    const panel = host.querySelector(".side-panel--left")!;
    const body = host.querySelector(".side-panel-body")!;
    (body as HTMLElement).scrollTop = 140;
    expect(panel.className).toContain("on");
    expect(host.querySelector('[data-panel-mask="left"]')!.className).toContain("on");

    // 模拟 overlay sidebar → menu：抽屉派生仍为 open（组件收到的 prop 不变）
    await act(async () => { root!.render(createElement(WorkspaceDrawers, drawerProps(true))); });
    const panelAfter = host.querySelector(".side-panel--left")!;
    const bodyAfter = host.querySelector(".side-panel-body")!;
    expect(panelAfter).toBe(panel);          // 不 remount
    expect(bodyAfter).toBe(body);            // 树/滚动容器不 remount
    expect((bodyAfter as HTMLElement).scrollTop).toBe(140);
    expect(panelAfter.className).toContain("on");
    expect(panelAfter.className).not.toMatch(/closing|swiping/);
    expect(panelAfter.getAttribute("style")).toBeNull();  // 无内联 transform（不再被 tap 写）
  });

  it("关闭菜单后仍 open（派生回到 sidebar 时 class 仍为 on）", async () => {
    await mount(createElement(WorkspaceDrawers, drawerProps(true)));
    await act(async () => { root!.render(createElement(WorkspaceDrawers, drawerProps(true))); });
    expect(host.querySelector(".side-panel--left")!.className).toContain("on");
  });
});

describe("平板两栏：行菜单打开期间树保持（261106）", () => {
  it("open 仍 true（menu 期间）⇒ 同一 aside、class is-open、无 closing", async () => {
    await mount(createElement(WorkspaceTreePanel, treePanelProps(true)));
    const tree = host.querySelector(".pad-tree")!;
    await act(async () => { root!.render(createElement(WorkspaceTreePanel, treePanelProps(true))); });
    const treeAfter = host.querySelector(".pad-tree")!;
    expect(treeAfter).toBe(tree);
    expect(treeAfter.className).toContain("is-open");
    expect(treeAfter.className).not.toMatch(/closing|swiping/);
    expect(treeAfter.getAttribute("style")).toBeNull();
  });
});
