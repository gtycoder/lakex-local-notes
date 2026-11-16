// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RowExpandIcon } from "./bitableEditorModel";

/**
 * 261116 用户裁决：多维表行「展开」从云端 lakex 的 1024 网格实心四角箭头，
 * 换成 **IconPark FullScreen**（Apache-2.0）并重写到 24 网格 —— 这里钉住三件事：
 * ① 24 网格 + lucide 类（描边吃全局 1.75，15px 档 = 1.09px）；② 四条 path 的几何（48 网格坐标 ÷2）；
 * ③ 不许自带 strokeWidth / fill（否则就是第二条描边来源）。
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

describe("RowExpandIcon（多维表展开行，IconPark FullScreen）", () => {
  it("24 网格描边图形：四条 path、几何 = 48 网格 ÷2、描边走全局单一来源", () => {
    act(() => root.render(createElement(RowExpandIcon, { size: 15 })));
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.classList.contains("lucide")).toBe(true);
    expect(svg.hasAttribute("stroke-width")).toBe(false);
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("width")).toBe("15");
    expect(svg.getAttribute("height")).toBe("15");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    const ds = [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    expect(ds).toEqual(["M16.5 3H21V7.5", "M21 16.5V21H16.5", "M7.5 21H3V16.5", "M3 7.5V3H7.5"]);
  });

  it("默认尺寸 15（多维表行按钮的既有档位）", () => {
    act(() => root.render(createElement(RowExpandIcon)));
    expect(host.querySelector("svg")!.getAttribute("width")).toBe("15");
  });
});
