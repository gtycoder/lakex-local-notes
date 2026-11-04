/**
 * 字号行的结构护栏（261104 用户批准：字号从「Aa」面板底部 8 钮改为「− 当前 +」步进器、搬进「更多」面板）。
 *
 * 起因：Aa 面板内容 354px > 可视 312px，被裁掉的正好是最底部那行字号 ⇒ 点按落空。
 * 本文件只看结构与接线（行为由 ui/FontSizeStepper.test.ts 的纯函数用例覆盖）：
 *   ① Aa 面板不许再出现字号行；
 *   ② 「更多」面板的字号行必须夹在缩进与行高之间（与行高同组）；
 *   ③ 点按走既有 fontsize 命令、回显读 activeValues.fontSize；
 *   ④ 共用控件只抄几何、不 import usheet 模块（两套 UI 层互不依赖）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
/** 去掉注释再断言：文件里保留了「当年为什么这样放」的说明，注释提到旧类名是允许的。 */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DOCK = strip(read("src/mobile/editor/EditorDock.tsx"));
const STEPPER = strip(read("src/mobile/ui/FontSizeStepper.tsx"));

describe("「更多」面板：字号改步进器（261104）", () => {
  it("Aa 面板不再有字号整行（med-f-sizes 与逐档 map 都要消失）", () => {
    expect(DOCK).not.toContain("med-f-sizes");
    expect(DOCK).not.toContain("MOBILE_FONT_SIZES.map");
  });

  it("「更多」面板的字号行夹在缩进行与行高行之间（与行高同组）", () => {
    const indent = DOCK.indexOf('key: "indent"');
    const fontSize = DOCK.indexOf('key: "font-size"');
    const lineHeight = DOCK.indexOf('key: "line-height"');
    expect(indent).toBeGreaterThan(-1);
    expect(fontSize).toBeGreaterThan(indent);
    expect(lineHeight).toBeGreaterThan(fontSize);
  });

  it("接线走既有命令与回显：runPanel(\"fontsize\", px) + activeValues.fontSize", () => {
    expect(DOCK).toContain('onPick={(px) => runPanel("fontsize", px)}');
    expect(DOCK).toContain("value={activeValues.fontSize}");
    expect(DOCK).toContain("sizes={MOBILE_FONT_SIZES}");
  });

  it("共用控件只抄几何、不 import usheet 模块（表格与文档 UI 层互不依赖）", () => {
    expect(DOCK).toContain('from "../ui/FontSizeStepper"');
    expect(STEPPER).not.toMatch(/from\s+["'][^"']*usheet/);
    expect(STEPPER).toContain('aria-label="减小字号"');
    expect(STEPPER).toContain('aria-label="增大字号"');
    expect(STEPPER).toContain('aria-label="当前字号"');
  });
});
