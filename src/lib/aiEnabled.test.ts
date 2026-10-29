// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadAiEnabled, saveAiEnabled } from "./aiEnabled";

describe("桌面 AI 总开关（设备本地偏好）", () => {
  beforeEach(() => { window.localStorage.clear(); });

  it("默认开（保持既有行为不变）", () => {
    expect(loadAiEnabled()).toBe(true);
  });

  it("关掉后读回 false，重新打开读回 true", () => {
    saveAiEnabled(false);
    expect(loadAiEnabled()).toBe(false);
    saveAiEnabled(true);
    expect(loadAiEnabled()).toBe(true);
  });

  it("localStorage 不可用时回落默认开（不因存储异常把 AI 锁死）", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    expect(loadAiEnabled()).toBe(true);
    saveAiEnabled(false); // 不抛
    if (original) Object.defineProperty(window, "localStorage", original);
  });
});
