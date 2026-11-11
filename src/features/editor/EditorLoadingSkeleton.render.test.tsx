// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorLoadingSkeleton } from "./EditorLoadingSkeleton";

/**
 * 编辑器懒加载骨架（261111 task-16）：document / composer 两变体的结构 + 可访问名。
 * 纯静态块：无动画、无 inline style；高度靠宿主外壳（这里只验结构，不验布局）。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function render(variant?: "document" | "composer") {
  act(() => root.render(createElement(EditorLoadingSkeleton, variant ? { variant } : {})));
}
const skeleton = () => host.querySelector<HTMLElement>(".editor-skeleton")!;

describe("EditorLoadingSkeleton（261111）", () => {
  it("document 变体：顶栏条 + 正文行，role=status 且可访问文案视觉隐藏", () => {
    render();
    const el = skeleton();
    expect(el).not.toBeNull();
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-busy")).toBe("true");
    expect(el.querySelector(".editor-skeleton__toolbar")).not.toBeNull();
    expect(el.querySelectorAll(".editor-skeleton__pill")).toHaveLength(3);
    expect(el.querySelectorAll(".editor-skeleton__line")).toHaveLength(6);
    // 文案保留在可访问树里，但用通用视觉隐藏工具类（组件里不写 clip/inline style）
    const hidden = el.querySelector(".a11y-visually-hidden")!;
    expect(hidden.textContent).toBe("正在加载编辑器…");
    expect(hidden.getAttribute("style")).toBeNull();
    // 纯静态块：没有内联样式（样式全部在 styles/app/editor.css）
    expect(el.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("composer 变体：不渲染顶栏（写作卡内嵌，避免多一条工具条），行数更少", () => {
    render("composer");
    const el = skeleton();
    expect(el.className).toContain("editor-skeleton--composer");
    expect(el.querySelector(".editor-skeleton__toolbar")).toBeNull();
    expect(el.querySelectorAll(".editor-skeleton__line")).toHaveLength(4);
    expect(el.textContent).toContain("正在加载编辑器…");
  });
});
