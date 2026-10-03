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
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".bt-md-expand-seg .seg__item"));
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
});