// @vitest-environment jsdom
/**
 * 共享拦截器逻辑的单测（261115 A04）：纯判据 + 安装/卸载契约。
 * 桌面/移动的行为宿主用例分别在 NativeTitleTips.render.test.tsx / MobileTitleTips.render.test.tsx。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  LONG_PRESS_MOVE_TOLERANCE,
  hasOtherAccessibleName,
  installNativeTitleTips,
  isLongPressMoved,
} from "./nativeTitleTip";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

function makeElement(attrs: Record<string, string>, text = ""): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  if (text) el.textContent = text;
  document.body.appendChild(el);
  return el;
}

describe("hasOtherAccessibleName（摘 title 前的判据）", () => {
  it("aria-label 非空 / aria-labelledby 指向有文本 / 自身文本非空都算有名字", () => {
    expect(hasOtherAccessibleName(makeElement({ "aria-label": "保存" }))).toBe(true);
    expect(hasOtherAccessibleName(makeElement({ "aria-label": "   " }))).toBe(false);

    const label = document.createElement("span");
    label.id = "tip-label-target";
    label.textContent = "外部标签";
    document.body.appendChild(label);
    expect(hasOtherAccessibleName(makeElement({ "aria-labelledby": "tip-label-target" }))).toBe(true);
    expect(hasOtherAccessibleName(makeElement({ "aria-labelledby": "tip-label-missing" }))).toBe(false);

    expect(hasOtherAccessibleName(makeElement({}, "可见文字"))).toBe(true);
    expect(hasOtherAccessibleName(makeElement({}))).toBe(false); // 只有 title 一个名字
  });
});

describe("isLongPressMoved（长按位移阈值）", () => {
  it("恰好 8px 不取消，超过 1px 即取消（含对角）", () => {
    expect(isLongPressMoved({ x: 0, y: 0 }, { x: LONG_PRESS_MOVE_TOLERANCE, y: 0 })).toBe(false);
    expect(isLongPressMoved({ x: 0, y: 0 }, { x: LONG_PRESS_MOVE_TOLERANCE + 1, y: 0 })).toBe(true);
    expect(isLongPressMoved({ x: 10, y: 10 }, { x: 16, y: 18 })).toBe(true); // 10 > 8
  });
});

describe("installNativeTitleTips（安装/卸载契约）", () => {
  it("按传入 id/class 建单例 tip，cleanup 删除 tip 并移除监听", () => {
    const anchor = makeElement({ title: "提示", "aria-label": "提示" });
    cleanup = installNativeTitleTips({
      id: "lib-test-tip",
      tipClassName: "x-tip",
      extraClassName: "y-tip",
      wideClassName: "x-tip--wide",
    });
    const tip = document.getElementById("lib-test-tip");
    expect(tip).not.toBeNull();
    expect(tip?.className).toBe("x-tip y-tip");
    expect(tip?.getAttribute("role")).toBe("tooltip");
    expect(document.querySelectorAll("#lib-test-tip")).toHaveLength(1);

    cleanup();
    cleanup = null;
    expect(document.getElementById("lib-test-tip")).toBeNull();
    expect(anchor.getAttribute("title")).toBe("提示");
    expect(anchor.hasAttribute("aria-describedby")).toBe(false);
  });
});
