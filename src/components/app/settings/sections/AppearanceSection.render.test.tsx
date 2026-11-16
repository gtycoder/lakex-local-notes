// @vitest-environment jsdom
/**
 * 外观 → 主题：261116 用户点单把「4 个分段按钮」改成**下拉**（AdaptiveSelect）。
 * 两条路径都要覆盖（与 nativeSelectRollout.render.test.tsx 同一套桩）：
 * ① 支持 base-select ⇒ 原生 <select>，值/选项 = LAKE_THEMES 的 id/label，改档写回 theme；
 * ② 不支持 ⇒ 同位置退回自研 Select（按钮触发器 + 弹层选项）；
 * ③ 旧的 4 个分段按钮（.ln-segment__item）不再存在。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSection } from "./AppearanceSection";
import type { SettingsPanelContext } from "../useSettingsPanelScope";
import { DEFAULT_SETTINGS } from "../../../../lib/settings";
import { LAKE_THEMES } from "../../../../lib/themes";

let baseSelectEnabled = false;

beforeEach(() => {
  baseSelectEnabled = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom 没有 base-select：用桩精确控制能力探测（NativeSelect 的唯一判据）。
  vi.stubGlobal("CSS", { supports: () => baseSelectEnabled });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

function makeCtx(theme: string) {
  const onChange = vi.fn();
  const ctx = { onChange, settings: { ...DEFAULT_SETTINGS, theme } } as unknown as SettingsPanelContext;
  return { ctx, onChange };
}

function mount(ctx: SettingsPanelContext): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<AppearanceSection c={ctx} />));
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

describe("外观 · 主题（261116：分段按钮 → 下拉）", () => {
  it("原生路径：select 的选项 = LAKE_THEMES（id/名称），改档写回 theme id", () => {
    baseSelectEnabled = true;
    const { ctx, onChange } = makeCtx("light");
    const { host, root } = mount(ctx);
    try {
      expect(host.querySelector(".ln-segment__item")).toBeNull();
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="主题"]');
      expect(select).not.toBeNull();
      expect(select!.className).toContain("ln-select--native");
      expect(select!.className).toContain("settings-select");
      expect(select!.value).toBe("light");
      expect([...select!.options].map((option) => option.value)).toEqual(LAKE_THEMES.map((theme) => theme.id));
      expect([...select!.options].map((option) => option.textContent)).toEqual(LAKE_THEMES.map((theme) => theme.label));
      setSelectValue(select!, "chat");
      expect(onChange).toHaveBeenCalledWith({ theme: "chat" });
    } finally { unmount(host, root); }
  });

  it("降级路径：自研 Select（按钮触发器）仍能选到「清爽（浅色）」并写回 theme", () => {
    baseSelectEnabled = false;
    const { ctx, onChange } = makeCtx("dark");
    const { host, root } = mount(ctx);
    try {
      expect(host.querySelector("select")).toBeNull();
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="主题"]');
      expect(trigger).not.toBeNull();
      expect(trigger!.className).toContain("ln-select");
      expect(trigger!.className).not.toContain("ln-select--native");
      expect(trigger!.textContent).toContain("深色");

      act(() => { trigger!.click(); });
      const listbox = document.querySelector<HTMLElement>('[role="listbox"][aria-label="主题"]');
      expect(listbox).not.toBeNull();
      const option = [...(listbox!.querySelectorAll<HTMLElement>('[role="option"]'))]
        .find((el) => (el.textContent ?? "").includes("清爽"));
      expect(option).toBeTruthy();
      act(() => { option!.click(); });
      expect(onChange).toHaveBeenCalledWith({ theme: "chat" });
    } finally { unmount(host, root); }
  });

  it("新增主题零改动：下拉选项由 LAKE_THEMES 驱动（不是写死 4 项）", () => {
    baseSelectEnabled = true;
    const { ctx } = makeCtx("light");
    const { host, root } = mount(ctx);
    try {
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="主题"]')!;
      expect(select.options.length).toBe(LAKE_THEMES.length);
      expect(LAKE_THEMES.length).toBeGreaterThanOrEqual(4);
    } finally { unmount(host, root); }
  });
});
