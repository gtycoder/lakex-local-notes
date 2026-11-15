import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * OS 文字缩放契约（261115，MODERN-WEB-AUDIT A03）。
 *
 * 两条硬约束：
 * 1. 字号档必须是 rem（px 不跟系统文字缩放，大字号用户无路可走）；
 * 2. **默认档位等价**：rem × 16 必须等于改造前的 px 值 ⇒ 100% 时视觉零变化，
 *    否则这次改造就成了一次全站字号微调（不可接受）。
 *
 * 同时钉住两份入口 HTML 的 `<meta name="text-scale">`，以及「没人覆盖根字号」
 * （一旦有人写 html{font-size:14px}，所有 rem 档会整体缩小）。
 */
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

/** 令牌 → 改造前的 px（唯一事实来源；改档位时两边一起改）。 */
const DESKTOP: Record<string, number> = {
  nano: 10, micro: 11, tiny: 12, small: 13, body: 14, bodyMd: 15, bodyLg: 15.5,
  preview: 16, title: 18, display: 20, h1: 24,
};
const MOBILE: Record<string, number> = {
  nano: 12, micro: 13, tiny: 14, small: 15, body: 16, bodyMd: 16, bodyLg: 18,
  title: 18, display: 20, h1: 24,
};

function tokensOf(css: string): { name: string; rem: number }[] {
  return [...css.matchAll(/--lake-font-size-([a-zA-Z0-9-]+):\s*([\d.]+)rem/g)].map((m) => ({
    name: m[1],
    rem: Number(m[2]),
  }));
}

function expectRemTokens(css: string, expected: Record<string, number>, label: string): void {
  const tokens = tokensOf(css);
  expect(tokens.map((t) => t.name).sort(), label + " 令牌集合").toEqual(Object.keys(expected).sort());
  for (const { name, rem } of tokens) {
    const px = Math.round(rem * 16 * 1000) / 1000;
    expect(px, label + " / " + name + " rem→px 必须与改前等值").toBe(expected[name]);
  }
}

describe("OS 文字缩放（A03）", () => {
  it("桌面字号令牌全 rem，且默认档位与改前 px 等值", () => {
    expectRemTokens(read("src/styles/themes/base.css"), DESKTOP, "desktop");
  });

  it("移动端字号令牌全 rem，且默认档位与改前 px 等值", () => {
    expectRemTokens(read("src/mobile/theme/tokens.css"), MOBILE, "mobile");
  });

  it("两份入口 HTML 都声明 text-scale=scale", () => {
    for (const rel of ["index.html", "mobile.html"]) {
      expect(read(rel), rel).toContain('<meta name="text-scale" content="scale" />');
    }
  });

  it("没有人覆盖根字号（否则所有 rem 档整体缩放）", () => {
    const cssFiles = ["src/styles/themes/base.css", "src/styles/app/base.css", "src/styles/kit.css", "src/mobile/theme/tokens.css"];
    for (const rel of cssFiles) {
      expect(read(rel), rel).not.toMatch(/html\s*\{[^}]*font-size\s*:/);
      expect(read(rel), rel).not.toMatch(/:root\s*\{[^}]*font-size\s*:/);
    }
  });
});
