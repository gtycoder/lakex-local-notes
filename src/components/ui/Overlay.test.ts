// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
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
