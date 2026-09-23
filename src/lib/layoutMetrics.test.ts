import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCK_GUTTER, FIXED_RAIL_WIDTH, TOPBAR_HEIGHT, TOPBAR_SEAM, TRAFFIC_LIGHT_DIAMETER } from "./layoutMetrics";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("desktop rail geometry", () => {
  it("uses one shared, slightly wider-than-34px rail", () => {
    expect(FIXED_RAIL_WIDTH).toBe(38);
    expect(FIXED_RAIL_WIDTH).toBeGreaterThan(34);
    expect(FIXED_RAIL_WIDTH).toBeLessThan(40);
    expect(DOCK_GUTTER).toBe(4);
  });
});

describe("top bar ↔ macOS traffic light alignment", () => {
  it("keeps base.css --topbar-height equal to the shared TOPBAR_HEIGHT", () => {
    const css = readFileSync(path.join(ROOT, "src/styles/app/base.css"), "utf8");
    const match = css.match(/--topbar-height:\s*(\d+)px/);
    expect(match, "--topbar-height 未在 base.css 找到").not.toBeNull();
    expect(Number(match?.[1])).toBe(TOPBAR_HEIGHT);
  });

  it("centers the traffic lights on the visible header (topbar + seam) instead of hardcoding y", () => {
    const src = readFileSync(path.join(ROOT, "electron/main.ts"), "utf8");
    // 必须用共享常量算（头区 = 顶栏 + 拼接缝），且不能再出现字面量 y
    expect(src).toContain("(TOPBAR_HEIGHT + TOPBAR_SEAM - TRAFFIC_LIGHT_DIAMETER) / 2");
    expect(src).not.toMatch(/trafficLightPosition:\s*\{\s*x:\s*\d+,\s*y:\s*\d+\s*\}/);
    const y = (TOPBAR_HEIGHT + TOPBAR_SEAM - TRAFFIC_LIGHT_DIAMETER) / 2;
    expect(Number.isInteger(y)).toBe(true);
    expect(y).toBeGreaterThanOrEqual(0);
  });
});
