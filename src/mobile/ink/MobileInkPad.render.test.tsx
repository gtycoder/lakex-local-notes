// @vitest-environment jsdom
/**
 * 移动端手写板行为护栏（261030 用户点单：分页与纸张无法切换）。
 *
 * 根因两条，单测各钉一条：
 *   ① 布局：工作区底部胶囊是 fixed（高 56、离底 32），文档 pane 一直铺到屏幕底 ⇒ footer（分页/纸张）
 *      整排落在胶囊底下点不到。修复 = 只读态给 .ink-pad--mobile 底部让位（纯 CSS，用设备快照/几何断言兜不住，
 *      这里只钉「组件确实带 data-readonly + class 名与 CSS 挂钩」）。
 *   ② 语义：手写板默认进阅读态 ⇒ 纸张/新建页原本就 disabled（正文数据），但页面管理里的前移/后移/删除
 *      是「点了没反应」的静默 no-op。修复 = 只读态禁用并给可见解释；切页是纯视图（不写正文），阅读态仍可用。
 *
 * 第三条是保存竞态：切完纸张立刻点「完成」时，500ms 防抖里的正文必须能被 capture 现取到
 * （NotebookWorkspace 已按 board/usheet 同一条写边界注册 onEditorCapture）。
 *
 * 为什么手写 createRoot + act：仓内没有 @testing-library/react（沿用 multiTabHost.render.test.tsx 的先例）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInkDoc, createInkPage, inkToBody, type InkDoc } from "../../core/inkDoc";
import { MobileInkPad } from "./MobileInkPad";

const READONLY_HINT = "阅读态：点右上角「编辑」后可修改纸张与页面";

function twoPageBody(): string {
  const base = createInkDoc("page-1");
  const doc: InkDoc = { ...base, pages: [...base.pages, createInkPage("page-2", "blank")], activePageId: "page-1" };
  return inkToBody(doc);
}

interface MountOptions {
  content: string;
  readOnly: boolean;
  onChange?: (body: string) => void;
  onDirty?: () => void;
  onEditorCapture?: (capture: (() => string | null) | null) => void;
}

interface Mounted {
  container: HTMLElement;
  root: Root;
  unmount: () => Promise<void>;
}

async function mount(options: MountOptions): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MobileInkPad
        content={options.content}
        readOnly={options.readOnly}
        active
        onChange={options.onChange}
        onDirty={options.onDirty}
        onEditorCapture={options.onEditorCapture}
      />,
    );
  });
  return {
    container,
    root,
    unmount: async () => {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

function byLabel(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
}

function byText(container: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === text) as HTMLButtonElement | undefined;
}

function pageLabel(container: HTMLElement): string {
  return (container.querySelector(".ink-pages span")?.textContent ?? "").trim();
}

beforeAll(() => {
  // React 18 的 act 环境标记（没有 testing-library 时需手动打开，否则 act 不 flush effect）。
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom 没有 ResizeObserver（InkPad 用它算「页面适应窗口」），给一个不回调的空壳即可。
  class ResizeObserverStub {
    observe() { /* no-op */ }
    unobserve() { /* no-op */ }
    disconnect() { /* no-op */ }
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
});

