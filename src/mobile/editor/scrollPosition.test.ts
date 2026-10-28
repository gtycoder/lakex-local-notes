import { describe, expect, it } from "vitest";
import { clampScrollTop, scrollMax } from "./scrollPosition";

describe("scrollMax / clampScrollTop（模式切换恢复滚动位置）", () => {
  it("scrollMax = scrollHeight-clientHeight，负数/非有限值回落 0", () => {
    expect(scrollMax(3014, 790)).toBe(2224);
    expect(scrollMax(790, 790)).toBe(0);
    expect(scrollMax(500, 790)).toBe(0);
    expect(scrollMax(Number.NaN, 790)).toBe(0);
    expect(scrollMax(3014, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("范围内原样恢复（阅读 790 切到编辑，仍在可滚范围内）", () => {
    // 编辑态 sh=2954 ch=790 ⇒ 上限 2164；790 在范围内
    expect(clampScrollTop(790, 2954, 790)).toBe(790);
  });

  it("超出上限时钳到 scrollHeight-clientHeight（换模式后内容变矮）", () => {
    // 阅读态 st=2224，切编辑后 max=2164 ⇒ 钳到 2164，而不是越界再被浏览器钳一次
    expect(clampScrollTop(2224, 2954, 790)).toBe(2164);
  });

  it("内容不够一屏（max=0）一律回到顶部", () => {
    expect(clampScrollTop(800, 700, 790)).toBe(0);
  });

  it("负值/NaN/Infinity 回落 0（不让坏值把页面滚飞）", () => {
    expect(clampScrollTop(-5, 3014, 790)).toBe(0);
    expect(clampScrollTop(Number.NaN, 3014, 790)).toBe(0);
    expect(clampScrollTop(Number.POSITIVE_INFINITY, 3014, 790)).toBe(0);
  });
});
