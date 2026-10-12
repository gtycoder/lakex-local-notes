/**
 * 分屏宽度几何单测（261012）。锁的是**真缺陷**的复现数字：
 * 容器变窄后 `--split-left` 不重夹 ⇒ 右栏塌成 0（旧实现实测 760 → 760px / 0px）。
 * 这些用例都是纯函数级的，能在 vitest 里跑（原 `splitView.test.ts` 只做源码字符串断言，拦不住几何）。
 */
import { describe, expect, it } from "vitest";
import { SPLIT_WIDTH_LIMITS, clampSplitLeft } from "./splitGeometry";

const { minLeft, minRight } = SPLIT_WIDTH_LIMITS;

describe("clampSplitLeft（分屏左栏宽度夹取）", () => {
  it("容器够宽时原样保留用户拖出来的宽度", () => {
    expect(clampSplitLeft(1091, 776)).toBe(776);
    expect(clampSplitLeft(1400, 900)).toBe(900);
  });

  it("容器变窄时重夹：右栏绝不低于 minRight（旧实现的真缺陷）", () => {
    // 261012 实测：容器 760 / 之前拖到 776 ⇒ 旧实现两列 760px 0px（右栏消失）
    expect(clampSplitLeft(760, 776)).toBe(760 - minRight);
    expect(clampSplitLeft(900, 1200)).toBe(900 - minRight);
    // 夹取后两栏相加 = 容器宽
    const left = clampSplitLeft(760, 776);
    expect(left + minRight).toBe(760);
  });

  it("左栏不低于 minLeft（右栏很宽时也不塌）", () => {
    expect(clampSplitLeft(1400, 40)).toBe(minLeft);
    expect(clampSplitLeft(1400, 0)).toBe(minLeft);
  });

  it("上限：不超过 maxLeft，也不越过容器", () => {
    expect(clampSplitLeft(4000, 9999)).toBe(SPLIT_WIDTH_LIMITS.maxLeft);
    expect(clampSplitLeft(1400, 9999)).toBe(Math.min(SPLIT_WIDTH_LIMITS.maxLeft, 1400 - minRight));
  });

  it("容器连两条最小值都放不下 ⇒ 各半（两栏都可见），不越界", () => {
    expect(clampSplitLeft(minLeft + minRight - 1, 400)).toBe(Math.round((minLeft + minRight - 1) / 2));
    expect(clampSplitLeft(200, 400)).toBe(100);
    expect(clampSplitLeft(1, 400)).toBe(1);
  });

  it("未量到容器宽（0/NaN）时只按上下限夹，不产生 0 或 NaN", () => {
    expect(clampSplitLeft(0, 500)).toBe(500);
    expect(clampSplitLeft(Number.NaN, 500)).toBe(500);
    expect(clampSplitLeft(0, Number.NaN)).toBe(minLeft);
  });
});
