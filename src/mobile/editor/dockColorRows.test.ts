/**
 * 「Aa」面板颜色两行的护栏（261014 用户报的"两行串联"）。
 *
 * 缺陷：两行（上排 A = 文字色 / 下面色板 = 背景色）原本共用一个 `colorVariant` 变体状态 ——
 * 切到字色时色板回显的是**字色**，于是点一下 A 排的红色，色板也跟着标红（用户看到的"串联"）。
 *
 * 定稿口径（用户 261014）：**两行各自独立** —— A 排只管文字色、色板只管背景色，
 * 各自用自己那条内核值回显（`activeValues.color` / `activeValues.bgColor`），不再有共享变体。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAW = readFileSync(path.join(process.cwd(), "src/mobile/editor/EditorDock.tsx"), "utf8");
/** 去掉注释再断言：文件里保留了"当年为什么错"的说明，注释里出现 colorVariant 是允许的。 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Aa 面板：文字色 / 背景色两行必须各自独立", () => {
  it("不得再有共享的变体状态（colorVariant 是「串联」的根源）", () => {
    expect(SRC).not.toContain("colorVariant");
  });

  it("A 排 = 文字色：点选走 text 变体、回显只看 activeValues.color", () => {
    expect(SRC).toMatch(/pickColor\(c, "text"\)/);
    expect(SRC).toMatch(/const textColorActive = \(hex: string\) => !!activeValues\.color/);
  });

  it("色板 = 背景色：点选走 bg 变体、回显只看 activeValues.bgColor", () => {
    expect(SRC).toMatch(/onClick=\{\(\) => pickColor\(hex, "bg"\)\}/);
    expect(SRC).toMatch(/const boardColorActive = \(hex: string\) => !!activeValues\.bgColor/);
  });

  it("色板首格 = 无填充（同样走 bg 变体）", () => {
    expect(SRC).toMatch(/pickColor\("", "bg"\)/);
  });

  it("pickColor 的 variant 必填（禁止再出现隐含默认）", () => {
    expect(SRC).toMatch(/const pickColor = \(raw: string, variant: ColorVariant\)/);
  });
});
