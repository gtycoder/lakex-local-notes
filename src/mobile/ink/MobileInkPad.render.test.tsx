// @vitest-environment jsdom
/**
 * 移动端手写板行为护栏（261030 分页/纸张修复 + 261102 布局重构）。
 *
 * 261102 用户定稿的移动端结构（**只对 variant=mobile**，桌面 InkPad 结构不变）：
 *   · 顶部固定条（阅读/编辑两态同一条）：翻页 | 缩放 | 全局预览 —— 三者都是纯视图操作，阅读态可用；
 *   · 底部工具坞（**仅编辑态**）：笔/高亮/橡皮/颜色/笔宽/撤销重做 + 纸张（正文数据，阅读态没有入口）；
 *   · 阅读态没有底部工具坞、没有只读说明行；底部只剩工作区胶囊（让位见 inkPad.mobile.css）。
 *
 * 另钉三条行为：
 *   ① 缩放/翻页在阅读态真的生效且不写正文（onChange 不被调用）；
 *   ② 全局预览复用 InkPageStrip：阅读态编辑项禁用、选页（纯视图）可用；
 *   ③ 保存竞态：切完纸张立刻点「完成」时，500ms 防抖里的正文必须能被 capture 现取到
 *      （NotebookWorkspace 已按 board/usheet 同一条写边界注册 onEditorCapture）；
 *      阅读态 capture 交父层最新正文（不是挂载时旧原文，否则退出会覆盖刚保存的正文）。
 *
 * 为什么手写 createRoot + act：仓内没有 @testing-library/react（沿用 multiTabHost.render.test.tsx 的先例）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { QUICK_TEXT_COLORS } from "../../core/colorPalette";
import { createInkDoc, createInkPage, inkToBody, type InkDoc } from "../../core/inkDoc";
import { MobileInkPad } from "./MobileInkPad";

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

function zoomLabel(container: HTMLElement): string {
  return (container.querySelector(".ink-zoom__value")?.textContent ?? "").trim();
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
  it("顶部固定条常在：翻页/缩放/全局预览可用；无底部工具坞、无纸张入口、无说明行", async () => {
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

    const nav = view.container.querySelector('[aria-label="手写板导航"]');
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute("data-overlay")).toBe("nav"); // 悬浮标记（不占布局，见 CSS 断言）
    expect(nav!.querySelector('[aria-label="全局预览"]')).not.toBeNull();
    // 阅读态：没有底部工具坞（overlay dock）/ 没有纸张（正文数据）/ 没有旧的只读说明行
    expect(view.container.querySelector('[data-overlay="dock"]')).toBeNull();
    expect(view.container.querySelector(".ink-footer")).toBeNull();
    expect(byText(view.container, "横线")).toBeUndefined();
    expect(view.container.textContent).not.toContain("阅读态：点右上角");

    // 翻页：纯视图，不写正文
    expect(byLabel(view.container, "上一页")!.disabled).toBe(true); // 已在第 1 页
    const next = byLabel(view.container, "下一页")!;
    expect(next.disabled).toBe(false);
    await act(async () => { next.click(); });
    expect(pageLabel(view.container)).toContain("第 2 / 2 页");
    expect(onChange).not.toHaveBeenCalled();
    expect(onDirty).not.toHaveBeenCalled();

    // capture 在阅读态交父层正文：桌面锁定/已删除文档的保存管线也不会因翻页写盘。
    expect(captures.length).toBeGreaterThan(0);
    expect(captures[captures.length - 1]()).toBe(content);

    await view.unmount();
  });

  it("顶部缩放在阅读态真的生效：放大到 125%，点百分比复位 100%", async () => {
    const onChange = vi.fn();
    const view = await mount({ content: twoPageBody(), readOnly: true, onChange });

    expect(zoomLabel(view.container)).toBe("100%");
    await act(async () => { byLabel(view.container, "放大")!.click(); });
    expect(zoomLabel(view.container)).toBe("125%");
    await act(async () => { byLabel(view.container, "恢复为适应页面")!.click(); });
    expect(zoomLabel(view.container)).toBe("100%");
    expect(onChange).not.toHaveBeenCalled();

    await view.unmount();
  });

  it("全局预览打开 InkPageStrip：阅读态编辑项禁用，缩略图选页仍可用，关闭可收起", async () => {
    const onChange = vi.fn();
    const view = await mount({ content: twoPageBody(), readOnly: true, onChange });

    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
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

    await act(async () => { byLabel(view.container, "关闭页面管理")!.click(); });
    expect(view.container.querySelector(".ink-page-strip")).toBeNull();

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
  it("顶部条仍在 + 底部工具坞出现（笔/颜色/笔宽/撤销重做/纸张）；点纸张标脏、防抖写正文", async () => {
    const content = twoPageBody();
    const onChange = vi.fn();
    const onDirty = vi.fn();
    const view = await mount({ content, readOnly: false, onChange, onDirty });

    // 顶部导航两态都在；底部工具坞只在编辑态且是悬浮面
    expect(view.container.querySelector('[aria-label="手写板导航"]')).not.toBeNull();
    const dock = view.container.querySelector('[aria-label="手写工具"]');
    expect(dock).not.toBeNull();
    expect(dock!.getAttribute("data-overlay")).toBe("dock");
    expect(dock!.querySelector('[aria-label="画笔"]')).not.toBeNull();
    expect(dock!.querySelector('[aria-label="高亮笔"]')).not.toBeNull();
    expect(dock!.querySelector('[aria-label="整笔橡皮"]')).not.toBeNull();
    expect(dock!.querySelector('[aria-label="撤销"]')).not.toBeNull();
    // 工具图标 18（按钮盒仍 44，见 CSS 断言）
    expect(dock!.querySelector('[aria-label="画笔"] svg')!.getAttribute("width")).toBe("18");
    // 颜色：44 按钮盒里的 <span> 内圆（CSS 定 28），内联的是圆点颜色
    const colors = Array.from(dock!.querySelectorAll(".ink-color")) as HTMLButtonElement[];
    expect(colors.length).toBe(1 + QUICK_TEXT_COLORS.length); // 与 InkPad 的 COLORS 同源（主色盘第 1 色 + 快捷色）
    for (const color of colors) {
      const dot = color.querySelector("span");
      expect(dot).not.toBeNull();
      expect((dot as HTMLElement).style.backgroundColor).not.toBe("");
    }

    const lined = byText(view.container, "横线")!;
    expect(lined.disabled).toBe(false);
    await act(async () => { lined.click(); });
    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled(); // 还在防抖窗口内

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 620)); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onChange.mock.calls[0][0]).pages[0].background).toBe("lined");

    // 编辑态的全局预览：新建页 / 前移 / 后移 / 删除都可用（阅读态才禁用）
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    const strip = view.container.querySelector(".ink-page-strip")!;
    expect((strip.querySelector(".ink-page-strip__add") as HTMLButtonElement).disabled).toBe(false);
    const actions = Array.from(strip.querySelectorAll(".ink-page-thumb__actions button")) as HTMLButtonElement[];
    expect(actions.filter((button) => !button.disabled).length).toBeGreaterThan(0);

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
