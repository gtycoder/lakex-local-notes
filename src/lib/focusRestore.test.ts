// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { focusMainRegion, restoreFocus } from "./focusRestore";

/**
 * 261116 护栏：浮层关闭后焦点不能落 body。
 * 场景来源：overlay-matrix 实测「切换空间 → 偏好设置 → Esc」得到 activeElement=BODY。
 */
function makeMain(): HTMLElement {
  const main = document.createElement("main");
  document.body.appendChild(main);
  return main;
}

describe("restoreFocus", () => {
  it("触发器还在：直接还给它", () => {
    const main = makeMain();
    const button = document.createElement("button");
    main.appendChild(button);
    try {
      restoreFocus(button);
      expect(document.activeElement).toBe(button);
    } finally {
      main.remove();
    }
  });

  it("触发器已卸载：退到主区域，而不是 body", () => {
    const main = makeMain();
    const button = document.createElement("button");
    main.appendChild(button);
    button.remove();
    try {
      restoreFocus(button);
      expect(document.activeElement).toBe(main);
      expect(main.getAttribute("tabindex")).toBe("-1");
    } finally {
      main.remove();
    }
  });

  it("没有 main 时不抛错（退化为现状）", () => {
    const button = document.createElement("button");
    expect(() => restoreFocus(button)).not.toThrow();
  });
});

describe("focusMainRegion", () => {
  it("[role=main] 也认", () => {
    const main = document.createElement("div");
    main.setAttribute("role", "main");
    document.body.appendChild(main);
    try {
      focusMainRegion();
      expect(document.activeElement).toBe(main);
    } finally {
      main.remove();
    }
  });
});
