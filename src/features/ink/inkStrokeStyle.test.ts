/**
 * 笔迹样式单一来源的护栏（261104 十六批）：同一条「高亮 = 0.3 + multiply」曾经被抄进 4 个渲染点，
 * 且缩略图已经漂成 0.35。这里同时钉住数值与「不再写字面量」两条。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inkStrokeStyle } from "./inkStrokeStyle";

const read = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("笔迹样式单一来源", () => {
  it("两种工具的参数与不透明度只在这里定义（高亮 = 等宽马克笔 + 半透明 multiply）", () => {
    const pen = inkStrokeStyle("pen");
    const highlighter = inkStrokeStyle("highlighter");
    expect(pen.thinning).toBeGreaterThan(0);
    expect(highlighter.thinning).toBe(0);
    expect(pen.opacity).toBe(1);
    expect(highlighter.opacity).toBeCloseTo(0.3);
    expect(highlighter.blend).toBe("multiply");
    expect(pen.blend).toBeUndefined();
  });

  it("画布静态层 / 在写笔 / 缩略图 / 导出四处都走同一来源，不再各自写字面量", () => {
    for (const file of ["./InkPad.tsx", "./InkPageStrip.tsx", "../../../electron/noteExport.ts"]) {
      const source = read(file);
      expect(source, file).toContain("inkStrokeStyle");
      expect(source, file).not.toContain("? 0.3 :");
      expect(source, file).not.toContain("? 0.35 :");
      expect(source, file).not.toContain("mixBlendMode: \"multiply\"");
    }
  });
});
