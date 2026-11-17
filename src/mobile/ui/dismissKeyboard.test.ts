// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { activeIsTextInput, dismissKeyboard, dismissKeyboardOnPointerDown } from "./dismissKeyboard";
import { consumeBack, pushBackHandler } from "./backStack";

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

  it("返回键优先收键盘（261117 用户点单，Android 惯例）：焦点在输入上 ⇒ 只收键盘不触发返回", () => {
    const el = input();
    el.focus();
    expect(activeIsTextInput()).toBe(true);
    let returned = false;
    const off = pushBackHandler(() => { returned = true; return true; });
    expect(consumeBack()).toBe(true);
    expect(returned, "收键盘那一次不许触发返回动作").toBe(false);
    expect(document.activeElement).not.toBe(el);
    // 焦点已离开输入 ⇒ 下一次返回才轮到栈顶
    expect(consumeBack()).toBe(true);
    expect(returned).toBe(true);
    off();
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
