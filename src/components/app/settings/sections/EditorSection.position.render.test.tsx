// @vitest-environment jsdom
/**
 * 261117 用户点单：常规（编辑器组）新增「新建文档位置」= 顶部新增 / 末尾追加。
 * 与 AppearanceSection.render.test.tsx 同一套桩：原生 base-select 路径 + 自研 Select 降级路径都要覆盖。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSection } from "./EditorSection";
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { DEFAULT_SETTINGS } from "../../../../lib/settings";

let baseSelectEnabled = false;

beforeEach(() => {
  baseSelectEnabled = true;
  window.localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CSS", { supports: () => baseSelectEnabled });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

function makeCtx(value: "top" | "bottom") {
  const onChange = vi.fn();
  const ctx = { onChange, settings: { ...DEFAULT_SETTINGS, newNotePosition: value } } as unknown as SettingsPanelContext;
  return { ctx, onChange };
}

function mount(ctx: SettingsPanelContext): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<EditorSection c={ctx} />));
  return { host, root };
}
function unmount(host: HTMLDivElement, root: Root): void { act(() => root.unmount()); host.remove(); }
function setSelectValue(select: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("常规 · 新建文档位置（261117）", () => {
  it("原生路径：选项 = 顶部新增 / 末尾追加，值来自设置，改档写回设置", () => {
    const { ctx, onChange } = makeCtx("bottom");
    const { host, root } = mount(ctx);
    try {
      expect(host.textContent).toContain("新建文档位置");
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="新建文档位置"]');
      expect(select).not.toBeNull();
      expect(select!.value).toBe("bottom");
      const options = [...select!.querySelectorAll("option")].map((option) => ({ value: option.value, label: option.textContent }));
      expect(options).toEqual([{ value: "top", label: "顶部新增" }, { value: "bottom", label: "末尾追加" }]);

      setSelectValue(select!, "top");
      expect(onChange).toHaveBeenCalledWith({ newNotePosition: "top" });
    } finally { unmount(host, root); }
  });

  it("降级路径（不支持 base-select）：同位置渲染自研 Select，选择同样写回", () => {
    baseSelectEnabled = false;
    const { ctx, onChange } = makeCtx("top");
    const { host, root } = mount(ctx);
    try {
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="新建文档位置"]');
      expect(trigger).not.toBeNull();
      expect(trigger!.textContent).toContain("顶部新增");
      act(() => { trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
      const items = [...document.querySelectorAll('[role="option"], .ln-select__item, .ln-menu__item')]
        .filter((el) => (el.textContent ?? "").includes("末尾追加"));
      expect(items.length).toBeGreaterThan(0);
      act(() => { (items[0] as HTMLElement).click(); });
      expect(onChange).toHaveBeenCalledWith({ newNotePosition: "bottom" });
    } finally { unmount(host, root); }
  });
});
