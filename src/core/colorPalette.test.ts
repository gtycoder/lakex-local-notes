import { describe, expect, it } from "vitest";
import { BITABLE_OPTION_PALETTE } from "./bitable/types.js";
import {
  COLOR_BOARD_GROUPS,
  COLOR_BOARD_VALUE_SET,
  COLOR_BOARD_VALUES,
  DEFAULT_LIGHT_COLORS,
  OPTION_COLOR_BOARD_GROUPS,
  OPTION_COLOR_BOARD_VALUES,
} from "./colorPalette.js";

/** RGB → HSL 色相角（0–360；近灰时色相不稳 ⇒ 调用方先判饱和度）。 */
function hueOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function saturationOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  return d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
}

/** 亮度（0–255；同 contrastTextColor 的加权口径）。 */
function lumaOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (299 * r + 587 * g + 114 * b) / 1000;
}

function hueDistance(a: string, b: string): number {
  const d = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return Math.min(d, 360 - d);
}

describe("多维表选项色板 OPTION_COLOR_BOARD_*（261119 用户点单：70 色收成 2 行深浅档）", () => {
  it("① 形态 = 2 行 × 10 列，上下同列同色相（色相聚类 ≤ 20°）、上浅下深；且行 = 内核色板整行挑取", () => {
    expect(OPTION_COLOR_BOARD_GROUPS).toHaveLength(2);
    expect(OPTION_COLOR_BOARD_GROUPS.every((row) => row.length === 10)).toBe(true);
    expect(OPTION_COLOR_BOARD_VALUES).toHaveLength(20);
    // 行优先拍平：先浅档一行、再深档一行
    expect(OPTION_COLOR_BOARD_VALUES).toEqual([...OPTION_COLOR_BOARD_GROUPS[0], ...OPTION_COLOR_BOARD_GROUPS[1]]);
    // 直接钉常量数组（挑取哪两行）：上 = 浅中档 COLOR_BOARD_GROUPS[3]，下 = 鲜艳中档 COLOR_BOARD_GROUPS[4]（261119 用户红框原图选定）
    expect(OPTION_COLOR_BOARD_GROUPS[0]).toEqual(COLOR_BOARD_GROUPS[3]);
    expect(OPTION_COLOR_BOARD_GROUPS[1]).toEqual(COLOR_BOARD_GROUPS[4]);
    for (let col = 0; col < 10; col++) {
      const light = OPTION_COLOR_BOARD_GROUPS[0][col];
      const dark = OPTION_COLOR_BOARD_GROUPS[1][col];
      // 同列同色相（两档都带色，色相聚类距离 ≤ 20°）
      expect(saturationOf(light)).toBeGreaterThan(0.15);
      expect(saturationOf(dark)).toBeGreaterThan(0.15);
      expect(hueDistance(light, dark)).toBeLessThanOrEqual(20);
      // 上浅下深
      expect(lumaOf(light)).toBeGreaterThan(lumaOf(dark));
    }
  });

  it("② 候选全部属于桌面支持集 COLOR_BOARD_VALUES（不自造色值），且 20 色不重复", () => {
    expect(OPTION_COLOR_BOARD_VALUES.every((hex) => COLOR_BOARD_VALUE_SET.has(hex))).toBe(true);
    expect(new Set(OPTION_COLOR_BOARD_VALUES).size).toBe(20);
  });

  it("③ 全色阶面板的数据源不受影响：7×10=70 全量仍在（背景/文字/填色继续完整深浅档）", () => {
    expect(COLOR_BOARD_GROUPS).toHaveLength(7);
    expect(COLOR_BOARD_GROUPS.every((row) => row.length === 10)).toBe(true);
    expect(COLOR_BOARD_VALUES).toHaveLength(70);
    expect(DEFAULT_LIGHT_COLORS).toBe(COLOR_BOARD_GROUPS[2]);
  });

  it("④ 多维表新建选项轮转池 ⊆ OPTION_COLOR_BOARD_VALUES（落盘值能在取色面选出，261119）", () => {
    // BITABLE_OPTION_PALETTE（core/bitable/types.ts）= 新建选项/进度的默认轮转池；
    // 落盘值必须能在选项色板里点选回来（色板选不中当前色 = 违反「落盘值 ∈ 取色面」）。
    const optionValueSet = new Set(OPTION_COLOR_BOARD_VALUES);
    expect(BITABLE_OPTION_PALETTE.length).toBeGreaterThan(0);
    expect(BITABLE_OPTION_PALETTE.every((hex) => optionValueSet.has(hex))).toBe(true);
    // 轮转池 = 选项色板浅中档行（保持默认浅底观感）
    expect([...BITABLE_OPTION_PALETTE]).toEqual([...OPTION_COLOR_BOARD_GROUPS[0]]);
  });
});
