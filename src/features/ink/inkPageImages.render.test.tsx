// @vitest-environment jsdom
/**
 * 页内贴图交互（261104 二十一批）：插入（页宽 40% 居中）/ 选中 / 删除。
 * 拖动与缩放依赖真实指针序列，见 inkPageImages.test 的纯函数覆盖 + 设备验收。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { inkToBody, createInkDoc, INK_PAGE_WIDTH, type InkDoc } from "../../core/inkDoc";
import { InkPad, type InkPadProps } from "./InkPad";

const IMAGE_URL = "http://127.0.0.1:19877/note-1/1700000000200_abcd1234.png";

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

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class ResizeObserverStub { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
});

describe("手写板页内贴图", () => {
  it("插入：一个按钮 → 图落到当前页（页宽 40%、保持比例、居中）+ 自动选中", async () => {
    const onInsertPageImage = vi.fn(async () => ({ url: IMAGE_URL, naturalWidth: 800, naturalHeight: 400 }));
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "desktop", readOnly: false, onInsertPageImage });
    const btn = view.container.querySelector('button[aria-label="插入贴图"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => { btn.click(); });
    await act(async () => { await Promise.resolve(); });

    const image = view.container.querySelector("image[data-page-image]") as SVGImageElement | null;
    expect(image).not.toBeNull();
    expect(image!.getAttribute("href")).toBe(IMAGE_URL);
    const width = Number(image!.getAttribute("width"));
    const height = Number(image!.getAttribute("height"));
    const x = Number(image!.getAttribute("x"));
    expect(width).toBeCloseTo(INK_PAGE_WIDTH * 0.4, 1);
    expect(height).toBeCloseTo(width / 2, 1);          // 800x400 ⇒ 2:1
    expect(x).toBeCloseTo((INK_PAGE_WIDTH - width) / 2, 1);
    // 自动选中：虚线框 + 删除按钮都在
    expect(view.container.querySelector(".ink-image-select")).not.toBeNull();
    expect(view.container.querySelector('button[aria-label="删除这张图"]')).not.toBeNull();
    await view.unmount();
  });

  it("删除：选中后点 × ⇒ 图消失，正文里也不再有 images（防抖后落盘）", async () => {
    const doc: InkDoc = createInkDoc("p1");
    doc.pages[0].images = [{ id: "i1", url: IMAGE_URL, x: 100, y: 100, width: 200, height: 100 }];
    const onChange = vi.fn();
    const view = await mount({ content: inkToBody(doc), variant: "desktop", readOnly: false, onChange });
    // 先点图选中
    const image = view.container.querySelector("image[data-page-image]") as SVGImageElement;
    await act(async () => {
      const event = new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      image.dispatchEvent(event);
    });
    // 删除按钮（选中态渲染在 frame 上的 HTML 浮层）
    const remove = view.container.querySelector('button[aria-label="删除这张图"]') as HTMLButtonElement;
    expect(remove).not.toBeNull();
    await act(async () => { remove.click(); });
    expect(view.container.querySelector("image[data-page-image]")).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 620)); });
    expect(onChange).toHaveBeenCalled();
    const body = JSON.parse(onChange.mock.calls[onChange.mock.calls.length - 1][0]) as InkDoc;
    expect(body.pages[0].images).toBeUndefined();
    await view.unmount();
  });

  it("没有注入 onInsertPageImage（移动端/未接宿主）：没有插入按钮", async () => {
    const view = await mount({ content: inkToBody(createInkDoc("p1")), variant: "desktop", readOnly: false });
    expect(view.container.querySelector('button[aria-label="插入贴图"]')).toBeNull();
    await view.unmount();
  });
});
