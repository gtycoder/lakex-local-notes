import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSyncInterrupted, hasInterruptedSync, markSyncInterrupted, readSyncInterruptedAt } from "./syncResumeMarker";

function stubLocalStorage(): void {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  });
}

describe("移动端断点续传标记", () => {
  beforeEach(stubLocalStorage);
  afterEach(() => vi.unstubAllGlobals());

  it("开始同步写标记、成功结束清除", () => {
    expect(hasInterruptedSync()).toBe(false);
    markSyncInterrupted("2026-10-26T12:00:00.000Z");
    expect(readSyncInterruptedAt()).toBe("2026-10-26T12:00:00.000Z");
    expect(hasInterruptedSync()).toBe(true);
    clearSyncInterrupted();
    expect(hasInterruptedSync()).toBe(false);
  });

  it("没有 localStorage（隐私模式/测试环境）时静默降级，不抛错", () => {
    vi.unstubAllGlobals();
    expect(() => markSyncInterrupted()).not.toThrow();
    expect(hasInterruptedSync()).toBe(false);
  });
});
