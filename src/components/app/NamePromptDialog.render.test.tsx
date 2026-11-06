// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NamePromptDialog, type NamePromptDialogProps } from "./NamePromptDialog";

/**
 * 「输入名字再创建」通用弹窗（261105 用户验收：新建笔记本 / 新建标签改弹窗）。
 * 锁：打开即聚焦、Enter 提交（trim）、空名禁用、Esc/取消不创建、错误就地显示且不关闭。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render(overrides: Partial<NamePromptDialogProps> = {}) {
  const props: NamePromptDialogProps = {
    open: true, title: "新建笔记本", inputLabel: "笔记本名称", placeholder: "输入笔记本名称",
    onSubmit: vi.fn(), onClose: vi.fn(), ...overrides,
  };
  act(() => root.render(createElement(NamePromptDialog, props)));
  return props;
}
const input = (label = "笔记本名称"): HTMLInputElement => {
  const found = document.body.querySelector<HTMLInputElement>('input[aria-label="' + label + '"]');
  if (!found) throw new Error("找不到输入框：" + label);
  return found;
};
const button = (text: string): HTMLButtonElement => {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((btn) => (btn.textContent ?? "") === text);
  if (!found) throw new Error("找不到按钮：" + text);
  return found;
};
const typeInto = (el: HTMLInputElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("NamePromptDialog", () => {
  it("标题/输入框/取消/创建齐全，打开即有焦点", () => {
    render();
    expect(document.body.textContent).toContain("新建笔记本");
    expect(input()).toBeTruthy();
    expect(input().getAttribute("placeholder")).toBe("输入笔记本名称");
    expect(button("取消")).toBeTruthy();
    expect(button("创建")).toBeTruthy();
    expect(document.activeElement).toBe(input());
  });

  it("打开即全选名称（261106）：selection 覆盖整个 value（直接打字即整体替换）", () => {
    render({ initialValue: "我的笔记本" });
    const el = input();
    expect(el.value).toBe("我的笔记本");
    expect(el.selectionStart).toBe(0);
    expect(el.selectionEnd).toBe(el.value.length);
  });

  it("空名：创建按钮禁用、Enter 不提交", () => {
    const props = render();
    expect(button("创建").disabled).toBe(true);
    act(() => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("Enter 提交（trim 后）；之后按钮可用", () => {
    const props = render();
    typeInto(input(), "  我的笔记本  ");
    expect(button("创建").disabled).toBe(false);
    act(() => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(props.onSubmit).toHaveBeenCalledWith("我的笔记本");
  });

  it("Esc / 取消按钮 ⇒ onClose，不创建", () => {
    const props = render();
    typeInto(input(), "草稿");
    act(() => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
    const props2 = render();
    act(() => button("取消").click());
    expect(props2.onClose).toHaveBeenCalledTimes(1);
  });

  it("错误就地显示、弹窗不关闭；busy 时两个按钮禁用", () => {
    render({ error: "已存在同名笔记本" });
    expect(document.body.textContent).toContain("已存在同名笔记本");
    expect(input()).toBeTruthy();
    render({ busy: true });
    expect(button("取消").disabled).toBe(true);
    expect(button("创建中…").disabled).toBe(true);
  });

  it("open=false 不渲染", () => {
    render({ open: false });
    expect(document.body.querySelector('input[aria-label="笔记本名称"]')).toBeNull();
  });
});
