
// @vitest-environment jsdom
/** 移动目标树弹窗（261106 task-90）：展开/收起、当前位置、搜索祖先展开、防环原因、选择确认。 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/types";

vi.mock("../ui/Overlay", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) => (open === false ? null : createElement("div", { role: "dialog" }, children)),
}));

import { MoveTargetTreeDialog } from "./MoveTargetTreeDialog";

const node = (id: string, nodeType: TreeNode["nodeType"], parentId: string | null, sortOrder = 0, title = id): TreeNode => ({
  id, workspaceId: "default", parentId, nodeType, title,
  noteFileId: nodeType === "note" ? id : null, sortOrder, createdAt: "t", updatedAt: "t", isConflict: false,
} as TreeNode);
const NODES = [
  node("nb1", "notebook", null, 0, "笔记本一"),
  node("g1", "group", "nb1", 0, "分组一"),
  node("n1", "note", "g1", 0, "文档一"),
  node("g2", "group", "g1", 1, "分组二"),
  node("nb2", "notebook", null, 1, "笔记本二"),
  node("g3", "group", "nb2", 0, "分组三"),
];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render(overrides: Partial<Parameters<typeof MoveTargetTreeDialog>[0]> = {}) {
  const props = {
    open: true,
    nodes: NODES,
    movingIds: ["n1"],
    currentParentId: "g1",
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  act(() => root.render(createElement(MoveTargetTreeDialog, props)));
  return props;
}
const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".move-target-tree-dialog__item")];
const rowOf = (text: string) => rows().find((row) => (row.textContent ?? "").includes(text));
const button = (text: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((btn) => (btn.textContent ?? "").trim() === text);
  if (!found) throw new Error("找不到按钮：" + text);
  return found;
};
const search = (value: string) => act(() => {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索目标位置"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("移动目标树弹窗", () => {
  it("默认展开当前路径，当前父级标「当前位置」；只列容器", () => {
    render();
    expect(document.querySelector('[role="tree"]')).not.toBeNull();
    expect(rowOf("分组一")?.textContent).toContain("当前位置");
    // 当前路径（nb1 → g1 → g2）可见；nb2 折叠 ⇒ g3 不可见
    expect(rowOf("笔记本一")).toBeTruthy();
    expect(rowOf("分组一")).toBeTruthy();
    expect(rowOf("分组二")).toBeTruthy();
    expect(rowOf("分组三")).toBeUndefined();
    expect(rowOf("文档一")).toBeUndefined();
  });

  it("展开/收起箭头：aria-expanded 跟随，子项显隐", () => {
    render();
    const toggle = [...document.querySelectorAll<HTMLButtonElement>(".move-target-tree-dialog__toggle")].find((btn) => btn.getAttribute("aria-label") === "收起子分组")!;
    expect(toggle.getAttribute("aria-expanded")).toBeNull();
    act(() => { toggle.click(); });
    expect(rowOf("分组一")).toBeUndefined();
  });

  it("搜索：命中项自动展开祖先并高亮，清空恢复", () => {
    render();
    search("分组三");
    expect(rowOf("笔记本二")).toBeTruthy();
    expect(rowOf("分组三")).toBeTruthy();
    expect(rowOf("笔记本一")).toBeUndefined();
    expect(document.querySelector(".move-target-tree-dialog__mark")?.textContent).toBe("分组三");
    search("");
    expect(rowOf("笔记本一")).toBeTruthy();
    expect(rowOf("分组三")).toBeUndefined();
  });

  it("防环：自身/后代的容器禁用并给原因；只允许选容器", () => {
    render({ movingIds: ["g1"], currentParentId: "nb1" });
    expect(rowOf("分组一")!.disabled).toBe(true);
    expect(rowOf("分组一")!.textContent).toContain("不能移动到自身或子项内部");
    // 展开分组一后才能看到子分组二（同样被禁用）
    const g1Toggle = rowOf("分组一")!.parentElement!.querySelector<HTMLButtonElement>(".move-target-tree-dialog__toggle")!;
    act(() => { g1Toggle.click(); });
    expect(rowOf("分组二")!.disabled).toBe(true);
    expect(rowOf("笔记本二")!.disabled).toBe(false);
  });

  it("未选目标时「移动到此处」禁用；选中后确认回调 parentId；取消/关闭回调", () => {
    const props = render();
    expect(button("移动到此处").disabled).toBe(true);
    act(() => { rowOf("笔记本二")!.click(); });
    expect(button("移动到此处").disabled).toBe(false);
    act(() => { button("移动到此处").click(); });
    expect(props.onConfirm).toHaveBeenCalledWith("nb2");
    act(() => { button("取消").click(); });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("没有当前父级（跨父级批量）⇒ 不显示「当前位置」", () => {
    render({ movingIds: ["n1", "g3"], currentParentId: null });
    expect(document.body.textContent).not.toContain("当前位置");
  });
});
describe("移动目标树弹窗（task-91 视觉/键盘）", () => {
  const rowButton = (text: string) => [...document.querySelectorAll<HTMLButtonElement>(".move-target-tree-dialog__item")].find((btn) => (btn.textContent ?? "").includes(text))!;
  const input = () => document.querySelector<HTMLInputElement>('input[aria-label="搜索目标位置"]')!;
  const press = (key: string, target: HTMLElement = input()) => act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

  it("走既有原语：kit 输入（带图标）+ 列表行 + 底部按钮区 + 键盘提示", () => {
    render();
    expect(document.querySelector(".ln-input.ln-input--search")).not.toBeNull();
    expect(document.querySelector(".ln-input__icon")).not.toBeNull();
    expect(document.querySelectorAll(".ln-row.move-target-tree-dialog__item").length).toBeGreaterThan(0);
    expect(document.querySelector(".ln-row__icon")).not.toBeNull();
    expect(document.querySelector(".ln-row__title")).not.toBeNull();
    expect(document.querySelector(".ln-dialog__head")).not.toBeNull();
    expect(document.querySelector(".ln-dialog__body")).not.toBeNull();
    expect(document.querySelector(".ln-dialog__actions")).not.toBeNull();
    expect(document.body.textContent).toContain("↑↓ 选择位置，Enter 确认");
  });

  it("键盘：↓ 选第一个可选行（跳过禁用）、再 ↓ 下一个、Enter 确认；↑ 回绕", () => {
    const props = render({ movingIds: ["g1"], currentParentId: "nb1" });
    press("ArrowDown");
    // 第一个可选行 = 笔记本一（禁用行是分组一/分组二）
    expect(rowButton("笔记本一").classList.contains("is-selected")).toBe(true);
    press("ArrowDown");
    expect(rowButton("笔记本二").classList.contains("is-selected")).toBe(true);
    press("ArrowUp");
    expect(rowButton("笔记本一").classList.contains("is-selected")).toBe(true);
    press("ArrowUp");
    expect(rowButton("笔记本二").classList.contains("is-selected")).toBe(true);
    press("Enter");
    expect(props.onConfirm).toHaveBeenCalledWith("nb2");
  });

  it("层级缩进用 data-depth（嵌套分组更深）", () => {
    render();
    const g1 = [...document.querySelectorAll<HTMLElement>(".move-target-tree-dialog__node")].find((node) => (node.textContent ?? "").includes("分组一"))!;
    expect(g1.getAttribute("data-depth")).toBe("1");
    // 当前路径默认展开（含分组一）⇒ 子分组二已经可见、再深一层
    const g2 = [...document.querySelectorAll<HTMLElement>(".move-target-tree-dialog__node")].find((node) => (node.textContent ?? "").includes("分组二"))!;
    expect(g2.getAttribute("data-depth")).toBe("2");
  });
});
