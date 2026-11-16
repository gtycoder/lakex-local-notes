// @vitest-environment jsdom
/**
 * 261116 回归（task-15 根因）：**外层浮层的 portal 容器不能随内层模态漂移**。
 *
 * 现场：设置（外层 Dialog，.ln-scrim 挂 body）→ 打开内层原生模态（NativeDialog）→ 关掉它 ⇒
 * 整个设置面板消失。DOM 时序实测（9222）：
 *   remove ln-scrim from BODY → add ln-scrim into dialog.s3-transfer-dialog →（内层 dialog 卸载）panel 消失
 * 根因：旧实现每帧调 resolveOverlayContainer()，内层 <dialog open> 还挂在 DOM 时外层只要重渲染一次，
 *      它的 scrim 就被搬进那个 dialog；内层在同一批提交里卸载 ⇒ 外层 DOM 被一起删掉（onDismiss 没被调用）。
 * 修法：portal 容器在挂载时定死（显式 container > 已连接的既有 host > 首次解析结果），
 *      仅当本浮层确实位于某个模态浮层的 scope 里（菜单/气泡）才允许升级进对应 dialog。
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, Menu, NativeDialog } from "./Overlay";

let host: HTMLDivElement;
let root: Root;
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

const scrim = () => document.querySelector<HTMLElement>(".ln-scrim");
const render = (node: ReactNode) => act(() => root.render(node));
const openDialogs = () => Array.from(document.querySelectorAll("dialog[open]"));

/** 外层 = 设置面板那种「Dialog + 内层 NativeDialog」结构；用一个开关模拟内层打开/关闭。 */
function Shell({ innerOpen, label }: { innerOpen: boolean; label: string }) {
  return createElement(Dialog, { open: true, onDismiss: () => {}, label: "偏好设置", children: [
    createElement("span", { id: "outer-body", key: "b" }, label),
    innerOpen ? createElement(NativeDialog, { key: "i", open: true, onDismiss: () => {}, label: "内层弹窗", children: createElement("p", null, "内层正文") }) : null,
  ] });
}

describe("内嵌原生模态：外层浮层不随内层 dialog 漂移/被卸载（task-15）", () => {
  it("内层打开期间外层重渲染：scrim 仍挂 body（不会被搬进 dialog）", () => {
    render(createElement(Shell, { innerOpen: false, label: "初始" }));
    expect(scrim()!.parentElement).toBe(document.body);

    render(createElement(Shell, { innerOpen: true, label: "打开内层" }));
    expect(openDialogs()).toHaveLength(1);

    // 关键一步：内层还开着时外层再渲染一次（真实场景 = 设置面板任何 state 变化）
    render(createElement(Shell, { innerOpen: true, label: "外层重渲染" }));
    expect(openDialogs()).toHaveLength(1);
    expect(scrim()!.parentElement).toBe(document.body);
    expect(scrim()!.closest("dialog")).toBeNull();
  });

  it("关掉内层：外层仍在文档里，且没有触发外层的 onDismiss", () => {
    const outerDismiss = vi.fn();
    const innerDismiss = vi.fn();
    const shell = (innerOpen: boolean) => createElement(Dialog, {
      open: true, onDismiss: outerDismiss, label: "偏好设置",
      children: [
        createElement("span", { id: "outer-body", key: "b" }, "外层正文"),
        innerOpen ? createElement(NativeDialog, { key: "i", open: true, onDismiss: innerDismiss, label: "内层弹窗", children: createElement("p", null, "内层正文") }) : null,
      ],
    });

    render(shell(false));
    render(shell(true));
    render(shell(true)); // 触发一次外层重渲染（旧实现就是在这里把 scrim 搬进内层 dialog）
    render(shell(false)); // 关内层

    expect(document.querySelector("#outer-body")).not.toBeNull();
    expect(scrim()).not.toBeNull();
    expect(scrim()!.parentElement).toBe(document.body);
    expect(outerDismiss).not.toHaveBeenCalled();
    expect(openDialogs()).toHaveLength(0);
  });

  it("多个内层先后开关：外层始终留在 body", () => {
    render(createElement(Shell, { innerOpen: false, label: "0" }));
    for (const round of [1, 2, 3]) {
      render(createElement(Shell, { innerOpen: true, label: "open-" + round }));
      render(createElement(Shell, { innerOpen: true, label: "rerender-" + round }));
      render(createElement(Shell, { innerOpen: false, label: "close-" + round }));
      expect(scrim(), "第 " + round + " 轮后").not.toBeNull();
      expect(scrim()!.parentElement).toBe(document.body);
    }
  });
});

describe("内嵌原生模态：portal 容器的既有语义不回退", () => {
  it("外层 Dialog 的遮罩点击仍能关闭它（target === currentTarget）", () => {
    const onDismiss = vi.fn();
    render(createElement(Dialog, { open: true, onDismiss, label: "确认", children: createElement("p", null, "正文") }));
    act(() => { scrim()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("在原生模态内部打开的菜单仍挂进该 dialog（不能被 inert 挡住）", () => {
    const outer = (menuOpen: boolean) => createElement(NativeDialog, {
      open: true, onDismiss: () => {}, label: "外层原生",
      children: createElement("div", null,
        createElement("button", { type: "button" }, "菜单锚点"),
        menuOpen ? createElement(Menu, { key: "m", open: true, onDismiss: () => {}, label: "菜单", children: createElement("button", { type: "button" }, "项") }) : null,
      ),
    });
    render(outer(false));
    const dialog = document.querySelector("dialog")!;
    expect(dialog).not.toBeNull();
    // 菜单在 dialog 提交之后才打开 ⇒ 解析到 dialog（top layer 内，不在 inert 子树里）
    render(outer(true));
    const menu = document.querySelector(".ln-menu")!;
    expect(menu).not.toBeNull();
    expect(menu.closest("dialog")).toBe(dialog);
  });

  it("内层 dialog 的 Esc（cancel 事件）只关内层，不连带外层", () => {
    const outerDismiss = vi.fn();
    const innerDismiss = vi.fn();
    render(createElement(Dialog, {
      open: true, onDismiss: outerDismiss, label: "偏好设置",
      children: createElement(NativeDialog, { open: true, onDismiss: innerDismiss, label: "内层弹窗", children: createElement("p", null, "内层正文") }),
    }));
    const dialog = document.querySelector("dialog")!;
    act(() => { dialog.dispatchEvent(new Event("cancel", { cancelable: true })); });
    expect(innerDismiss).toHaveBeenCalledTimes(1);
    expect(outerDismiss).not.toHaveBeenCalled();
  });
});
