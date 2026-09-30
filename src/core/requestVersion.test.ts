import { describe, expect, it } from "vitest";
import { createNoteReloadGuard, createRequestVersion } from "./requestVersion.js";

describe("createRequestVersion", () => {
  it("returns increasing versions and recognizes only the latest one", () => {
    const guard = createRequestVersion();
    const first = guard.next();
    const second = guard.next();

    expect(second).toBeGreaterThan(first);
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("invalidates an in-flight request", () => {
    const guard = createRequestVersion();
    const request = guard.next();

    guard.invalidate();

    expect(guard.isCurrent(request)).toBe(false);
  });
});

describe("createNoteReloadGuard（审计 F03：按文档作用域）", () => {
  it("不同文档互不取消；同文档最新一次胜出", () => {
    const guard = createNoteReloadGuard();
    const a1 = guard.next("a");
    const b1 = guard.next("b");
    expect(guard.isCurrent(a1)).toBe(true); // b 的 next 不影响 a
    expect(guard.isCurrent(b1)).toBe(true);

    const a2 = guard.next("a");
    expect(guard.isCurrent(a1)).toBe(false); // 同文档旧请求作废
    expect(guard.isCurrent(a2)).toBe(true);
    expect(guard.isCurrent(b1)).toBe(true); // 仍不影响 b
  });

  it("clear 后该文档的旧 token 不再有效", () => {
    const guard = createNoteReloadGuard();
    const token = guard.next("a");
    guard.clear("a");
    expect(guard.isCurrent(token)).toBe(false);
  });
});