describe("MobileInkPad 阅读态（默认打开态）", () => {
  it("给可见解释；纸张与新建页禁用；上一页/下一页可用且不写正文", async () => {
    const content = twoPageBody();
    const onChange = vi.fn();
    const onDirty = vi.fn();
    const captures: Array<() => string | null> = [];
    const view = await mount({
      content,
      readOnly: true,
      onChange,
      onDirty,
      onEditorCapture: (capture) => { if (capture) captures.push(capture); },
    });

    expect(view.container.textContent).toContain(READONLY_HINT);
    expect(byLabel(view.container, "新建页")!.disabled).toBe(true);
    expect(byText(view.container, "横线")!.disabled).toBe(true);
    expect(byLabel(view.container, "上一页")!.disabled).toBe(true); // 已在第 1 页
    const next = byLabel(view.container, "下一页")!;
    expect(next.disabled).toBe(false);

    await act(async () => { next.click(); });
    expect(pageLabel(view.container)).toContain("第 2 / 2 页");
    expect(onChange).not.toHaveBeenCalled();
    expect(onDirty).not.toHaveBeenCalled();

    // capture 在阅读态一律交磁盘原文：桌面锁定/已删除文档的保存管线也不会因翻页写盘。
    expect(captures.length).toBeGreaterThan(0);
    expect(captures[captures.length - 1]()).toBe(content);

    await view.unmount();
  });

  it("页面管理：前移/后移/删除/新建页禁用，选页（纯视图）仍可用", async () => {
    const content = twoPageBody();
    const onChange = vi.fn();
    const view = await mount({ content, readOnly: true, onChange });

    await act(async () => { byLabel(view.container, "页面管理")!.click(); });
    const strip = view.container.querySelector(".ink-page-strip");
    expect(strip).not.toBeNull();
    expect((strip!.querySelector(".ink-page-strip__add") as HTMLButtonElement).disabled).toBe(true);
    const actions = Array.from(strip!.querySelectorAll(".ink-page-thumb__actions button")) as HTMLButtonElement[];
    expect(actions.length).toBe(6); // 2 页 ×（前移/后移/删除）
    expect(actions.every((button) => button.disabled)).toBe(true);

    const papers = strip!.querySelectorAll(".ink-page-thumb__paper");
    await act(async () => { (papers[1] as HTMLButtonElement).click(); });
    expect(pageLabel(view.container)).toContain("第 2 / 2 页");
    expect(onChange).not.toHaveBeenCalled();

    await view.unmount();
  });
});

describe("MobileInkPad 阅读态 capture", () => {
  it("交父层最新正文：编辑保存后不能把「打开时」的旧原文交回去（否则退出时覆盖刚保存的正文）", async () => {
    const contentA = twoPageBody();
    const captureFns: Array<() => string | null> = [];
    const view = await mount({
      content: contentA,
      readOnly: true,
      onEditorCapture: (capture) => { if (capture) captureFns.push(capture); },
    });
    const capture = () => captureFns[captureFns.length - 1]();
    expect(capture()).toBe(contentA);

    const edited = JSON.parse(contentA) as InkDoc;
    edited.pages[0].background = "lined";
    const contentB = inkToBody(edited);
    await act(async () => {
      view.root.render(
        <MobileInkPad content={contentB} readOnly active onEditorCapture={(fn) => { if (fn) captureFns.push(fn); }} />,
      );
    });
    expect(capture()).toBe(contentB);

    await view.unmount();
  });
});

describe("MobileInkPad 编辑态", () => {
  it("没有阅读态说明；点纸张立即标脏，500ms 防抖后写正文", async () => {
    const content = twoPageBody();
    const onChange = vi.fn();
    const onDirty = vi.fn();
    const view = await mount({ content, readOnly: false, onChange, onDirty });

    expect(view.container.textContent).not.toContain(READONLY_HINT);
    const lined = byText(view.container, "横线")!;
    expect(lined.disabled).toBe(false);

    await act(async () => { lined.click(); });
    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled(); // 还在防抖窗口内

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 620)); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onChange.mock.calls[0][0]).pages[0].background).toBe("lined");

    await view.unmount();
  });

  it("防抖窗口内 capture 能现取到最新正文（切完纸张立刻点完成的保存竞态）", async () => {
    const content = twoPageBody();
    const captures: Array<() => string | null> = [];
    const view = await mount({
      content,
      readOnly: false,
      onChange: vi.fn(),
      onDirty: vi.fn(),
      onEditorCapture: (capture) => { if (capture) captures.push(capture); },
    });

    await act(async () => { byText(view.container, "网格")!.click(); });
    const captured = captures[captures.length - 1]();
    expect(captured).not.toBeNull();
    expect(JSON.parse(captured!).pages[0].background).toBe("grid");

    await view.unmount();
  });
});
