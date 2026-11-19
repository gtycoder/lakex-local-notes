/**
 * F-E（261119 移动端平滑度审计）几何对拍：骨架与真实查看器**尺寸同源**。
 *
 * 「加载完成几何连续」的前提 = 骨架与查看器的顶部 chrome 与满幅盒同几何；本文件把两者的
 * 关键尺寸逐项对拍（值取自真实端 CSS，骨架必须引用同一令牌/同一数值）：
 *   · 满幅盒 height: 100%（.mobile-bitable / .mobile-usheet / .ink-pad ↔ .mb-pane-skel）；
 *   · 多维表头部两行高 / 行距 / 下距（.mbt-header ↔ .mb-pane-skel__head + 两行条）；
 *   · 多维表顶部内距（.mobile-bitable padding ↔ .mb-pane-skel--bitable padding，只对拍 padding-top 来源）；
 *   · 表格顶条高（.mb-usheet-topbar height ↔ .mb-pane-skel__bar--tab）。
 * 任何一端改了这些几何，本测试都会红 —— 先决定「骨架跟不跟」，再改，别让换构跳变悄悄回来。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

const SKEL = read("./notePaneSkeleton.css");
const BITABLE = read("../bitable/mobileBitable.css");
const USHEET = read("../usheet/usheet-chrome.css");
const MOBILE = read("../mobile.css");
const INK = read("../ink/inkPad.shared.css");

/** 去掉注释（注释里也提到这些类名/尺寸，不能参与匹配）。 */
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

/** 取「选择器 { … }」的规则体（第一处命中；这些规则都是浅层规则，无嵌套）。 */
function ruleBody(css: string, selector: string): string {
  const text = stripComments(css);
  const at = text.indexOf(selector + " {");
  expect(at, "找不到规则 " + selector).toBeGreaterThan(-1);
  const open = text.indexOf("{", at);
  const close = text.indexOf("}", open);
  return text.slice(open + 1, close);
}

/** 取规则体里某属性的值（首条命中）。 */
function value(css: string, selector: string, prop: string): string {
  for (const part of ruleBody(css, selector).split(";")) {
    const k = part.indexOf(":");
    if (k < 0) continue;
    if (part.slice(0, k).trim() === prop) return part.slice(k + 1).trim();
  }
  throw new Error("规则 " + selector + " 里没有属性 " + prop);
}

describe("F-E 骨架几何与真实查看器同源", () => {
  it("满幅盒同几何：三个查看器 root 与骨架都是 height:100% / min-height:0", () => {
    const fill = value(SKEL, ".mb-pane-skel", "height");
    expect(fill).toBe("100%");
    expect(value(BITABLE, ".mobile-bitable", "height")).toBe(fill);
    expect(value(MOBILE, ".mobile-usheet", "height")).toBe(fill);
    expect(value(INK, ".ink-pad", "height")).toBe(fill);
    expect(value(SKEL, ".mb-pane-skel", "min-height")).toBe("0");
  });

  it("多维表头部两行：行高 / 行距 / 下距与 .mbt-header 同源", () => {
    expect(value(SKEL, ".mb-pane-skel__bar--row1", "min-height")).toBe(value(BITABLE, ".mbt-header__row1", "min-height"));
    expect(value(SKEL, ".mb-pane-skel__bar--row2", "min-height")).toBe(value(BITABLE, ".mbt-header__row2", "min-height"));
    expect(value(SKEL, ".mb-pane-skel__head", "gap")).toBe(value(BITABLE, ".mbt-header", "gap"));
    expect(value(SKEL, ".mb-pane-skel__head", "margin-bottom")).toBe(value(BITABLE, ".mbt-header", "margin-bottom"));
  });

  it("多维表顶部留白同源（padding-top 取同一令牌；左右内距共用 --mb-page-pad）", () => {
    // 真实端的内距结构会演进（壳层/内容块怎么分摊由 bitable 域定），这里只对拍**顶部留白来源**与内距令牌：
    // 顶部留白错位 = 换构时顶部元素跳位（F-E 的核心症状）；水平内距同令牌 = 视觉同源。
    const paddingTopOf = (css: string, selector: string): string => {
      const body = ruleBody(css, selector);
      if (body.includes("padding-top:")) return value(css, selector, "padding-top");
      return value(css, selector, "padding").split(" ").filter(Boolean)[0];
    };
    expect(paddingTopOf(SKEL, ".mb-pane-skel--bitable")).toBe(paddingTopOf(BITABLE, ".mobile-bitable"));
    expect(value(SKEL, ".mb-pane-skel--bitable", "padding")).toContain("var(--mb-page-pad)");
  });

  it("表格顶条与 .mb-usheet-topbar 同高", () => {
    expect(value(SKEL, ".mb-pane-skel__bar--tab", "min-height")).toBe(value(USHEET, ".mb-usheet-topbar", "height"));
  });
});
