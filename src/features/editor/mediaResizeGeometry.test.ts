// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { alignmentFactor, computeResizeValue, handlesFor, movingSidesFor } from "./mediaResizeGeometry";

describe("媒体缩放几何（纯函数）", () => {
  it("1:1 线性：值 = 起点 + 总位移 × 符号 × 对齐系数，与拖动历史无关", () => {
    const base = { startValue: 300, unitPerPixel: 1, min: 32, max: 800, decimals: 0, factor: 1 as const, side: "right" as const };
    expect(computeResizeValue({ ...base, deltaPx: -100 })).toBe(200);
    expect(computeResizeValue({ ...base, deltaPx: -1 })).toBe(299);
    expect(computeResizeValue({ ...base, deltaPx: 0 })).toBe(300);
    // 左侧把手方向取反
    expect(computeResizeValue({ ...base, side: "left", deltaPx: -100 })).toBe(400);
    // 居中系数 2
    expect(computeResizeValue({ ...base, factor: 2, deltaPx: 50 })).toBe(400);
  });

  it("夹取与取整：min/max 生效；decimals 控制小数位", () => {
    const base = { startValue: 300, unitPerPixel: 1, min: 32, max: 310, decimals: 0, factor: 1 as const, side: "right" as const };
    expect(computeResizeValue({ ...base, deltaPx: 500 })).toBe(310);
    expect(computeResizeValue({ ...base, deltaPx: -500 })).toBe(32);
    const pct = { startValue: 50, unitPerPixel: 0.2, min: 10, max: 100, decimals: 1, factor: 1 as const, side: "right" as const };
    expect(computeResizeValue({ ...pct, deltaPx: 33 })).toBe(56.6);
    expect(computeResizeValue({ ...pct, deltaPx: -1 })).toBe(49.8);
  });

  it("把手只出现在会动的边：左=右、右=左、中=两侧", () => {
    expect(movingSidesFor("left")).toEqual(["right"]);
    expect(movingSidesFor("right")).toEqual(["left"]);
    expect(movingSidesFor("center")).toEqual(["left", "right"]);
    expect(alignmentFactor("center")).toBe(2);
    expect(alignmentFactor("left")).toBe(1);
    expect(alignmentFactor("right")).toBe(1);
    expect(handlesFor("left").map((h) => h.id)).toEqual(["edge-right", "corner-tr", "corner-br"]);
    expect(handlesFor("right").map((h) => h.id)).toEqual(["edge-left", "corner-tl", "corner-bl"]);
    expect(handlesFor("center").map((h) => h.id)).toEqual(["edge-left", "corner-tl", "corner-bl", "edge-right", "corner-tr", "corner-br"]);
    expect(handlesFor("left").find((h) => h.id === "corner-br")?.cursor).toBe("nwse-resize");
  });
});
