// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NumField as DesktopNumField } from "../components/ui/settingsPrimitives";
import { NumField as MobileNumField } from "../mobile/ui/settingsPrimitives";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
for (const [platform, NumField] of [["desktop", DesktopNumField], ["mobile", MobileNumField]] as const) {
  describe(platform + " 数字设置提交", () => {
    const render = (onSave: (n: number) => void, value = .7) => {
      act(() => root.render(createElement(NumField, { label: "温度", step: "any", value, min: 0, max: 2, floor: 0, fallback: .7, onSave })));
      const input = host.querySelector("input")!; act(() => input.focus()); return input;
    };
    const enter = (input: HTMLInputElement, text: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    it("合法0、小数和连续输入只在失焦时提交", () => {
      const save = vi.fn(), input = render(save); enter(input, "0"); expect(save).not.toHaveBeenCalled(); act(() => input.blur()); expect(save).toHaveBeenLastCalledWith(0);
      act(() => input.focus()); enter(input, "0.1"); enter(input, "0.15"); expect(save).toHaveBeenCalledTimes(1); act(() => input.blur()); expect(save).toHaveBeenLastCalledWith(.15); expect(input.validity.valid).toBe(true); expect(save).toHaveBeenCalledTimes(2);
    });
    it("空值恢复默认，超过范围时夹到上下限", () => {
      const save = vi.fn(), input = render(save, 1); enter(input, ""); act(() => input.blur()); expect(save).toHaveBeenLastCalledWith(.7); expect(input.value).toBe("0.7");
      act(() => input.focus()); enter(input, "99"); act(() => input.blur()); expect(save).toHaveBeenLastCalledWith(2);
      act(() => input.focus()); enter(input, "-1"); act(() => input.blur()); expect(save).toHaveBeenLastCalledWith(0);
    });
    it("Esc撤回草稿，Enter只提交一次，外部值更新反映到字段", () => {
      const save = vi.fn(), input = render(save); enter(input, "1.5"); act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); expect(input.value).toBe("0.7"); act(() => input.blur()); expect(save).not.toHaveBeenCalled();
      act(() => input.focus()); enter(input, "1.5"); act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))); expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledWith(1.5); render(save, 2); expect(input.value).toBe("2");
    });
  });
}
