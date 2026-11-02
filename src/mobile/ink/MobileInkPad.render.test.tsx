// @vitest-environment jsdom
/**
 * 移动端手写板行为护栏（261030 分页/纸张 → 261102 v1/v2 布局 → v3 悬浮/收口）。
 *
 * v3（本文件）在 v2 基础上再钉四件事：
 *   · 工具行收成一屏：笔/高亮/橡皮 + **当前色** + **当前笔宽** + 撤销/重做（7 个 44 按钮，不再内联 7 色/4 档）；
 *   · 颜色/笔宽都是「当前值按钮 → 点开悬浮面板」（面板绝对定位在工具坞上方 8，不占布局），选值写回并关闭，
 *     点面板/触发按钮之外（pointerdown）也关闭；
 *   · 全局预览在移动端是**悬浮覆盖**（data-overlay="preview" 包装，不再把画布往下推；桌面仍是流内面板）；
 *   · 阅读态无底部工具坞、无面板、无纸张入口；缩放/翻页/预览在阅读态可用且不写正文。
 * 保存竞态与 capture 语义同 v2（切完纸张立刻点完成不得丢最后 500ms；阅读态 capture 交父层正文）。
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
  it("顶部悬浮导航常在：翻页/缩放/全局预览可用；无底部工具坞、无面板、无纸张入口", async () => {
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
    // 阅读态：没有底部工具坞（overlay dock）、没有色板/笔宽面板、没有纸张（正文数据）、没有旧的只读说明行
    expect(view.container.querySelector('[data-overlay="dock"]')).toBeNull();
    expect(view.container.querySelector('[data-overlay="palette"]')).toBeNull();
    expect(view.container.querySelector('[data-overlay="widths"]')).toBeNull();
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

  it("全局预览是悬浮覆盖（data-overlay=preview）：阅读态编辑项禁用、选页可用、关闭可收起", async () => {
    const onChange = vi.fn();
    const view = await mount({ content: twoPageBody(), readOnly: true, onChange });

    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    const preview = view.container.querySelector('[data-overlay="preview"]');
    expect(preview).not.toBeNull();
    const strip = preview!.querySelector(".ink-page-strip");
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
    expect(view.container.querySelector('[data-overlay="preview"]')).toBeNull();

    await view.unmount();
  });

  it("预览悬浮层：点面板外部关闭；点面板内部不关闭（移动端；桌面仍是流内面板）", async () => {
    const view = await mount({ content: twoPageBody(), readOnly: true });
    const previewSel = '[data-overlay="preview"]';
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    const preview = view.container.querySelector(previewSel);
    expect(preview).not.toBeNull();
    // 点面板内部（缩略图条）不关闭
    await act(async () => { preview!.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(view.container.querySelector(previewSel)).not.toBeNull();
    // 点画布（面板外部）关闭
    const stage = view.container.querySelector(".ink-page-stage") as HTMLElement;
    await act(async () => { stage.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(view.container.querySelector(previewSel)).toBeNull();
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

describe("MobileInkPad 编辑态 · 悬浮工具坞", () => {
  it("工具行收成一屏：3 工具 + 当前色 + 当前笔宽 + 撤销/重做（7 个 44 按钮，无内联色板/笔宽）", async () => {
    const view = await mount({ content: twoPageBody(), readOnly: false });
    const dock = view.container.querySelector('[data-overlay="dock"]');
    expect(dock).not.toBeNull();
    expect(dock!.getAttribute("aria-label")).toBe("手写工具");
    const toolRow = dock!.querySelector('.ink-toolbar[role="group"]');
    expect(toolRow).not.toBeNull();
    const buttons = Array.from(toolRow!.children).filter((el) => el.tagName === "BUTTON");
    expect(buttons.length).toBe(7); // 笔/高亮/橡皮 + 当前色 + 当前笔宽 + 撤销 + 重做
    const separators = Array.from(toolRow!.children).filter((el) => el.classList.contains("ink-toolbar__sep"));
    expect(separators.length).toBe(3);
    expect(toolRow!.querySelectorAll(".ink-color").length).toBe(1);
    expect(toolRow!.querySelectorAll(".ink-width").length).toBe(1);
    expect(toolRow!.querySelector('[aria-label="选择颜色"]')).not.toBeNull();
    expect(toolRow!.querySelector('[aria-label="选择笔宽"]')).not.toBeNull();
    // 工具图标 18（按钮盒仍 44，见 CSS 断言）
    expect(toolRow!.querySelector('[aria-label="画笔"] svg')!.getAttribute("width")).toBe("18");
    // 面板默认关闭
    expect(view.container.querySelector('[data-overlay="palette"]')).toBeNull();
    expect(view.container.querySelector('[data-overlay="widths"]')).toBeNull();

    await view.unmount();
  });

  it("颜色：当前色按钮打开色板（7 色），选色写回并关闭；点外部（pointerdown）也关闭", async () => {
    const view = await mount({ content: twoPageBody(), readOnly: false });
    const trigger = byLabel(view.container, "选择颜色")!;
    const dot = () => (trigger.querySelector("span") as HTMLElement).style.backgroundColor;
    const initial = dot();

    await act(async () => { trigger.click(); });
    const palette = view.container.querySelector('[data-overlay="palette"]');
    expect(palette).not.toBeNull();
    const options = Array.from(palette!.querySelectorAll(".ink-color")) as HTMLButtonElement[];
    expect(options.length).toBe(1 + QUICK_TEXT_COLORS.length);

    await act(async () => { options[1].click(); });
    expect(view.container.querySelector('[data-overlay="palette"]')).toBeNull(); // 选完关闭
    expect(dot()).not.toBe(initial); // 当前色写回

    // 再打开，点外部关闭
    await act(async () => { trigger.click(); });
    expect(view.container.querySelector('[data-overlay="palette"]')).not.toBeNull();
    await act(async () => { document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); });
    expect(view.container.querySelector('[data-overlay="palette"]')).toBeNull();

    await view.unmount();
  });

  it("笔宽：当前笔宽按钮打开 4 档面板，选档写回并关闭", async () => {
    const view = await mount({ content: twoPageBody(), readOnly: false });
    const trigger = byLabel(view.container, "选择笔宽")!;
    const dot = () => trigger.querySelector("span") as HTMLElement;
    const initialWidth = dot().style.width;
    expect(initialWidth).not.toBe("");

    await act(async () => { trigger.click(); });
    const panel = view.container.querySelector('[data-overlay="widths"]');
    expect(panel).not.toBeNull();
    const options = Array.from(panel!.querySelectorAll(".ink-width")) as HTMLButtonElement[];
    expect(options.length).toBe(4);

    await act(async () => { options[2].click(); });
    expect(view.container.querySelector('[data-overlay="widths"]')).toBeNull();
    expect(dot().style.width).not.toBe(initialWidth);

    await view.unmount();
  });

  it("纸张：点纸张立即标脏、500ms 防抖写正文；防抖窗口内 capture 能现取", async () => {
    const content = twoPageBody();
    const onChange = vi.fn();
    const onDirty = vi.fn();
    const captures: Array<() => string | null> = [];
    const view = await mount({
      content,
      readOnly: false,
      onChange,
      onDirty,
      onEditorCapture: (capture) => { if (capture) captures.push(capture); },
    });

    const lined = byText(view.container, "横线")!;
    expect(lined.disabled).toBe(false);
    await act(async () => { lined.click(); });
    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled(); // 还在防抖窗口内

    // 切完纸张立刻点「完成」→ capture 必须现取到最新正文
    const captured = captures[captures.length - 1]();
    expect(captured).not.toBeNull();
    expect(JSON.parse(captured!).pages[0].background).toBe("lined");

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 620)); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onChange.mock.calls[0][0]).pages[0].background).toBe("lined");

    await view.unmount();
  });

  it("编辑态的全局预览同样是悬浮覆盖，面板里的新建页/排序可用", async () => {
    const view = await mount({ content: twoPageBody(), readOnly: false });
    await act(async () => { byLabel(view.container, "全局预览")!.click(); });
    const preview = view.container.querySelector('[data-overlay="preview"]');
    expect(preview).not.toBeNull();
    const strip = preview!.querySelector(".ink-page-strip");
    expect(strip).not.toBeNull();
    expect((strip!.querySelector(".ink-page-strip__add") as HTMLButtonElement).disabled).toBe(false);
    const actions = Array.from(strip!.querySelectorAll(".ink-page-thumb__actions button")) as HTMLButtonElement[];
    expect(actions.filter((button) => !button.disabled).length).toBeGreaterThan(0);

    await view.unmount();
  });
});
