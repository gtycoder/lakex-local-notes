// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudCheckIcon } from "./SyncStatusPopover";

/**
 * 261116：同步完成态「云+对钩」吃全局描边。原实现没挂 lucide 类、也没走令牌，
 * 自带 strokeWidth="2" ⇒ 14px 下 1.17px，比同一行相邻的 lucide 图标（1.02px）重 15%。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false); });

describe("CloudCheckIcon（同步完成态）", () => {
  it("24 网格 + lucide 类，不自带 strokeWidth（与同按钮其它 lucide 图标同几何）", () => {
    act(() => root.render(createElement(CloudCheckIcon, { size: 14 })));
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.classList.contains("lucide")).toBe(true);
    expect(svg.hasAttribute("stroke-width")).toBe(false);
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(host.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("默认尺寸 14（顶栏同步按钮既有档位）", () => {
    act(() => root.render(createElement(CloudCheckIcon)));
    expect(host.querySelector("svg")!.getAttribute("width")).toBe("14");
  });
});
