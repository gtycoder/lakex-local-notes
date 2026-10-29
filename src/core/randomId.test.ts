/**
 * CORE-10：随机源兜底不再用 Math.random。
 *
 * 有 WebCrypto 时走 WebCrypto（形状/唯一性）；**没有 WebCrypto** 时走确定性兜底：
 * 同进程连续调用必不重复（资产文件名撞名 = 静默覆盖既有资产），且不读 Math.random。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUuid } from "./randomId.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("randomId", () => {
  it("WebCrypto 可用：randomUuid 是合法 v4 UUID，randomBytes 长度正确且不重复", () => {
    expect(randomUuid()).toMatch(UUID_V4);
    const a = randomBytes(8);
    const b = randomBytes(8);
    expect(a).toHaveLength(8);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("无 WebCrypto 兜底：UUID 仍是合法 v4、连续调用不重复、且不读 Math.random", () => {
    vi.stubGlobal("crypto", undefined);
    const randomSpy = vi.spyOn(Math, "random");
    const first = randomUuid();
    const second = randomUuid();
    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it("无 WebCrypto 兜底：randomBytes 长度正确且同进程内不重复", () => {
    vi.stubGlobal("crypto", undefined);
    const a = randomBytes(4);
    const b = randomBytes(4);
    expect(a).toHaveLength(4);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
