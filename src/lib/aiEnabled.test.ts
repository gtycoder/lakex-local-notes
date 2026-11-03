// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadAiEnabled, saveAiEnabled } from "./aiEnabled";

describe("桌面 AI 总开关（设备本地偏好）", () => {
  beforeEach(() => { window.localStorage.clear(); });

  it("默认关（261103 用户定稿；移动端同口径）", () => {
    expect(loadAiEnabled()).toBe(false);
  });

  it("关掉后读回 false，重新打开读回 true", () => {
    saveAiEnabled(false);
    expect(loadAiEnabled()).toBe(false);
    saveAiEnabled(true);
    expect(loadAiEnabled()).toBe(true);
  });

  it("localStorage 不可用时回落默认关（fail-closed，不会替用户打开 AI）", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    expect(loadAiEnabled()).toBe(false);
    saveAiEnabled(true); // 不抛
    if (original) Object.defineProperty(window, "localStorage", original);
  });
});
