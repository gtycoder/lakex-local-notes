// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Menu, NativeDialog } from "./Overlay";

/**
 * 原生模态试点护栏（261115 A02）。
 *
 * jsdom 30 没有 `showModal()`（实测 `'showModal' in dialog === false`），所以这里用桩验证**调用契约**，
 * 真实置顶/背景不可聚焦由浏览器负责——在应用里用 CDP 另行验证（见审计 §11.3）。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
const hadShow = "showModal" in proto, hadClose = "close" in proto;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(proto, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); }),
  });
  Object.defineProperty(proto, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); }),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  if (!hadShow) delete proto["showModal"];
  if (!hadClose) delete proto["close"];
});

const dialog = () => document.querySelector<HTMLDialogElement>("dialog.ln-native-dialog")!;

describe("NativeDialog（<dialog> + showModal）", () => {
  it("渲染 <dialog>、showModal 一次，表面类仍是 ln-dialog + 站点类", () => {
    act(() => root.render(createElement(NativeDialog, { onDismiss: () => {}, label: "删除确认", className: "confirm-dialog", children: createElement("button", null, "确定") })));
    const el = dialog();
    expect(el.tagName).toBe("DIALOG");
    expect(el.className).toContain("ln-dialog");
    expect(el.className).toContain("confirm-dialog");
    expect(el.getAttribute("aria-label")).toBe("删除确认");
    expect((proto["showModal"] as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(el.hasAttribute("open")).toBe(true);
  });

  it("不加 role=dialog / aria-modal（浏览器自己给）", () => {
    act(() => root.render(createElement(NativeDialog, { onDismiss: () => {}, label: "确认", children: createElement("span", null, "x") })));
    expect(dialog().hasAttribute("role")).toBe(false);
    expect(dialog().hasAttribute("aria-modal")).toBe(false);
  });

  it("Esc（cancel 事件）→ onDismiss 一次且 preventDefault", () => {
    const onDismiss = vi.fn();
    act(() => root.render(createElement(NativeDialog, { onDismiss, label: "确认", children: createElement("span", null, "x") })));
    const event = new Event("cancel", { cancelable: true });
    act(() => { dialog().dispatchEvent(event); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("背板点击（目标就是 dialog 本身）→ onDismiss；点内容不关", () => {
    const onDismiss = vi.fn();
    act(() => root.render(createElement(NativeDialog, { onDismiss, label: "确认", children: createElement("button", { id: "inner" }, "确定") })));
    act(() => { dialog().querySelector("#inner")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { dialog().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("卸载即 close；stub 不存在的 showModal 时退回 open 属性", () => {
    act(() => root.render(createElement(NativeDialog, { onDismiss: () => {}, label: "确认", children: createElement("span", null, "x") })));
    act(() => root.render(null));
    expect((proto["close"] as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    delete proto["showModal"];
    act(() => root.render(createElement(NativeDialog, { onDismiss: () => {}, label: "确认", children: createElement("span", null, "x") })));
    expect(dialog().hasAttribute("open")).toBe(true);
    act(() => root.render(null));
  });

  it("内部的菜单按模态上下文进 top layer（popover=manual）", () => {
    act(() => root.render(createElement(NativeDialog, { onDismiss: () => {}, label: "确认", children: [
      createElement("button", { key: "b" }, "确定"),
      createElement(Menu, { key: "m", open: true, onDismiss: () => {}, label: "菜单", children: createElement("button", null, "项") }),
    ] })));
    expect(document.querySelector(".ln-menu")!.getAttribute("popover")).toBe("manual");
    act(() => root.render(null));
  });
});
