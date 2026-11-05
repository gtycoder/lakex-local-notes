// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, Menu, Popover } from "./Overlay";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const mouseDown = (target: Element) =>
  act(() => { target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });

describe("浮层外点关闭（Overlay 唯一来源）", () => {
  it("编辑器子树里 stopPropagation 的 mousedown 也能关掉浮层（监听在 capture 阶段）", () => {
    // 复现：Lake 内核与 Univer 表格会在自己的子树里吞掉冒泡的 mousedown，
    // 浮层若挂冒泡监听 ⇒ 点画布不关、点目录才关（261020 用户报的现象）。
    const editor = document.createElement("div");
    editor.addEventListener("mousedown", (event) => event.stopPropagation());
    document.body.append(editor);
    const onDismiss = vi.fn();
    act(() => root.render(createElement(Popover, { open: true, onDismiss, label: "图标", children: createElement("span", null, "面板") })));
    mouseDown(editor);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("点浮层自身不关闭", () => {
    const onDismiss = vi.fn();
    act(() => root.render(createElement(Popover, { open: true, onDismiss, label: "图标", children: createElement("button", { type: "button" }, "选项") })));
    const surface = document.querySelector(".ln-overlay-surface")!;
    mouseDown(surface.querySelector("button")!);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("对话框不被普通外点关闭（只有遮罩负责）", () => {
    const onDismiss = vi.fn();
    act(() => root.render(createElement(Dialog, { open: true, onDismiss, label: "确认", children: createElement("p", null, "正文") })));
    const outside = document.createElement("div");
    document.body.append(outside);
    mouseDown(outside);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("默认不因点击另一层浮层表面而关闭（嵌套子菜单保护）", () => {
    const onDismiss = vi.fn();
    act(() => root.render(createElement(Menu, { open: true, onDismiss, label: "菜单", children: createElement("button", { type: "button" }, "项") })));
    const otherSurface = document.createElement("div");
    otherSurface.setAttribute("data-context-menu", "");
    document.body.append(otherSurface);
    mouseDown(otherSurface);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("模态焦点与嵌套滚动锁", () => {
  const key = (element: Element, code: string, shiftKey = false) => act(() => { element.dispatchEvent(new KeyboardEvent("keydown", { key: code, shiftKey, bubbles: true, cancelable: true })); });
  it("圈住首尾焦点、Esc关闭栈顶，关闭后回到触发器", () => {
    const trigger = document.createElement("button"); document.body.append(trigger); trigger.focus();
    const dismiss = vi.fn();
    act(() => root.render(createElement(Dialog, { onDismiss: dismiss, label: "设置", children: [createElement("button", { key: "first" }, "首项"), createElement("button", { key: "last" }, "末项")] })));
    const buttons = [...document.querySelectorAll<HTMLButtonElement>(".ln-scrim button")];
    buttons.forEach((button) => Object.defineProperty(button, "offsetParent", { configurable: true, get: () => document.body }));
    expect(document.activeElement).toBe(buttons[0]);
    act(() => buttons[1].focus()); key(buttons[1], "Tab"); expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0], "Tab", true); expect(document.activeElement).toBe(buttons[1]); key(buttons[1], "Escape"); expect(dismiss).toHaveBeenCalledTimes(1);
    act(() => root.render(null)); expect(document.activeElement).toBe(trigger);
  });
  it("同时挂载父子层时子层优先；关闭子层仍锁滚动并回到父层", () => {
    document.body.style.overflow = "auto";
    const parentDismiss = vi.fn(), childDismiss = vi.fn();
    const render = (child: boolean) => act(() => root.render(createElement(Dialog, { onDismiss: parentDismiss, label: "父层", children: [
      createElement("button", { key: "anchor" }, "父层按钮"),
      child ? createElement(Dialog, { key: "child", onDismiss: childDismiss, label: "子层", children: createElement("button", null, "子层按钮") }) : null,
    ] })));
    render(false); const anchor = document.querySelector<HTMLButtonElement>('[aria-label="父层"] button')!; act(() => anchor.focus());
    render(true); key(document.activeElement!, "Escape"); expect(childDismiss).toHaveBeenCalledTimes(1); expect(parentDismiss).not.toHaveBeenCalled();
    render(false); expect(document.body.style.overflow).toBe("hidden"); expect(document.activeElement).toBe(anchor);
    act(() => root.render(null)); expect(document.body.style.overflow).toBe("auto");
    render(true); key(document.activeElement!, "Escape"); expect(childDismiss).toHaveBeenCalledTimes(2); expect(parentDismiss).not.toHaveBeenCalled();
    act(() => root.render(null)); document.body.style.overflow = "";
  });
  it("子层同步卸载时，同一次Esc不继续关闭父层", () => {
    const parentDismiss = vi.fn();
    const draw = (child: boolean) => root.render(createElement(Dialog, { label: "父层", onDismiss: parentDismiss, children: [
      createElement("button", { key: "anchor" }, "父层按钮"),
      child ? createElement(Dialog, { key: "child", label: "子层", onDismiss: () => flushSync(() => draw(false)), children: createElement("button", null, "子层按钮") }) : null,
    ] }));
    act(() => draw(true)); key(document.activeElement!, "Escape");
    expect(document.querySelector('[aria-label="子层"]')).toBeNull(); expect(parentDismiss).not.toHaveBeenCalled();
    key(document.activeElement!, "Escape"); expect(parentDismiss).toHaveBeenCalledTimes(1);
  });
});
