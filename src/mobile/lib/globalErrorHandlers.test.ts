// @vitest-environment jsdom
/**
 * 全局异常兜底（261105）：window error / unhandledrejection 都要进崩溃记录，卸载后不再记。
 * 桌面同口径见 src/main.tsx:18-23；移动端此前缺失（审计 Top10 #2）。
 *
 * 注：事件派发用裸 EventTarget 而不是 jsdom 的 window —— 在 window 上派发 "error"
 * 会触发 jsdom 自己的「未捕获异常」报告（噪音，且与本模块无关）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { clearCrashLog, readCrashLog } from "./crashLog";
import { installGlobalErrorHandlers } from "./globalErrorHandlers";

function fakeWindow(): EventTarget & Window {
  return new EventTarget() as unknown as EventTarget & Window;
}

function errorEvent(error: unknown, message: string): Event {
  const event = new Event("error");
  Object.defineProperty(event, "error", { value: error });
  Object.defineProperty(event, "message", { value: message });
  return event;
}

function rejectionEvent(reason: unknown): Event {
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", { value: reason });
  return event;
}

beforeEach(() => clearCrashLog());

describe("installGlobalErrorHandlers", () => {
  it("window error → crashLog（scope=window，带堆栈）", () => {
    const target = fakeWindow();
    const uninstall = installGlobalErrorHandlers(target);
    try {
      target.dispatchEvent(errorEvent(new Error("boom"), "boom"));
    } finally { uninstall(); }
    const entries = readCrashLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scope: "window", message: "boom" });
    expect(entries[0].stack).toBeTruthy();
  });

  it("unhandledrejection → crashLog（scope=promise；非 Error 也能记录）", () => {
    const target = fakeWindow();
    const uninstall = installGlobalErrorHandlers(target);
    try {
      target.dispatchEvent(rejectionEvent(new Error("nope")));
      target.dispatchEvent(rejectionEvent("字符串原因"));
    } finally { uninstall(); }
    const entries = readCrashLog();
    expect(entries.map((entry) => entry.scope)).toEqual(["promise", "promise"]);
    expect(entries[0].message).toBe("nope");
    expect(entries[1].message).toBe("字符串原因");
  });

  it("卸载后不再记录（避免测试/热重载重复叠加）", () => {
    const target = fakeWindow();
    const uninstall = installGlobalErrorHandlers(target);
    uninstall();
    target.dispatchEvent(errorEvent(new Error("late"), "late"));
    expect(readCrashLog()).toEqual([]);
  });
});
