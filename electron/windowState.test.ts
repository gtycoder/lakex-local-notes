import { describe, expect, it } from "vitest";
import { clampWindowState, type WindowState } from "./windowState";

describe("window state", () => {
  it("clamps restored bounds into the display work area", () => {
    const state: WindowState = { x: -500, y: 1100, width: 1600, height: 100, maximized: false, fullscreen: false };
    expect(clampWindowState(state, { x: 0, y: 0, width: 1440, height: 900 })).toEqual({ x: 0, y: 420, width: 1440, height: 480, maximized: false, fullscreen: false });
  });

  it("falls back to safe defaults for invalid values", () => {
    expect(clampWindowState({ x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 0, height: -1, maximized: true, fullscreen: false }, { x: 0, y: 0, width: 1440, height: 900 })).toEqual({ x: 80, y: 40, width: 1280, height: 820, maximized: true, fullscreen: false });
  });
});
