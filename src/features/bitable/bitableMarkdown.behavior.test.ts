// @vitest-environment jsdom
/**
 * Markdown 单元格 + 展开浮窗行为测试（261004）：
 * 单元格单行预览 → 「展开」默认编辑态（textarea=原文）→ 切「预览」出渲染结果 → 编辑写回 onChange；
 * 只读时默认预览、编辑禁用。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownCell } from "./bitableCells";
import type { BitableField } from "../../core/bitableDoc.js";

const FIELD: BitableField = { id: "f-md", name: "复盘", type: "markdown" };
const SOURCE = "# 标题\n\n正文 **粗**";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(value: string, options: { readOnly?: boolean; onChange?: (next: unknown) => void } = {}) {
  const onChange = options.onChange ?? vi.fn();
  act(() => {
    root.render(createElement(MarkdownCell, { field: FIELD, value, readOnly: options.readOnly ?? false, onChange }));
  });
  return { onChange };
}
function openPanel() {
  act(() => { host.querySelector<HTMLButtonElement>(".bt-expand-btn")!.click(); });
}
function segButton(label: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".ln-segment .ln-segment__item"));
  const hit = buttons.find((button) => button.textContent === label);
  if (!hit) throw new Error("找不到分段按钮：" + label);
  return hit;
}

describe("Markdown 单元格与展开浮窗（261004）", () => {
  it("单元格 = 去标记单行预览；展开默认「编辑」态（textarea = MD 原文）", () => {
    render(SOURCE);
    expect(host.querySelector(".bt-md-cell-preview")!.textContent).toBe("标题 正文 粗");
    openPanel();
    const editor = document.querySelector<HTMLTextAreaElement>(".bt-md-expand-editor");
    expect(editor).not.toBeNull();
    expect(editor!.value).toBe(SOURCE);
    expect(segButton("编辑").classList.contains("is-active")).toBe(true);
    expect(segButton("预览").classList.contains("is-active")).toBe(false);
  });

  it("切「预览」出渲染结果（标题 / 粗体）；切回「编辑」继续改原文", () => {
    render(SOURCE);
    openPanel();
    act(() => segButton("预览").click());
    const preview = document.querySelector(".bt-md-expand-preview")!;
    expect(preview.querySelector("h1")?.textContent).toBe("标题");
    expect(preview.querySelector("strong")?.textContent).toBe("粗");
    expect(document.querySelector(".bt-md-expand-editor")).toBeNull();
    act(() => segButton("编辑").click());
    expect(document.querySelector<HTMLTextAreaElement>(".bt-md-expand-editor")!.value).toBe(SOURCE);
  });

  it("编辑态输入写回 onChange（与单元格同一条写入路径）", () => {
    const { onChange } = render("abc");
    openPanel();
    const editor = document.querySelector<HTMLTextAreaElement>(".bt-md-expand-editor")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(editor, "abc def");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("abc def");
  });

  it("只读：默认「预览」、编辑按钮禁用、不出 textarea", () => {
    render(SOURCE, { readOnly: true });
    openPanel();
    expect(document.querySelector(".bt-md-expand-editor")).toBeNull();
    expect(document.querySelector(".bt-md-expand-preview h1")?.textContent).toBe("标题");
    expect(segButton("编辑").disabled).toBe(true);
    expect(segButton("预览").classList.contains("is-active")).toBe(true);
  });

  it("拖动头部移动后再拖右下角缩放：面板位置不回弹（261004 修复 size.h 依赖导致的跳回锚点）", () => {
    render("abc");
    openPanel();
    const panel = document.querySelector<HTMLElement>(".bt-text-expand")!;
    expect(panel.style.left).not.toBe("");
    // 拖头部移动 (100,100) → (220,180)
    act(() => {
      panel.querySelector<HTMLElement>(".bt-text-expand-head")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 220, clientY: 180 }));
      window.dispatchEvent(new MouseEvent("pointerup", {}));
    });
    const moved = { left: panel.style.left, top: panel.style.top };
    expect(moved.left).not.toBe("");
    // 再拖右下角缩放 +80/+60：位置必须保持、尺寸必须变化
    act(() => {
      panel.querySelector<HTMLElement>(".bt-text-expand-resize")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 300 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 380, clientY: 360 }));
      window.dispatchEvent(new MouseEvent("pointerup", {}));
    });
    expect(panel.style.width).toBe("480px");
    expect(panel.style.left).toBe(moved.left);
    expect(panel.style.top).toBe(moved.top);
  });

  it("尺寸本地记忆：打开用记住的大小、松手写回；未记忆时用默认（261004）", () => {
    localStorage.setItem("lake-notes-v3.bitable-expand-size", JSON.stringify({ md: { w: 500, h: 360 } }));
    render("abc");
    openPanel();
    const panel = document.querySelector<HTMLElement>(".bt-text-expand")!;
    expect(panel.style.width).toBe("500px");
    expect(panel.style.height).toBe("360px");
    // 缩放到 580 宽 → 松手写回本地
    act(() => {
      panel.querySelector<HTMLElement>(".bt-text-expand-resize")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 300 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 380, clientY: 300 }));
      window.dispatchEvent(new MouseEvent("pointerup", {}));
    });
    expect(panel.style.width).toBe("580px");
    const stored = JSON.parse(localStorage.getItem("lake-notes-v3.bitable-expand-size")!) as { md?: { w: number } };
    expect(stored.md?.w).toBe(580);
  });

  it("未记忆过时用默认大小（400×260）", () => {
    render("abc");
    openPanel();
    const panel = document.querySelector<HTMLElement>(".bt-text-expand")!;
    expect(panel.style.width).toBe("400px");
    expect(panel.style.height).toBe("260px");
  });

  it("展开浮窗适配窗口边界：锚点贴右/下缘时不越出视口（261006 修复）", () => {
    // jsdom 视口 1024×768；记住的宽度 900 —— 旧实现横向只按占位宽 400 夹取，会按左侧 616 定位、
    // 实际 900 宽渲染 ⇒ 右缘 1516 越界；修复后必须用真实尺寸夹取，面板完整落在视口内。
    localStorage.setItem("lake-notes-v3.bitable-expand-size", JSON.stringify({ md: { w: 900, h: 300 } }));
    render("abc");
    const button = host.querySelector<HTMLButtonElement>(".bt-expand-btn")!;
    button.getBoundingClientRect = () => ({ x: 820, y: 100, top: 100, bottom: 140, left: 820, right: 900, width: 80, height: 40, toJSON: () => ({}) } as unknown as DOMRect);
    openPanel();
    const panel = document.querySelector<HTMLElement>(".bt-text-expand")!;
    const left = Number.parseFloat(panel.style.left);
    const top = Number.parseFloat(panel.style.top);
    const width = Number.parseFloat(panel.style.width);
    const height = Number.parseFloat(panel.style.height);
    expect(width).toBe(900);
    expect(left + width).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(top + height).toBeLessThanOrEqual(window.innerHeight - 8);
  });

  it("AI 字段展开默认进「预览」，Markdown 字段默认进「编辑」（261006）", () => {
    // AI 字段：直接进预览（先看生成结果），点「编辑」才出 textarea
    const aiField: BitableField = { id: "f-ai", name: "复盘", type: "ai" };
    act(() => {
      root.render(createElement(MarkdownCell, { field: aiField, value: SOURCE, readOnly: false, onChange: vi.fn() }));
    });
    openPanel();
    expect(document.querySelector(".bt-md-expand-editor")).toBeNull();
    expect(document.querySelector(".bt-md-expand-preview h1")?.textContent).toBe("标题");
    expect(segButton("预览").classList.contains("is-active")).toBe(true);
    act(() => segButton("编辑").click());
    expect(document.querySelector<HTMLTextAreaElement>(".bt-md-expand-editor")!.value).toBe(SOURCE);
  });
});