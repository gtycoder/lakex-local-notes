// @vitest-environment jsdom
/**
 * 「页面」面板（261104 二十六批二轮）：左侧悬浮覆盖 + 两视图（缩略图 / 大纲）+ 头部跳页 + 可拖宽。
 * 缩略图 = 纯预览 + 页编辑（只留删除）；大纲 = 筛选（全部/批注/页签）+ 查找；页签编辑不在这里（走底栏按钮）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInkDoc, type InkPage } from "../../core/inkDoc";
import {
  InkPagesPanel, INK_PAGES_PANEL_WIDTH_DEFAULT, INK_PAGES_PANEL_WIDTH_KEY, INK_PAGES_PANEL_WIDTH_MAX, INK_PAGES_PANEL_WIDTH_MIN,
  clampPagesPanelWidth, dropTargetIndex, readPagesPanelWidth, writePagesPanelWidth, type InkPagesPanelProps,
} from "./InkPagesPanel";

function pagesFixture(): InkPage[] {
  const doc = createInkDoc("p1");
  const base = doc.pages[0];
  return [
    { ...base, id: "p1", strokes: [{ id: "s1", tool: "pen", color: "#262626", width: 2, points: [{ x: 10, y: 10, pressure: 0.5 }, { x: 20, y: 20, pressure: 0.5 }] }] },
    { ...base, id: "p2", strokes: [], note: "第三章：交易系统" },
    { ...base, id: "p3", strokes: [], note: "" },
  ];
}

interface Mounted { container: HTMLElement; unmount: () => Promise<void> }

async function mount(props: Partial<InkPagesPanelProps> = {}): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const full: InkPagesPanelProps = {
    open: true,
    view: "thumbs",
    onViewChange: () => undefined,
    pages: pagesFixture(),
    currentPageId: "p1",
    readOnly: false,
    pendingDeleteId: null,
    onJump: () => undefined,
    onAdd: () => undefined,
    onReorder: () => undefined,
    onRequestDelete: () => undefined,
    onConfirmDelete: () => undefined,
    onCancelDelete: () => undefined,
    onClose: () => undefined,
    ...props,
  };
  await act(async () => { root.render(<InkPagesPanel {...full} />); });
  return { container, unmount: async () => { await act(async () => root.unmount()); container.remove(); } };
}

const byLabel = (root: ParentNode, label: string) => root.querySelector('[aria-label="' + label + '"]') as HTMLElement | null;
const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("手写板「页面」面板", () => {
  it("缩略图视图 = 纯预览 + 页编辑：每页一格、当前页高亮、页签角标、只留删除（无前移/后移/筛选/摘要/页签编辑）", async () => {
    const view = await mount();
    expect(view.container.querySelectorAll(".ink-pages-panel__cell").length).toBe(3);
    expect(view.container.querySelectorAll(".ink-pages-panel__cell-tab").length).toBe(2);
    expect(view.container.querySelector(".ink-pages-panel__cell.is-current")).not.toBeNull();
    expect(byLabel(view.container, "新建页")).not.toBeNull();
    // 只留删除；前移/后移已删除
    expect(byLabel(view.container, "删除第 2 页")).not.toBeNull();
    expect(byLabel(view.container, "第 2 页前移")).toBeNull();
    expect(byLabel(view.container, "第 2 页后移")).toBeNull();
    // 缩略图视图不渲染筛选/摘要/查找/页签编辑
    expect(view.container.querySelector(".ink-pages-panel__chips")).toBeNull();
    expect(view.container.querySelector("[data-ink-pages-summary]")).toBeNull();
    expect(view.container.querySelector(".ink-pages-panel__search")).toBeNull();
    expect(view.container.querySelector(".ink-pages-panel__note")).toBeNull();
    await view.unmount();
  });

  it("跳页在头部（与视图 tab 同行）：输入 2 回车 ⇒ 跳第 2 页且面板不关", async () => {
    const onJump = vi.fn();
    const view = await mount({ onJump });
    const head = view.container.querySelector(".ink-pages-panel__head")!;
    const input = head.querySelector(".ink-pages-panel__jump-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(onJump).toHaveBeenCalledWith("p2");
    expect(view.container.querySelector(".ink-pages-panel")).not.toBeNull();
    await view.unmount();
  });

  it("大纲视图：筛选 全部/批注/页签 + 摘要 + 查找（无页签编辑）", async () => {
    const view = await mount({ view: "list" });
    expect(view.container.querySelectorAll(".ink-pages-panel__row").length).toBe(3);
    expect(view.container.querySelector("[data-ink-pages-summary]")!.textContent).toContain("1 页有批注，2 个页签");
    expect(view.container.querySelector(".ink-pages-panel__note")).toBeNull();
    const chip = (label: string) => Array.from(view.container.querySelectorAll(".ink-pages-panel__chip")).find((el) => el.textContent === label)!;
    await click(chip("批注"));
    expect(view.container.querySelectorAll(".ink-pages-panel__row").length).toBe(1);
    await click(chip("页签"));
    expect(view.container.querySelectorAll(".ink-pages-panel__row").length).toBe(2);
    await click(chip("全部"));
    const search = view.container.querySelector(".ink-pages-panel__search-input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "交易");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(view.container.querySelectorAll(".ink-pages-panel__row").length).toBe(1);
    await view.unmount();
  });

  it("最小宽度 = 顶栏一行 + 2 列预览向上取整；拖拽落点换算", () => {
    // 320：扣掉两侧 padding(10*2) 与列间距(10) 后仍能放两列 140
    expect(INK_PAGES_PANEL_WIDTH_MIN).toBe(320);
    expect(INK_PAGES_PANEL_WIDTH_MIN - 10 * 2 - 10).toBeGreaterThanOrEqual(132 * 2);
    // 落点：slot = 悬停格插入位置（0..total），返回移除源项后的目标下标
    expect(dropTargetIndex(0, 3, 5)).toBe(2);
    expect(dropTargetIndex(3, 0, 5)).toBe(0);
    expect(dropTargetIndex(2, 2, 5)).toBe(2);
    expect(dropTargetIndex(0, 99, 5)).toBe(4);
    expect(dropTargetIndex(4, -1, 5)).toBe(0);
  });

  it("拖宽：默认宽度 + 夹取 + 设备本地记忆（纯函数，坏值回默认）", () => {
    expect(INK_PAGES_PANEL_WIDTH_DEFAULT).toBe(360);
    expect(clampPagesPanelWidth(100, 1280)).toBe(INK_PAGES_PANEL_WIDTH_MIN);
    expect(clampPagesPanelWidth(9999, 1280)).toBe(INK_PAGES_PANEL_WIDTH_MAX);
    expect(clampPagesPanelWidth(400, 420)).toBe(340); // 视口太窄时留 80px 给画布
    expect(clampPagesPanelWidth(Number.NaN, 1280)).toBe(INK_PAGES_PANEL_WIDTH_DEFAULT);
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    writePagesPanelWidth(420, storage);
    expect(store.get(INK_PAGES_PANEL_WIDTH_KEY)).toBe("420");
    expect(readPagesPanelWidth(storage)).toBe(420);
    store.set(INK_PAGES_PANEL_WIDTH_KEY, "坏值");
    expect(readPagesPanelWidth(storage)).toBe(INK_PAGES_PANEL_WIDTH_DEFAULT);
  });

  it("缩略图长按 300ms 进入拖拽（松手不换位则不触发 onReorder）", async () => {
    const onReorder = vi.fn();
    const view = await mount({ onReorder });
    const cell = view.container.querySelector('.ink-pages-panel__cell[data-page-id="p1"]') as HTMLElement;
    await act(async () => {
      const down = new MouseEvent("pointerdown", { bubbles: true, clientX: 120, clientY: 160 });
      Object.defineProperty(down, "pointerId", { value: 11 });
      cell.dispatchEvent(down);
    });
    expect(view.container.querySelector(".ink-pages-panel__cell.is-dragging")).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 340)); });
    expect(view.container.querySelector(".ink-pages-panel__cell.is-dragging")).not.toBeNull();
    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })); });
    expect(onReorder).not.toHaveBeenCalled();
    expect(view.container.querySelector(".ink-pages-panel__cell.is-dragging")).toBeNull();
    await view.unmount();
  });

  it("长按到点后随后的 click 被吞掉（进入拖拽，不跳页）", async () => {
    const onJump = vi.fn();
    const view = await mount({ onJump });
    const cell = view.container.querySelector('.ink-pages-panel__cell[data-page-id="p1"]') as HTMLElement;
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 120, clientY: 160 }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 340)); });
    expect(view.container.querySelector(".ink-pages-panel__cell.is-dragging")).not.toBeNull();
    // 长按触发后浏览器仍会派发一次 click（手指抬起）⇒ 必须被吞掉，不能跳页
    await act(async () => {
      view.container.querySelector('[aria-label="打开第 1 页"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onJump).not.toHaveBeenCalled();
    await act(async () => { window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })); });
    await view.unmount();
  });

  it("长按未到点前移动 > 8px ⇒ 取消（不进拖拽，随后的 click 照常跳页）", async () => {
    const onJump = vi.fn();
    const view = await mount({ onJump });
    const cell = view.container.querySelector('.ink-pages-panel__cell[data-page-id="p2"]') as HTMLElement;
    await act(async () => {
      cell.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 120, clientY: 160 }));
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 150, clientY: 160 }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 340)); });
    expect(view.container.querySelector(".ink-pages-panel__cell.is-dragging")).toBeNull();
    await act(async () => {
      view.container.querySelector('[aria-label="打开第 2 页"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onJump).toHaveBeenCalledWith("p2");
    await view.unmount();
  });

  it("面板有右侧拖宽手柄；宽度落成内联 style", async () => {
    const view = await mount();
    const handle = byLabel(view.container, "拖动调整页面面板宽度");
    expect(handle).not.toBeNull();
    expect(handle!.getAttribute("role")).toBe("separator");
    const panel = view.container.querySelector(".ink-pages-panel") as HTMLElement;
    expect(panel.style.width).toMatch(/^\d+px$/);
    await view.unmount();
  });

  it("只读：删除/新建禁用，跳页仍可用", async () => {
    const onJump = vi.fn();
    const view = await mount({ readOnly: true, onJump });
    await click(view.container.querySelector('[aria-label="打开第 2 页"]'));
    expect(onJump).toHaveBeenCalledWith("p2");
    expect((byLabel(view.container, "新建页") as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel(view.container, "删除第 2 页") as HTMLButtonElement).disabled).toBe(true);
    await view.unmount();
  });

  it("关闭：✕ 与 Esc 都走 onClose", async () => {
    const onClose = vi.fn();
    const view = await mount({ view: "list", onClose });
    await click(view.container.querySelector(".ink-pages-panel__close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(onClose).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});
