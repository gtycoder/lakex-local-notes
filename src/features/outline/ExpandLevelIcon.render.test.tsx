// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpandLevelIcon } from "./ExpandLevelIcon";

/**
 * 261116：描边唯一来源回归。本图标带 className="lucide" ⇒ 描边由 base.css 的
 * `svg.lucide{stroke-width:1.75}` 提供；组件里**不许**自带 strokeWidth（那是死值：
 * 展示属性压不过 CSS，写 1.7 实际也渲染 1.75，只会让人误以为能逐图标调）。
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

describe("ExpandLevelIcon（大纲「展开到级别」）", () => {
  it("24 网格 + lucide 类，不自带 strokeWidth（吃全局 1.75）", () => {
    act(() => root.render(createElement(ExpandLevelIcon, { size: 14 })));
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.classList.contains("lucide")).toBe(true);
    expect(svg.hasAttribute("stroke-width")).toBe(false);
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("height")).toBe("14");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll("path")).toHaveLength(5);
  });

  it("默认尺寸 14（大纲头部第四枚按钮的既有档位）", () => {
    act(() => root.render(createElement(ExpandLevelIcon)));
    expect(host.querySelector("svg")!.getAttribute("width")).toBe("14");
  });
});
