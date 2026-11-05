// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PickerSheet } from "./PickerSheet";
import { consumeBack } from "./backStack";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("选择器保留标题式头部，共用焦点/滚动机制、键盘选项与返回键", () => {
  const change = vi.fn(); act(() => root.render(createElement(PickerSheet, { label: "数量", value: 2, options: [{ value: 1, label: "一" }, { value: 2, label: "二" }], onChange: change })));
  const trigger = host.querySelector<HTMLButtonElement>(".mb-select")!; act(() => { trigger.focus(); trigger.click(); });
  expect(document.querySelector(".mb-sheet__head button")).toBeNull(); expect(document.activeElement?.getAttribute("aria-selected")).toBe("true"); expect(document.body.style.overflow).toBe("hidden");
  act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true })));
  expect(document.activeElement?.textContent).toBe("一"); act(() => (document.activeElement as HTMLButtonElement).click());
  expect(change).toHaveBeenCalledWith(1); expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).toBe("");
  act(() => trigger.click()); act(() => { expect(consumeBack()).toBe(true); }); expect(host.querySelector(".mb-sheet")).toBeNull(); expect(document.activeElement).toBe(trigger);
});
