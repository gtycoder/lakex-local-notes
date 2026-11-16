// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiTagIcon } from "./AiTagIcon";

/**
 * 261116：渐变 id 必须每实例唯一。本图标在选区工具条与图片卡工具条**同屏各渲染一次**，
 * 原先写死 id="ai-tag-grad" ⇒ 重复 DOM id（任一实例卸载后另一实例的 url(#…) 可能在部分引擎失效）。
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

describe("AiTagIcon（工具栏 AI 入口）", () => {
  it("同屏两个实例的渐变 id 唯一，且各自 path 引用自己的 id", () => {
    act(() => root.render(createElement("div", null, createElement(AiTagIcon), createElement(AiTagIcon))));
    const grads = [...host.querySelectorAll("linearGradient")];
    expect(grads).toHaveLength(2);
    const ids = grads.map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
    const fills = [...host.querySelectorAll("path[fill^='url(']")].map((p) => p.getAttribute("fill"));
    expect(fills).toHaveLength(2);
    expect(fills[0]).toBe(`url(#${ids[0]})`);
    expect(fills[1]).toBe(`url(#${ids[1]})`);
  });

  it("颜色仍只走主题令牌（组件内无颜色字面量）", () => {
    act(() => root.render(createElement(AiTagIcon, { size: 18 })));
    const html = host.innerHTML;
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(html).toContain("--lake-ai-tag-from");
    expect(html).toContain("--lake-ai-tag-to");
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 222 222");
    expect(svg.getAttribute("width")).toBe("18");
  });
});
