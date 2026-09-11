// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { hasNativeBridge, isDesktop } from "./native";

interface FakeWin {
  lakeNative?: unknown;
  Capacitor?: { isNativePlatform?: () => boolean };
}

const fakeWin = () => window as unknown as FakeWin;

beforeEach(() => {
  delete fakeWin().lakeNative;
  delete fakeWin().Capacitor;
});

describe("平台判定 isDesktop / hasNativeBridge", () => {
  it("桌面：有 lakeNative 且 Capacitor 非原生 → isDesktop=true", () => {
    fakeWin().lakeNative = {};
    fakeWin().Capacitor = { isNativePlatform: () => false };
    expect(hasNativeBridge()).toBe(true);
    expect(isDesktop()).toBe(true);
  });

  it("安卓：有 lakeNative 且 Capacitor 原生 → isDesktop=false（回归：旧实现误判为桌面）", () => {
    fakeWin().lakeNative = {};
    fakeWin().Capacitor = { isNativePlatform: () => true };
    expect(hasNativeBridge()).toBe(true);
    expect(isDesktop()).toBe(false);
  });

  it("无原生桥（纯浏览器演示）→ 两者皆 false", () => {
    expect(hasNativeBridge()).toBe(false);
    expect(isDesktop()).toBe(false);
  });

  it("有 lakeNative 但无 Capacitor（旧外壳）→ 视为桌面", () => {
    fakeWin().lakeNative = {};
    expect(isDesktop()).toBe(true);
  });
});
