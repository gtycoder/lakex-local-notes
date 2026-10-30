// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBitableDateField } from "./MobileBitableDateField";
import { localDateString } from "../../core/bitableDoc";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const renderField = (value: string, onChange: (next: string) => void) => {
  act(() => root.render(createElement(MobileBitableDateField, { value, onChange, ariaLabel: "日期" })));
};
const btn = (text: string) => [...host.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === text) as HTMLButtonElement | undefined;

describe("MobileBitableDateField（自有日期选择，不用系统弹窗）", () => {
  it("空值时显示占位；点触发器打开自有月历，选日期后确定回写", () => {
    const onChange = vi.fn();
    renderField("", onChange);
    const trigger = host.querySelector<HTMLButtonElement>("button.mbt-date-trigger")!;
    expect(trigger.textContent).toContain("选择日期");
    act(() => trigger.click());
    // 自有月历：42 格 + 月份标题 + 今天/清除/确定
    expect(host.querySelectorAll(".mbt-calendar-day").length).toBe(42);
    expect(host.textContent).toContain("选择日期");
    expect(btn("确定")).toBeTruthy();
    const today = localDateString(new Date());
    const todayCell = [...host.querySelectorAll<HTMLButtonElement>(".mbt-calendar-day")].find((cell) => cell.getAttribute("aria-label") === today)!;
    act(() => todayCell.click());
    act(() => btn("确定")!.click());
    expect(onChange).toHaveBeenCalledWith(today);
    // 关闭后不再有月历
    expect(host.querySelector(".mbt-calendar-grid")).toBeNull();
  });

  it("已选值显示在触发器上；清除回写空串", () => {
    const onChange = vi.fn();
    renderField("2026-06-09", onChange);
    expect(host.querySelector("button.mbt-date-trigger")!.textContent).toContain("2026-06-09");
    act(() => host.querySelector<HTMLButtonElement>("button.mbt-date-trigger")!.click());
    act(() => btn("清除")!.click());
    expect(onChange).toHaveBeenCalledWith("");
  });
});
