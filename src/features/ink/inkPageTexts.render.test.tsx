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

  it("选中文字出现控制条：A+ 放大字号、拖手柄改宽度、× 删除", async () => {
    const doc: InkDoc = createInkDoc("p1");
    doc.pages[0].texts = [{ id: "t1", x: 100, y: 150, width: 300, text: "文字", fontSize: 16, color: "#262626" }];
    const onChange = vi.fn();
    const view = await mount({ content: inkToBody(doc), variant: "desktop", readOnly: false, onChange });
    const svg = view.container.querySelector(".ink-page-svg") as SVGSVGElement;
    const frame = view.container.querySelector(".ink-page-frame") as HTMLElement;
    const rect = () => ({ left: 0, top: 0, width: 794, height: 1123, right: 794, bottom: 1123, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    frame.getBoundingClientRect = rect;
    svg.getBoundingClientRect = rect;
    // 没选中：控制条与边框都不出现（用户澄清：选中时才固定出现，失去焦点要消失）
    expect(view.container.querySelector(".ink-text-controls")).toBeNull();
    expect(view.container.querySelector(".ink-text-resize")).toBeNull();
    // 点选：控制条 + 拖宽手柄 + 删除键都在
    await act(async () => {
      const down = new MouseEvent("pointerdown", { bubbles: true, clientX: 110, clientY: 160 });
      Object.defineProperty(down, "pointerId", { value: 5 });
      svg.dispatchEvent(down);
      svg.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 110, clientY: 160 }));
    });
    expect(view.container.querySelector(".ink-text-controls")).not.toBeNull();
    expect(view.container.querySelector(".ink-text-resize")).not.toBeNull();
    expect(view.container.querySelector('button[aria-label="删除这段文字"]')).not.toBeNull();
    await act(async () => { (view.container.querySelector('button[aria-label="字号变大"]') as HTMLButtonElement).click(); });
    expect(Number((view.container.querySelector("text[data-page-text]") as SVGTextElement).getAttribute("font-size"))).toBe(18);
    // 拖宽：从 300 拖到 500
    const handle = view.container.querySelector(".ink-text-resize") as HTMLElement;
    await act(async () => {
      const down = new MouseEvent("pointerdown", { bubbles: true, clientX: 400, clientY: 200 });
      Object.defineProperty(down, "pointerId", { value: 6 });
      handle.dispatchEvent(down);
    });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointermove", { clientX: 600, clientY: 200 }) as PointerEvent); });
    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup", {}) as PointerEvent); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 620)); });
    const body = JSON.parse(onChange.mock.calls[onChange.mock.calls.length - 1][0]) as InkDoc;
    expect(body.pages[0].texts![0].width).toBeCloseTo(500, 0);
    expect(body.pages[0].texts![0].fontSize).toBe(18);
    // 点空白（失去焦点）⇒ 控制条与边框一起消失
    await act(async () => {
      const down = new MouseEvent("pointerdown", { bubbles: true, clientX: 600, clientY: 900 });
      Object.defineProperty(down, "pointerId", { value: 7 });
      svg.dispatchEvent(down);
      svg.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 600, clientY: 900 }));
    });
    expect(view.container.querySelector(".ink-text-controls")).toBeNull();
    // 再点回来后 × 删除
    await act(async () => {
      const down = new MouseEvent("pointerdown", { bubbles: true, clientX: 110, clientY: 160 });
      Object.defineProperty(down, "pointerId", { value: 8 });
      svg.dispatchEvent(down);
      svg.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 110, clientY: 160 }));
    });
    await act(async () => { (view.container.querySelector('button[aria-label="删除这段文字"]') as HTMLButtonElement).click(); });
    expect(view.container.querySelector("text[data-page-text]")).toBeNull();
    await view.unmount();
  });

  it("移动端 ＋ 菜单里有「文字」入口（贴图入口取决于宿主是否注入）；宿主没接入口时不出现 ＋，保持 7 键", async () => {
    // 宿主接了背景导入（真实移动端都会接）⇒ ＋ 出现，菜单里有文字；没接贴图就不显示贴图
    const view = await mount({
      content: inkToBody(createInkDoc("p1")),
      variant: "mobile",
      readOnly: false,
      onImportImages: async () => null,
    });
    const trigger = view.container.querySelector('button[aria-label="插入"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    await act(async () => { trigger.click(); });
    const menu = view.container.querySelector('[data-overlay="insert"]')!;
    expect(menu.querySelector('button[aria-label="插入文字"]')).not.toBeNull();
    expect(menu.querySelector('button[aria-label="插入贴图"]')).toBeNull();
    await view.unmount();
    const bare = await mount({ content: inkToBody(createInkDoc("p1")), variant: "mobile", readOnly: false });
    expect(bare.container.querySelector('button[aria-label="插入"]')).toBeNull();
    await bare.unmount();
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
