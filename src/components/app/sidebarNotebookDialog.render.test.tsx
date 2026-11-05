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
    // 回归（用户 261105 验收）：笔记本返回的是树节点 id，不能当 note 打开（否则「笔记不存在」）。
    expect(props.onSelect).not.toHaveBeenCalled();
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

// 261105 用户验收：group/note/usheet/bitable/board/ink 六个 kind 全部走同一个新建弹窗（预填默认名，可改或直接确认）。
const SIX_KINDS = [
  { label: "新建分组", kind: "group", title: "新建分组", inputLabel: "分组名称", defaultName: "新建分组" },
  { label: "新建文档", kind: "note", title: "新建文档", inputLabel: "文档名称", defaultName: "无标题文档" },
  { label: "新建表格", kind: "usheet", title: "新建表格", inputLabel: "表格名称", defaultName: "无标题表格" },
  { label: "新建多维表", kind: "bitable", title: "新建多维表", inputLabel: "多维表名称", defaultName: "无标题多维表" },
  { label: "新建画板", kind: "board", title: "新建画板", inputLabel: "画板名称", defaultName: "无标题画板" },
  { label: "新建手写板", kind: "ink", title: "新建手写板", inputLabel: "手写板名称", defaultName: "无标题手写板" },
] as const;

describe("Sidebar 六个 kind 统一新建弹窗", () => {
  it.each(SIX_KINDS)("$label：弹窗标题/预填默认名 → Enter 用默认名创建（带父级）", async ({ label, kind, title, inputLabel, defaultName }) => {
    props.onCreate = vi.fn(async () => "new-node");
    render();
    // 目录行「＋」快捷新建（与右键「新建」子菜单同一份动作）
    act(() => byAria("新建子项").click());
    act(() => byText(label).click());
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain(title);
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="' + inputLabel + '"]')!;
    expect(input.value).toBe(defaultName);
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
    expect(props.onCreate).toHaveBeenCalledWith(kind, "book", defaultName);
    // 文档类才 onSelect 打开；分组节点 id 不是 noteId（回归：「笔记不存在」）。
    if (kind === "group") expect(props.onSelect).not.toHaveBeenCalled();
    else expect(props.onSelect).toHaveBeenCalledWith("new-node");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(SIX_KINDS)("$label：取消不创建", ({ label }) => {
    render();
    act(() => byAria("新建子项").click());
    act(() => byText(label).click());
    act(() => byText("取消").click());
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("右键「新建」子菜单同样走统一弹窗（表格）：预填「无标题表格」", () => {
    render();
    const row = document.body.querySelector<HTMLElement>('[data-tree-node-id="book"]')!;
    act(() => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
    act(() => byText("新建表格").click());
    expect(document.body.querySelector<HTMLInputElement>('input[aria-label="表格名称"]')!.value).toBe("无标题表格");
  });
});
