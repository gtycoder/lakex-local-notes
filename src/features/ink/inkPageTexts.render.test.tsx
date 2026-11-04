// @vitest-environment jsdom
/**
 * 页内文字块（261104 二十三批）：插入 → IME 输入框 → 提交落盘 → 渲染成 SVG 文字；
 * 选中/双击再编辑/删除；导出（PDF HTML 与独立 SVG）里也有这段文字。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInkDoc, inkToBody, type InkDoc } from "../../core/inkDoc";
import { InkPad, type InkPadProps } from "./InkPad";

interface Mounted { container: HTMLElement; unmount: () => Promise<void> }

async function mount(props: Partial<InkPadProps> & Pick<InkPadProps, "content" | "variant" | "readOnly">): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => { root.render(<InkPad active {...props} />); });
  return {
    container,
    unmount: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
});

describe("手写板页内文字块", () => {
  it("插入文字 → 出现输入框；输入并 Ctrl+Enter 提交 → 正文里有一行文字、屏幕渲染成 <text>", async () => {
    const onChange = vi.fn();
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "desktop", readOnly: false, onChange });
    const insert = view.container.querySelector('button[aria-label="插入文字"]') as HTMLButtonElement;
    expect(insert).not.toBeNull();
    await act(async () => { insert.click(); });
    const editor = view.container.querySelector(".ink-text-editor") as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    await act(async () => { setTextareaValue(editor, "重点段落"); });
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    // 编辑框收起、SVG 里出现文字
    expect(view.container.querySelector(".ink-text-editor")).toBeNull();
    const textNode = view.container.querySelector("text[data-page-text]") as SVGTextElement;
    expect(textNode).not.toBeNull();
    expect(textNode.textContent).toBe("重点段落");
    // 防抖后落盘：正文 texts[0].text
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 620)); });
    const body = JSON.parse(onChange.mock.calls[onChange.mock.calls.length - 1][0]) as InkDoc;
    expect(body.pages[0].texts?.[0]?.text).toBe("重点段落");
    await view.unmount();
  });

  it("空文本提交 ⇒ 不留下空文字块（正文里没有 texts）", async () => {
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "desktop", readOnly: false });
    await act(async () => { (view.container.querySelector('button[aria-label="插入文字"]') as HTMLButtonElement).click(); });
    const editor = view.container.querySelector(".ink-text-editor") as HTMLTextAreaElement;
    await act(async () => { editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })); });
    expect(view.container.querySelector("text[data-page-text]")).toBeNull();
    await view.unmount();
  });

  it("双击已有文字进入编辑，可以改写；Delete 删除选中文字", async () => {
    const doc: InkDoc = createInkDoc("p1");
    doc.pages[0].texts = [{ id: "t1", x: 100, y: 150, width: 300, text: "旧文字", fontSize: 16, color: "#262626" }];
    const onChange = vi.fn();
    const view = await mount({ content: inkToBody(doc), variant: "desktop", readOnly: false, onChange });
    const svg = view.container.querySelector(".ink-page-svg") as SVGSVGElement;
    const frame = view.container.querySelector(".ink-page-frame") as HTMLElement;
    const rect = () => ({ left: 0, top: 0, width: 794, height: 1123, right: 794, bottom: 1123, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    frame.getBoundingClientRect = rect;
    svg.getBoundingClientRect = rect;
    await act(async () => {
      svg.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 110, clientY: 160 }));
    });
    const editor = view.container.querySelector(".ink-text-editor") as HTMLTextAreaElement;
    expect(editor).not.toBeNull();
    await act(async () => { setTextareaValue(editor, "新文字"); });
    await act(async () => { editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })); });
    expect((view.container.querySelector("text[data-page-text]") as SVGTextElement).textContent).toBe("新文字");
    // 选中后 Delete 删除
    await act(async () => {
      const down = new MouseEvent("pointerdown", { bubbles: true, clientX: 110, clientY: 160 });
      Object.defineProperty(down, "pointerId", { value: 3 });
      svg.dispatchEvent(down);
      svg.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 110, clientY: 160 }));
    });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" })); });
    expect(view.container.querySelector("text[data-page-text]")).toBeNull();
    await view.unmount();
  });
});
