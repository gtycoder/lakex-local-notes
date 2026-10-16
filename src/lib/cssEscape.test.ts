/**
 * `escapeId` 的单一来源 + 兜底行为测试（B1，261016）。
 *
 * 关键判据点：**CSS.escape 不可用时不能抛**——测试环境（node）就没有 `CSS` 全局，
 * 这也是原先三处各写一份 try/catch 的原因；收编后必须保住这条行为。
 */
import { afterEach, describe, expect, it } from "vitest";
import { escapeId } from "./cssEscape.js";

type CssGlobal = { CSS?: unknown };
const realCss = (globalThis as CssGlobal).CSS;

afterEach(() => {
  (globalThis as CssGlobal).CSS = realCss;
});

describe("escapeId（单一来源 + 兜底）", () => {
  it("CSS.escape 可用时直接委托（不重复实现转义规则）", () => {
    const calls: string[] = [];
    (globalThis as CssGlobal).CSS = { escape: (value: string) => { calls.push(value); return "delegated:" + value; } };
    expect(escapeId('a"b')).toBe('delegated:a"b');
    expect(calls).toEqual(['a"b']);
  });

  it("CSS 不可用时退回「只转义双引号与反斜杠」（不抛）", () => {
    (globalThis as CssGlobal).CSS = undefined;
    expect(escapeId('a"b')).toBe('a\\"b');
    expect(escapeId("a\\b")).toBe("a\\\\b");
    expect(escapeId("plain-id-1")).toBe("plain-id-1");
  });

  it("CSS.escape 抛错时同样走兜底（异常不泄漏给调用点）", () => {
    (globalThis as CssGlobal).CSS = { escape: () => { throw new Error("boom"); } };
    expect(escapeId('x"y')).toBe('x\\"y');
  });
});
