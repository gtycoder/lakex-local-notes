// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activeIsTextInput, dismissKeyboard, dismissKeyboardOnPointerDown, softKeyboardVisible } from "./dismissKeyboard";
import { consumeBack, consumeBackOverlay, pushBackHandler } from "./backStack";
import { resetShellHeight } from "../hooks/viewportShell";

/** 视口高 = 键盘状态的唯一输入（adjustResize：键盘把 WebView 压矮）。 */
function setViewport(value: number): void {
  Object.defineProperty(window, "innerHeight", { configurable: true, value });
}

beforeEach(() => { resetShellHeight(); setViewport(768); });
afterEach(() => { document.body.innerHTML = ""; resetShellHeight(); });

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

describe("softKeyboardVisible（键盘本身可见性，261119 capture 退出链）", () => {
  it("「焦点在输入上」≠「键盘开着」：Android 收输入法不 blur ⇒ 焦点还在、键盘已收要判得出来", () => {
    setViewport(768);
    expect(softKeyboardVisible(), "键盘收起态先建立稳定外壳高基线").toBe(false);
    const el = input();
    el.focus();
    expect(activeIsTextInput()).toBe(true);
    expect(softKeyboardVisible(), "焦点还在但键盘已收 —— 不许再判成「有键盘可收」").toBe(false);
  });

  it("adjustResize：键盘把 innerHeight 压矮 ⇒ 可见；收起后回落 ⇒ 不可见", () => {
    setViewport(768);
    expect(softKeyboardVisible()).toBe(false);
    setViewport(530);
    expect(softKeyboardVisible()).toBe(true);
    setViewport(768);
    expect(softKeyboardVisible()).toBe(false);
  });

  it("edge-to-edge：innerHeight 不缩、visualViewport 变矮的差值同样算可见", () => {
    setViewport(768);
    expect(softKeyboardVisible()).toBe(false);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: { height: 456, offsetTop: 0 } });
    try {
      expect(softKeyboardVisible()).toBe(true);
    } finally {
      Reflect.deleteProperty(window, "visualViewport");
    }
    expect(softKeyboardVisible()).toBe(false);
  });
});

describe("consumeBackOverlay（只交浮层，不做收键盘判定）", () => {
  it("焦点在输入上也照样交浮层：不会被「再收一次键盘」吞掉", () => {
    const el = input();
    el.focus();
    let returned = false;
    const off = pushBackHandler(() => { returned = true; return true; });
    expect(consumeBackOverlay()).toBe(true);
    expect(returned).toBe(true);
    expect(document.activeElement, "不许顺手 blur（收键盘判定留在 consumeBack）").toBe(el);
    off();
    expect(consumeBackOverlay()).toBe(false);
  });
});
