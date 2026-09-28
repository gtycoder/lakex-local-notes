import { afterEach, describe, expect, it, vi } from "vitest";
import { writeLocalStorage } from "./localStorageSafe";

describe("writeLocalStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("正常写入返回 true", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem });
    expect(writeLocalStorage("k", "v")).toBe(true);
    expect(setItem).toHaveBeenCalledWith("k", "v");
  });

  it("存储异常不抛出、返回 false 且保留日志", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("quota"); } });
    expect(writeLocalStorage("k", "v")).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
