import { describe, expect, it } from "vitest";

import { isImeConfirming } from "./ime";

/**
 * A01 护栏（261115）：IME 组合态判据。
 *
 * 为什么单独测：33+2 处输入框的 Enter 提交都依赖这一个判据；
 * 它一旦回归（例如有人把 keyCode 229 兜底删掉），故障只会在中文输入法 + 真机上复现，
 * 单测是唯一便宜的防线。
 */
describe("isImeConfirming（IME 组合态）", () => {
  it("isComposing=true ⇒ 组合中（不得提交）", () => {
    expect(isImeConfirming({ isComposing: true })).toBe(true);
  });

  it("isComposing=false ⇒ 普通回车（可以提交）", () => {
    expect(isImeConfirming({ isComposing: false })).toBe(false);
  });

  it("旧 WebView 的 keyCode 229 ⇒ 组合中", () => {
    expect(isImeConfirming({ keyCode: 229 })).toBe(true);
  });

  it("keyCode 13（普通回车）不是判据", () => {
    expect(isImeConfirming({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it("缺字段/空事件 ⇒ 不误判为组合中", () => {
    expect(isImeConfirming({})).toBe(false);
    expect(isImeConfirming(null)).toBe(false);
    expect(isImeConfirming(undefined)).toBe(false);
  });
});
