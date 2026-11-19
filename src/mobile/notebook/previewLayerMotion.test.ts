/**
 * F-F（261119 移动端平滑度审计）行为契约：设置/回收站的只读预览层（.mobile-settings-preview）
 * 不再「一帧盖上 / 一帧消失」——入场走既有动效令牌（淡入 + 微位移），并登记 reduced-motion 名单。
 *
 * 断言口径（准则②「必要过渡只走既有令牌、只做入场与位移」）：
 *  · 入场动画时长/曲线 = var(--mobile-duration-panel) / var(--mobile-ease-out)（不引新时长）；
 *  · 关键帧只动 opacity / transform（合成层位移；禁止颜色/hover/背景/几何过渡）；
 *  · 容器本体不加 transition（装饰性过渡红线）；
 *  · prefers-reduced-motion 名单里登记 .mobile-settings-preview ⇒ animation: none。
 * 测试落在 src/mobile/notebook/（F-F 规则在 mobile.css，归属本修复流写范围；见任务 task-10）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MOBILE = readFileSync(new URL("../mobile.css", import.meta.url), "utf8");

/** 去掉注释（注释里提到的类名/属性不参与匹配）。 */
function stripComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      i = css.indexOf("*/", i + 2) + 2;
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

/** 从 head 起点做花括号配对，返回该块的完整文本（含 head）。 */
function blockAt(text: string, openBrace: number): string {
  let depth = 0;
  for (let i = openBrace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(openBrace, i + 1);
    }
  }
  throw new Error("花括号不配对");
}

/** 取「选择器 { … }」规则体（找 head 后紧跟 { 的第一处）。 */
function ruleBody(text: string, selector: string): string {
  const at = text.indexOf(selector + " {");
  expect(at, "找不到规则 " + selector).toBeGreaterThan(-1);
  return blockAt(text, text.indexOf("{", at));
}

const CSS = stripComments(MOBILE);
const PREVIEW = ruleBody(CSS, ".mobile-settings-preview");
const KEYFRAMES = blockAt(CSS, CSS.indexOf("{", CSS.indexOf("@keyframes mobile-preview-in")));
const REDUCED = blockAt(CSS, CSS.indexOf("{", CSS.indexOf("@media (prefers-reduced-motion: reduce)")));

describe("F-F 预览层入场位移（mobile.css）", () => {
  it("入场动画走既有令牌：mobile-preview-in + --mobile-duration-panel + --mobile-ease-out", () => {
    expect(PREVIEW).toContain("animation:");
    expect(PREVIEW).toContain("mobile-preview-in");
    expect(PREVIEW).toContain("var(--mobile-duration-panel)");
    expect(PREVIEW).toContain("var(--mobile-ease-out)");
  });

  it("关键帧只动 opacity / transform（淡入 + 微位移；不碰颜色/背景/几何）", () => {
    expect(KEYFRAMES).toContain("opacity:");
    expect(KEYFRAMES).toContain("transform:");
    for (const banned of ["color", "background", "border", "width:", "height:", "margin", "padding", "filter", "box-shadow"]) {
      expect(KEYFRAMES, "关键帧里不许出现 " + banned).not.toContain(banned);
    }
  });

  it("容器本体不加 transition（禁装饰性/颜色/hover 过渡）", () => {
    expect(PREVIEW).not.toContain("transition");
  });

  it("reduced-motion 名单已登记：.mobile-settings-preview ⇒ animation: none", () => {
    const at = REDUCED.indexOf(".mobile-settings-preview");
    expect(at, "prefers-reduced-motion 名单缺 .mobile-settings-preview").toBeGreaterThan(-1);
    const rule = blockAt(REDUCED, REDUCED.indexOf("{", at));
    expect(rule).toContain("animation: none");
  });
});
