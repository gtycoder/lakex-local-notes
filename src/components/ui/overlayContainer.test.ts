// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { resolveOverlayContainer } from "./Overlay";

/**
 * 261116 修（overlay-matrix 实测）的护栏：模态 dialog 打开时，浮层不能 portal 到 body。
 * 原因：showModal() 让 dialog 之外的一切 inert —— top layer 里的菜单也点不到，点它还会关掉 dialog。
 * jsdom 没有 :modal 伪类，正好覆盖「catch ⇒ 按 open dialog 处理」的降级分支。
 */
describe("resolveOverlayContainer", () => {
  it("没有模态 dialog 时落到 body", () => {
    expect(resolveOverlayContainer()).toBe(document.body);
  });

  it("有 open 的 dialog 时挂进 dialog（不能在 inert 子树外）", () => {
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.body.appendChild(dialog);
    try {
      expect(resolveOverlayContainer()).toBe(dialog);
      // 浮层挂进去之后不在 inert 子树里（本仓 inert 只加在 body 的直接子节点上）
      const menu = document.createElement("div");
      menu.className = "ln-overlay-surface ln-menu";
      dialog.appendChild(menu);
      expect(menu.closest("[inert]")).toBeNull();
      expect(menu.parentElement).toBe(dialog);
    } finally {
      dialog.remove();
    }
  });

  it("显式 container 优先（AI 弹窗把浮层挂进滚动容器）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      expect(resolveOverlayContainer(host)).toBe(host);
    } finally {
      host.remove();
    }
  });
});
