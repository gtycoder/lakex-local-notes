/**
 * 输入法收/放与 dock 点击的「光标不漂移」护栏（261104 用户实机报的严重回归）。
 *
 * 根因：applyImeSuppression 的全局分支曾遍历**所有可见 contenteditable** 逐个 blur/focus；
 * 正文里有嵌套宿主（分栏卡 NE-COLUMNS-CONTENT、表格/卡片）时，最后 focus 的是嵌套宿主 ⇒
 * 焦点/选区被搬过去、正文滚到底（实测 selection 丢失 + bodyTop 0→507）。
 * 本文件只做静态契约，防止回退（行为由设备验收：收/放键盘、开合面板、点 B 后 caret rect 不变）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const readNoComments = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SURFACE = readNoComments("src/mobile/editor/useEditSurface.ts");
const DOCK = readNoComments("src/mobile/editor/EditorDock.tsx");
const DISPATCHER = readNoComments("src/mobile/editor/useEditorCommandDispatcher.ts");

describe("收/放输入法与 dock 点击：光标不漂移（261104）", () => {
  it("输入法抑制要保存/恢复 DOM 选区与滚动位置", () => {
    expect(SURFACE).toContain("captureEditSelection(");
    expect(SURFACE).toContain("restoreEditSelection(range)");
    expect(SURFACE).toContain("scrollParentOf(");
  });

  it("不再遍历所有 contenteditable 逐个 blur/focus（嵌套宿主会把焦点搬走）", () => {
    expect(SURFACE).not.toContain("try { el.blur(); if (refocus) el.focus(); }");
    // 只允许对单一 target 做 blur/focus
    expect(SURFACE).toContain("try { target.blur(); if (refocus) target.focus(); }");
  });

  it("dock 工具栏按下时先快照选区（按钮不是 contenteditable，浏览器会打散 DOM 选区）", () => {
    expect(DOCK).toContain("onMouseDown={(e) => { e.preventDefault(); snapshotSelection(); }}");
  });

  it("inline 命令后选区失效要修一次（同步 + 下一帧）", () => {
    expect(DISPATCHER).toContain("repairSelection");
    expect(DISPATCHER).toContain("window.requestAnimationFrame(repairSelection)");
  });
});