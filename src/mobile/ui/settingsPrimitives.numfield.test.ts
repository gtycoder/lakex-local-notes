// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NumField } from "./settingsPrimitives";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(onSave: (n: number) => void, value = 15): HTMLInputElement {
  act(() => root.render(createElement(NumField, {
    label: "自动快照间隔", value, min: 0, max: 1440, floor: 0, fallback: 15, onSave,
  })));
  return host.querySelector("input")!;
}

describe("NumField draft + commit", () => {
  it("输入 0 不立即写设置，失焦后作为合法值提交", () => {
    const onSave = vi.fn();
    const input = render(onSave);
    act(() => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSave).not.toHaveBeenCalled();
    act(() => input.blur());
    expect(onSave).toHaveBeenCalledWith(0);
  });

  it("失焦时统一 clamp，连续击键不产生多次保存", () => {
    const onSave = vi.fn();
    const input = render(onSave);
    act(() => {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "99999");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onSave).not.toHaveBeenCalled();
    act(() => input.blur());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(1440);
  });
});
