/**
 * 字号/行高（「更多」面板合并行）的结构护栏（261104 二次收口）。
 *
 * 起因链：Aa 面板内容 354px > 312px 裁掉字号行 ⇒ 字号搬进「更多」；用户再点单「行高也做成步进器，两行并一行」。
 * 本文件只看结构与接线（行为由 ui/FontSizeStepper.test.ts 与 ui/ValueStepper.test.ts 的纯函数用例覆盖）：
 *   ① Aa 面板不许再出现字号行；
 *   ② 「更多」面板：缩进行之后是**字号 + 行高同一行**，旧的 line-height 按钮行已删；
 *   ③ 字号走 fontsize 命令、行高走 lineHeight（数值直传 / 「默认」= 不传参）；
 *   ④ 共用控件只抄几何、不 import usheet 模块（两套 UI 层互不依赖）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
/** 去掉注释再断言：文件里保留了「当年为什么这样放」的说明，注释提到旧类名是允许的。 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DOCK = strip(read("src/mobile/editor/EditorDock.tsx"));
const FONT = strip(read("src/mobile/ui/FontSizeStepper.tsx"));
const LINE = strip(read("src/mobile/ui/LineHeightStepper.tsx"));
const VALUE = strip(read("src/mobile/ui/ValueStepper.tsx"));

describe("「更多」面板：字号 + 行高合并一步进行（261104）", () => {
  it("Aa 面板不再有字号整行（med-f-sizes 与逐档 map 都要消失）", () => {
    expect(DOCK).not.toContain("med-f-sizes");
    expect(DOCK).not.toContain("MOBILE_FONT_SIZES.map");
  });

  it("「更多」面板：缩进行之后是合并行（字号+行高），旧的 line-height 按钮行已删", () => {
    const indent = DOCK.indexOf('key: "indent"');
    const merged = DOCK.indexOf('key: "size-line"');
    expect(indent).toBeGreaterThan(-1);
    expect(merged).toBeGreaterThan(indent);
    expect(DOCK).not.toContain('key: "line-height"');
    // 同一行里两枚步进器（各包一张 med-f-card）
    expect(DOCK).toContain('<div className="med-f-card med-f-step"><FontSizeStepper');
    expect(DOCK).toContain('<div className="med-f-card med-f-step"><LineHeightStepper');
  });

  it("接线：字号走 fontsize(px)、行高走 lineHeight（默认档 = 不传参）", () => {
    expect(DOCK).toContain('onPick={(px) => runPanel("fontsize", px)}');
    expect(DOCK).toContain("value={activeValues.fontSize}");
    expect(DOCK).toContain("sizes={MOBILE_FONT_SIZES}");
    expect(DOCK).toContain('runPanel("lineHeight")');
    expect(DOCK).toContain('runPanel("lineHeight", v)');
    expect(DOCK).toContain("lineHeightValue(activeValues.lineHeight)");
  });

  it("共用控件只抄几何、不 import usheet 模块（表格与文档 UI 层互不依赖）", () => {
    expect(DOCK).toContain('from "../ui/FontSizeStepper"');
    expect(DOCK).toContain('from "../ui/LineHeightStepper"');
    for (const src of [FONT, LINE, VALUE]) expect(src).not.toMatch(/from\s+["'][^"']*usheet/);
    // a11y 名由 ValueStepper 按 ariaLabel 组装（字号/行高共用一套）
    expect(VALUE).toContain('aria-label={"减小" + ariaLabel}');
    expect(VALUE).toContain('aria-label={"增大" + ariaLabel}');
    expect(VALUE).toContain('aria-label={"当前" + ariaLabel}');
  });
});