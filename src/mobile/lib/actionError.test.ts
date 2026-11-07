import { describe, expect, it, vi } from "vitest";

const showToast = vi.fn();
const report = vi.fn();
vi.mock("../ui/toastBus", () => ({ showToast: (...args: unknown[]) => showToast(...args) }));
vi.mock("./reportMobileActionError", () => ({ reportMobileActionError: (...args: unknown[]) => report(...args) }));

import { toastActionError } from "./actionError";

describe("toastActionError", () => {
  it("统一文案 = 动作 + 失败：+ 错误详情；默认记一条 debug 日志", () => {
    toastActionError("创建副本", new Error("boom"));
    expect(showToast).toHaveBeenCalledWith("创建副本失败：boom", { type: "error" });
    expect(report).toHaveBeenCalledWith("创建副本", expect.any(Error));
  });

  it("suffix 追加在错误文案后；report=false 不重复记录", () => {
    toastActionError("保存", new Error("disk"), { suffix: "；可重试", report: false });
    expect(showToast).toHaveBeenLastCalledWith("保存失败：disk；可重试", { type: "error" });
    expect(report).toHaveBeenCalledTimes(0);
  });
});
