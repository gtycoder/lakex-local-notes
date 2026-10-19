import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 表格（usheet）页底部布局护栏（261019 用户截图）：
 * Univer 自带底部工具条（工作表标签 / 缩放 / 求和）贴屏幕底，底部胶囊必须**上移让位**，
 * 否则会盖住工作表标签（截图中「Sheet1」被胶囊压住）。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const WS = read("./NotebookWorkspace.tsx");
const CSS = read("../mobile.css");
const TOKENS = read("../theme/tokens.css");

describe("表格页底部让位（261019）", () => {
  it("工作区胶囊按 active.kind=usheet 加上移类", () => {
    expect(WS).toMatch(/active\?\.kind === "usheet" \? " mobile-bottom-bar--above-sheet"/);
  });

  it("CSS 用令牌抬升（不写魔法数字），令牌 = 实测 36px", () => {
    expect(CSS).toMatch(/\.mobile-bottom-bar--above-sheet\s*\{\s*bottom:\s*calc\([\s\S]{0,200}?var\(--mobile-sheet-bar-h\)/);
    expect(TOKENS).toMatch(/--mobile-sheet-bar-h:\s*36px/);
  });
});
