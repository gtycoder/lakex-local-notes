// @vitest-environment jsdom
/**
 * 多选模式 React 接线 + 三个原语组件（261106 task-82）：
 * 顶部栏（取消 / 已选 N / 全选↔全不选）、行复选框、底部操作条（动作回调）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Paperclip, Trash } from "lucide-react";

import { useSelectionMode, type SelectionApi } from "./useSelectionMode";
import { SelectionActionBar } from "./SelectionActionBar";
import { SelectionCheckbox } from "./SelectionCheckbox";
import { SelectionTopBar } from "./SelectionTopBar";

let host: HTMLDivElement;
let root: Root;
let api: SelectionApi;
const ALL = ["a", "b", "c"];

function Harness({ ids }: { ids: readonly string[] }): null {
  api = useSelectionMode(ids);
  return null;
}

const renderHarness = async (ids: readonly string[] = ALL): Promise<void> => {
  await act(async () => { root.render(createElement(Harness, { ids })); });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useSelectionMode", () => {
  it("长按进入带首行 id；点行切换；全选/全不选；退出", async () => {
    await renderHarness();
    expect(api.active).toBe(false);
    act(() => api.enter("b"));
    expect(api.active).toBe(true);
    expect(api.ids).toEqual(["b"]);
    act(() => api.toggle("a"));
    expect(api.ids).toEqual(["b", "a"]);
    act(() => api.toggleAll());
    expect(api.ids).toEqual(["a", "b", "c"]);
    expect(api.allSelected).toBe(true);
    act(() => api.toggleAll());
    expect(api.ids).toEqual([]);
    expect(api.active).toBe(true);
    act(() => api.exit());
    expect(api.active).toBe(false);
    expect(api.count).toBe(0);
  });

  it("可见列表变化后自动剪掉失效 id（回收站恢复/删除、筛选切换）", async () => {
    await renderHarness();
    act(() => api.enter(null));
    act(() => api.toggle("a"));
    act(() => api.toggle("b"));
    expect(api.ids).toEqual(["a", "b"]);
    await renderHarness(["a"]);
    expect(api.ids).toEqual(["a"]);
    await renderHarness([]);
    expect(api.ids).toEqual([]);
  });
});

describe("多选原语组件", () => {
  const mount = async (element: React.ReactElement): Promise<void> => {
    await act(async () => { root.render(element); });
  };

  it("顶部栏：取消 / 已选 N / 全选（全选后变全不选），44 命中走 v2 选择顶栏", async () => {
    const onCancel = vi.fn();
    const onToggleAll = vi.fn();
    await mount(createElement(SelectionTopBar, { count: 2, allSelected: false, onCancel, onToggleAll }));
    const bar = host.querySelector('[role="toolbar"][aria-label="多选操作"]')!;
    expect(bar.className).toContain("mb-sel-topbar");
    expect(bar.textContent).toContain("已选 2");
    const buttons = [...bar.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["取消", "全选"]);
    // v2（261107）：选择顶栏不再复用 .mb-btn（会带底色/胶囊），命中 44 由 .mb-sel-topbar__btn 的 min-width/min-height 提供。
    for (const b of buttons) expect(b.className).toContain("mb-sel-topbar__btn");
    await act(async () => { (buttons[0] as HTMLButtonElement).click(); (buttons[1] as HTMLButtonElement).click(); });
    expect(onCancel).toHaveBeenCalled();
    expect(onToggleAll).toHaveBeenCalled();

    await mount(createElement(SelectionTopBar, { count: 3, allSelected: true, onCancel, onToggleAll }));
    expect([...host.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["取消", "全不选"]);
  });

  it("复选框：未选 Square / 选中 Check，均 44 命中盒、aria-hidden（语义在行上）", async () => {
    await mount(createElement(SelectionCheckbox, { checked: false }));
    let box = host.querySelector<HTMLElement>("[data-selection-checkbox]")!;
    expect(box.getAttribute("data-selection-checkbox")).toBe("off");
    expect(box.className).toContain("mb-iconbtn");
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.querySelector("svg")).not.toBeNull();
    await mount(createElement(SelectionCheckbox, { checked: true }));
    box = host.querySelector<HTMLElement>("[data-selection-checkbox]")!;
    expect(box.getAttribute("data-selection-checkbox")).toBe("on");
    expect(box.className).toContain("is-checked");
  });

  it("底部操作条：浮动玻璃条 + 等分动作格，点击回调 id；fixed 变体带 is-fixed", async () => {
    const onAction = vi.fn();
    await mount(createElement(SelectionActionBar, {
      actions: [
        { id: "tag", label: "打标签", icon: Paperclip },
        { id: "delete", label: "删除", icon: Trash, danger: true },
      ],
      onAction,
      fixed: true,
      hint: "1 项失败",
    }));
    const bar = host.querySelector('[role="group"][aria-label="批量操作"]')!;
    expect(bar.className).toContain("mb-sel-actions");
    expect(bar.className).toContain("is-fixed");
    expect(bar.textContent).toContain("1 项失败");
    const buttons = [...bar.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(["打标签", "删除"]);
    for (const b of buttons) expect(b.className).toContain("mb-sel-act");
    expect(buttons[1].className).toContain("is-danger");
    await act(async () => { (buttons[0] as HTMLButtonElement).click(); });
    expect(onAction).toHaveBeenCalledWith("tag");
  });
});
