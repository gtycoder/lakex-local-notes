import { describe, expect, it } from "vitest";
import { scanUnlayeredGlobalRules } from "./cssLayerScan";

/**
 * 未分层全局 CSS 判据（261021 事故的回归护栏）。
 * 判据 = 未分层 + 裸标签选择器 + reset 类属性；分层内、作用域选择器、keyframes 都不算。
 */
describe("未分层全局 CSS 扫描", () => {
  it("分层内的 reset 不算（我们自己的 @layer 体系）", () => {
    expect(scanUnlayeredGlobalRules("@layer legacy{ body{font-family:x} input,button{margin:0} }")).toEqual([]);
  });

  it("未分层的裸标签 reset 必须命中（antd base 的现场形态）", () => {
    const hits = scanUnlayeredGlobalRules(
      "/*! antd v4 */ html,body{font-family:x} input,button,select,optgroup,textarea{color:inherit;font:inherit;margin:0}",
    );
    expect(hits).toContain("html");
    expect(hits).toContain("body");
    expect(hits).toContain("input");
    expect(hits).toContain("button");
    expect(hits).toContain("textarea");
  });

  it("未分层但有作用域的选择器不算（组件自有 CSS 合法）", () => {
    expect(scanUnlayeredGlobalRules(".bt-grid button{margin:0} .ln-close{margin-left:auto}")).toEqual([]);
    // 带 class 的 button 选择器也不算"全局 reset"（实测 kernel-theme.css 的 button.ln-btn 曾误报）
    expect(scanUnlayeredGlobalRules("button.ln-btn{color:var(--lake-text-1)}")).toEqual([]);
    expect(scanUnlayeredGlobalRules("button.b3-button:not(.x){margin:0}")).toEqual([]);
  });

  it("声明型 @layer 列表不会把后续规则误判为已分层", () => {
    expect(scanUnlayeredGlobalRules("@layer a,b; body{margin:0}")).toEqual(["body"]);
  });

  it("伪类/属性选择器按 tag 归类（button:hover / input[type] 仍算全局）", () => {
    expect(scanUnlayeredGlobalRules("button:hover{margin:0}")).toEqual(["button:hover"]);
    expect(scanUnlayeredGlobalRules("input[type=text]{box-sizing:border-box}")).toEqual(["input[type=text]"]);
  });

  it("keyframes 帧选择器（0%）不算", () => {
    expect(scanUnlayeredGlobalRules("@keyframes k{ 0%{opacity:0} 100%{opacity:1} }")).toEqual([]);
  });

  it("被分层 @media 包住的 reset 仍算已分层", () => {
    expect(scanUnlayeredGlobalRules("@layer legacy{ @media (width<=720px){ button{margin:0} } }")).toEqual([]);
    expect(scanUnlayeredGlobalRules("@media (width<=720px){ button{margin:0} }")).toEqual(["button"]);
  });
});
