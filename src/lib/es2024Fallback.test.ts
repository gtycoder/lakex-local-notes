import { afterEach, describe, expect, it } from "vitest";

import { installEs2024Fallbacks } from "./es2024Fallback";

/**
 * A21 护栏（261115）：老 WebView 的 ES2023/2024 运行时补齐。
 * 源码已经按新 API 写（tsconfig lib=ES2024），所以补齐逻辑一旦坏，老设备是**启动即崩**。
 */
const proto = Array.prototype as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const remove = (name: string) => { saved[name] = proto[name]; delete proto[name]; };
const restore = (name: string) => { if (saved[name] !== undefined) Object.defineProperty(proto, name, { configurable: true, writable: true, value: saved[name] }); };

afterEach(() => {
  restore("toSorted");
  restore("toReversed");
});

describe("installEs2024Fallbacks", () => {
  it("缺 toSorted/toReversed 时补齐，且语义与原生一致（不就地改）", () => {
    remove("toSorted");
    remove("toReversed");
    expect(installEs2024Fallbacks()).toBe(true);
    const src = [3, 1, 2];
    expect(src.toSorted()).toEqual([1, 2, 3]);
    expect(src).toEqual([3, 1, 2]);
    expect(src.toSorted((a: number, b: number) => b - a)).toEqual([3, 2, 1]);
    expect(src.toReversed()).toEqual([2, 1, 3]);
    expect(src).toEqual([3, 1, 2]);
  });

  it("幂等：第二次调用不打补丁，也不覆盖原生实现", () => {
    remove("toSorted");
    expect(installEs2024Fallbacks()).toBe(true);
    const installed = proto["toSorted"];
    expect(installEs2024Fallbacks()).toBe(false);
    expect(proto["toSorted"]).toBe(installed);
  });

  it("原生已存在时不动它", () => {
    const native = proto["toSorted"];
    expect(installEs2024Fallbacks()).toBe(false);
    expect(proto["toSorted"]).toBe(native);
  });
});
