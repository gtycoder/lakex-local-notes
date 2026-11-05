// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

// 浮层用简化实现（与 sidebarRendering.test 同姿势）：本测试只关心「+ 菜单 → 新建笔记本弹窗」的接线。
vi.mock("../ui/Overlay", () => ({
  Menu: ({ children }: { children: ReactNode }) => createElement("div", { role: "menu" }, children),
  Popover: ({ children }: { children: ReactNode }) => children,
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open === false ? null : createElement("div", { role: "dialog" }, children),
  Submenu: ({ children }: { children: ReactNode }) => children,
}));
import { Sidebar } from "./Sidebar";

/** 261105 用户验收：新建笔记本从内联行改成弹窗（标题/autofocus/Enter/Esc/空名禁用/错误就地）。 */
type Props = Parameters<typeof Sidebar>[0];
const node = (id: string, parentId: string | null, type: TreeNode["nodeType"]): TreeNode => ({
  id, parentId, workspaceId: "default", nodeType: type, title: id,
  noteFileId: type === "note" ? id : null, sortOrder: 0, createdAt: "t", updatedAt: "t", isConflict: false,
});
const nodes = [node("book", null, "notebook"), node("n1", "book", "note")];

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
    nodes, activeId: null, search: "", mode: "docked", width: 220, minWidth: 160, maxWidth: 400,
    lockedNoteIds: new Set<string>(), revealNodeId: null, pendingRenameId: null,
    onSelect: vi.fn(), onSearch: vi.fn(), onRefreshTree: vi.fn(), onCreate: vi.fn(async () => "nb-new"),
    onRename: vi.fn(), onMoveNode: vi.fn(), onRequestDelete: vi.fn(), onCopyMarkdown: vi.fn(),
    onExportAs: vi.fn(), onCopyPaths: vi.fn(), onSetIcon: vi.fn(), onShowInfo: vi.fn(), onOpenHistory: vi.fn(),
    onToggleLockNote: vi.fn(), onRevealConsumed: vi.fn(), onPendingRenameConsumed: vi.fn(),
    onPreviewEnter: vi.fn(), onPreviewLeave: vi.fn(), onResizeActiveChange: vi.fn(),
    onWidthChange: vi.fn(), onWidthCommit: vi.fn(),
  } as unknown as Props;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const render = () => act(() => root.render(createElement(Sidebar, props)));
const byAria = (label: string): HTMLButtonElement => {
  const found = document.body.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
  if (!found) throw new Error("找不到按钮：" + label);
  return found;
};
const byText = (text: string): HTMLButtonElement => {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "").trim() === text);
  if (!found) throw new Error("找不到按钮：" + text);
  return found;
};
const dialogInput = (): HTMLInputElement => document.body.querySelector<HTMLInputElement>('input[aria-label="笔记本名称"]')!;
const typeInto = (el: HTMLInputElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("Sidebar 新建笔记本（弹窗）", () => {
  it("+ → 新建笔记本：打开弹窗，输入框自动聚焦；不再插入内联输入行", () => {
    render();
    act(() => byAria("新建").click());
    act(() => byText("新建笔记本").click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("新建笔记本");
    expect(dialogInput()).toBeTruthy();
    expect(document.activeElement).toBe(dialogInput());
    // 内联创建行已移除（旧的「笔记本名称」内联 input 与弹窗内是同一个 aria，但不应出现在 .inline-create 里）
    expect(document.body.querySelector(".inline-create")).toBeNull();
  });

  it("Enter 提交：调 onCreate(notebook, null, name) → 关闭 → 选中新节点", async () => {
    render();
    act(() => byAria("新建").click());
    act(() => byText("新建笔记本").click());
    typeInto(dialogInput(), "  我的笔记本 ");
    await act(async () => {
      dialogInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
    expect(props.onCreate).toHaveBeenCalledWith("notebook", null, "我的笔记本");
    expect(props.onSelect).toHaveBeenCalledWith("nb-new");
    expect(document.body.querySelector('input[aria-label="笔记本名称"]')).toBeNull();
  });

  it("Esc 取消：不创建、关闭弹窗", () => {
    render();
    act(() => byAria("新建").click());
    act(() => byText("新建笔记本").click());
    typeInto(dialogInput(), "草稿");
    act(() => { dialogInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(document.body.querySelector('input[aria-label="笔记本名称"]')).toBeNull();
  });

  it("空名：「创建」按钮禁用、Enter 不提交", () => {
    render();
    act(() => byAria("新建").click());
    act(() => byText("新建笔记本").click());
    const createButton = [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((btn) => (btn.textContent ?? "").trim() === "创建")!;
    expect(createButton.disabled).toBe(true);
    act(() => { dialogInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it("创建失败：错误就地显示、弹窗不关闭", async () => {
    props.onCreate = vi.fn(async () => { throw new Error("已存在同名笔记本"); });
    render();
    act(() => byAria("新建").click());
    act(() => byText("新建笔记本").click());
    typeInto(dialogInput(), "重名");
    await act(async () => {
      dialogInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("已存在同名笔记本");
    expect(dialogInput()).toBeTruthy();
  });
});
