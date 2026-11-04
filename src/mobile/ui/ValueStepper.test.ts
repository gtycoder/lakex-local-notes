import { describe, expect, it } from "vitest";
import { currentValue, nearestIndex, stepValue } from "./ValueStepper";
import { LINE_HEIGHT_DEFAULT_INDEX, LINE_HEIGHT_STEPS } from "./LineHeightStepper";

describe("ValueStepper 纯函数（字号/行高共用）", () => {
  it("数值档：null → fallbackIndex；非档位值取最近档", () => {
    const values = [14, 15, 16, 19, 22] as const;
    expect(nearestIndex(values, null, 2)).toBe(2);
    expect(nearestIndex(values, 18, 0)).toBe(3); // 19 比 16 更近
    expect(nearestIndex(values, 9, 0)).toBe(0);
  });

  it("字符串档：精确匹配；'default' 参与步进；未知字符串回退 fallbackIndex", () => {
    expect(nearestIndex(LINE_HEIGHT_STEPS, "default", LINE_HEIGHT_DEFAULT_INDEX)).toBe(LINE_HEIGHT_DEFAULT_INDEX);
    expect(nearestIndex(LINE_HEIGHT_STEPS, "boom", 1)).toBe(1);
    expect(currentValue(LINE_HEIGHT_STEPS, null, LINE_HEIGHT_DEFAULT_INDEX)).toBe("default");
    expect(currentValue(LINE_HEIGHT_STEPS, 2, 0)).toBe(2);
  });

  it("stepValue：相邻档移动、首尾不越界", () => {
    expect(stepValue(LINE_HEIGHT_STEPS, 1.5, 1)).toBe("default");
    expect(stepValue(LINE_HEIGHT_STEPS, "default", 1)).toBe(2);
    expect(stepValue(LINE_HEIGHT_STEPS, "default", -1)).toBe(1.5);
    expect(stepValue(LINE_HEIGHT_STEPS, 1, -1)).toBe(1);
    expect(stepValue(LINE_HEIGHT_STEPS, 3, 1)).toBe(3);
  });

  it("档位表为空 → null / 原值兜底，不抛错", () => {
    expect(nearestIndex([], 16, 0)).toBe(0);
    expect(currentValue([], 16, 0)).toBeNull();
    expect(stepValue([], 16, 1)).toBeNull();
  });
});

describe("LineHeightStepper 档位（与内核下拉同序）", () => {
  it("档位 = [1, 1.15, 1.5, 默认, 2, 2.5, 3]，默认档居中", () => {
    expect([...LINE_HEIGHT_STEPS]).toEqual([1, 1.15, 1.5, "default", 2, 2.5, 3]);
    expect(LINE_HEIGHT_DEFAULT_INDEX).toBe(3);
  });
});