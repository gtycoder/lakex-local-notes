/** MOB-14：空 catch 的可观测兜底 —— 默认只记 debug 日志，显式要求才弹 toast。 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../ui/toastBus", () => ({ showToast: mocks.showToast }));

import { reportMobileActionError } from "./reportMobileActionError";

const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);

afterEach(() => {
  debug.mockClear();
  mocks.showToast.mockClear();
});

describe("reportMobileActionError（MOB-14 保守版）", () => {
  it("默认只记 debug 日志（带动作名与错误摘要），不打扰用户", () => {
    reportMobileActionError("撤销", new Error("kernel unavailable"));
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("[mobile-action] 撤销失败：kernel unavailable"));
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("没有 error 对象时也能留下动作名", () => {
    reportMobileActionError("冻结行列");
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("[mobile-action] 冻结行列失败"));
  });

  it("显式要求时才弹 toast：默认文案 / 自定义文案", () => {
    reportMobileActionError("重做", new Error("boom"), { toast: true });
    expect(mocks.showToast).toHaveBeenCalledWith("重做失败", { type: "error" });

    reportMobileActionError("插入日期", new Error("boom"), { toast: "插入日期失败", type: "info" });
    expect(mocks.showToast).toHaveBeenLastCalledWith("插入日期失败", { type: "info" });
  });
});
