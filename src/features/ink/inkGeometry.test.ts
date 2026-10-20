import { describe, expect, it } from "vitest";
import type { InkStroke } from "../../core/inkDoc.js";
import { hitTestStroke, outlineToSvgPath, strokeToSvgPath } from "./inkGeometry.js";

const stroke: InkStroke = {
  id: "s1",
  tool: "pen",
  color: "#000000",
  width: 2,
  points: [
    { x: 10, y: 10, pressure: 0.5 },
    { x: 30, y: 10, pressure: 0.5 },
    { x: 50, y: 20, pressure: 0.5 },
  ],
};

describe("手写板几何", () => {
  it("轮廓点转成闭合 SVG path", () => {
    const d = outlineToSvgPath([[0, 0], [10, 0], [10, 10]]);
    expect(d).toBe("M 0.00 0.00 L 10.00 0.00 L 10.00 10.00 Z");
  });

  it("笔迹能生成非空 path（有压感/无压感都走通）", () => {
    expect(strokeToSvgPath(stroke, true)).toMatch(/^M .+ Z$/);
    expect(strokeToSvgPath({ ...stroke, points: stroke.points.map((p) => ({ ...p, pressure: 0.8 })) }, true)).toMatch(/^M .+ Z$/);
  });

  it("整笔橡皮命中线段与单点；远离笔迹不命中", () => {
    expect(hitTestStroke(stroke, { x: 20, y: 11, pressure: 0.5 })).toBe(true);
    expect(hitTestStroke(stroke, { x: 20, y: 100, pressure: 0.5 })).toBe(false);
    expect(hitTestStroke({ ...stroke, points: [stroke.points[0]] }, { x: 10, y: 10, pressure: 0.5 })).toBe(true);
  });
});
