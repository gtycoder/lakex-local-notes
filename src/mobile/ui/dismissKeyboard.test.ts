// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { dismissKeyboard, dismissKeyboardOnPointerDown } from "./dismissKeyboard";

afterEach(() => { document.body.innerHTML = ""; });

function input(): HTMLInputElement {
  const el = document.createElement("input");
  document.body.append(el);
  return el;
}

describe("dismissKeyboard（移动端收键盘口径）", () => {
  it("聚焦输入框后 dismiss 会 blur；没有可编辑元素时无副作用", () => {
    const el = input();
    el.focus();
    expect(document.activeElement).toBe(el);
    dismissKeyboard();
    expect(document.activeElement).not.toBe(el);
    expect(() => dismissKeyboard()).not.toThrow();
  });

  it("点输入控件本身不收键盘；点空白处收", () => {
    const el = input();
    el.focus();
    dismissKeyboardOnPointerDown({ target: el });
    expect(document.activeElement).toBe(el);
    const blank = document.createElement("div");
    document.body.append(blank);
    dismissKeyboardOnPointerDown({ target: blank });
    expect(document.activeElement).not.toBe(el);
  });

  it("textarea 同样适用；点 select 不误收", () => {
    const area = document.createElement("textarea");
    document.body.append(area);
    area.focus();
    dismissKeyboardOnPointerDown({ target: area });
    expect(document.activeElement).toBe(area);
    const select = document.createElement("select");
    document.body.append(select);
    dismissKeyboardOnPointerDown({ target: select });
    expect(document.activeElement).toBe(area);
  });
});
