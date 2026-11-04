/**
 * 「＋」面板两个选择型插入（261104）：分栏 2/3/4 栏、高亮块类型。
 * 只做结构/接线护栏（行为在设备上验收）：入口点开内联行、选中后走内核命令、选项集合固定。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const DOCK = strip(read("src/mobile/editor/EditorDock.tsx"));

describe("＋ 面板：分栏 / 高亮块选择（261104）", () => {
  it("分栏入口展开行内选项（2/3/4 栏），选中后走 columns 命令", () => {
    expect(DOCK).toContain("toggleColumnsChooser");
    expect(DOCK).toContain('runPanel("columns", choice.value)');
    for (const label of ["两栏", "三栏", "四栏"]) expect(DOCK).toContain(label);
  });

  it("高亮块入口展开 5 个语义类型，选中后走 alert 命令", () => {
    expect(DOCK).toContain("toggleAlertChooser");
    expect(DOCK).toContain('runPanel("alert", type.value)');
    for (const value of ["info", "tips", "success", "warning", "danger"]) expect(DOCK).toContain('"' + value + '"');
    expect(DOCK).not.toContain('runPanel("alert", "tips")'); // 固定 tips 的旧入口已移除
  });

  it("同一时刻只展开一个行内件（分栏/高亮块/链接互斥）", () => {
    expect(DOCK).toMatch(/setColumnsOpen\(\(open\) => \{[\s\S]{0,120}setAlertOpen\(false\)/);
    expect(DOCK).toMatch(/setAlertOpen\(\(open\) => \{[\s\S]{0,120}setColumnsOpen\(false\)/);
  });
});