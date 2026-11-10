// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarPanel } from "./CalendarPanel";
import { localDateString } from "../../core/bitableDoc";

/**
 * 月历面板（261110 第二批）：上/下月仍是 ln-iconbtn--compact；页脚「今天/清除」迁到 ln-btn--link + compact。
 */
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("CalendarPanel（261110 第二批）", () => {
  it("页脚按钮 = ln-btn--link + compact；今天回灌今天、清除回调 onClear", () => {
    const onPick = vi.fn();
    const onClear = vi.fn();
    act(() => root.render(createElement(CalendarPanel, { value: "2026-11-10", onPick, onClear })));
    const today = [...document.body.querySelectorAll<HTMLButtonElement>(".ln-calendar__foot button")].find((b) => (b.textContent ?? "") === "今天")!;
    const clear = [...document.body.querySelectorAll<HTMLButtonElement>(".ln-calendar__foot button")].find((b) => (b.textContent ?? "") === "清除")!;
    for (const btn of [today, clear]) {
      const classes = (btn.className || "").split(/\s+/).filter(Boolean);
      expect(classes.every((name) => name.startsWith("ln-"))).toBe(true);
      expect(btn.className).toContain("ln-btn--link");
      expect(btn.className).toContain("ln-btn--compact");
    }
    act(() => today.click());
    expect(onPick).toHaveBeenCalledWith(localDateString(new Date()));
    act(() => clear.click());
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("不传 onClear 时不渲染「清除」", () => {
    act(() => root.render(createElement(CalendarPanel, { value: "", onPick: vi.fn() })));
    expect([...document.body.querySelectorAll(".ln-calendar__foot button")].some((b) => (b.textContent ?? "") === "清除")).toBe(false);
  });
});
