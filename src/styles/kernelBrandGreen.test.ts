/**
 * 内核品牌绿（Lake 固定工具栏最左边的「+」）护栏（260928）。
 *
 * 背景：260926 统一内核样式时把 --lakex-editor-color-theme 映射成了本项目的主题 accent，
 * 于是 Lake 固定工具栏那个绿加号也跟着主题变色了。用户要求保留内核绿 —— 它是 Lake 的亮眼标志、
 * 也是「正文由 lakex 内核渲染」的可见证据 ⇒ 只给**这一个图标**开了例外。
 *
 * 这里钉三条不变量，防止后人「顺手统一」把它改掉：
 *   1. 品牌绿取 Lake 原生 schema：浅色 #00B96B，深色 #2ED790；light/warm 不额外覆写；
 *   2. 例外规则只针对 .ne-ui-toolbar-insert-card 的图标，且必须用 :root 提特异性
 *      （内核那条是 0-5-0，且它的 <style> 注入在编辑器根、比我们更晚生效）；
 *   3. --lakex-editor-color-theme 本身仍映射 accent（链接/光标/选区/表格高亮要继续跟主题）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
const KERNEL_THEME = read("styles/kernel-theme.css");
const BASE = read("styles/themes/base.css");
const DARK = read("styles/themes/dark.css");

describe("内核品牌绿：Lake 固定工具栏加号保持内核原生配色", () => {
  it("基础令牌 = 浅色 #00B96B，深色主题覆写为 #2ED790", () => {
    const baseValues = [...BASE.matchAll(/--lake-kernel-brand-green\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(baseValues).toEqual(["#00b96b"]);
    const darkValues = [...DARK.matchAll(/--lake-kernel-brand-green\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(darkValues).toEqual(["#2ed790"]);
    for (const theme of ["light", "warm"]) {
      expect(read(`styles/themes/${theme}.css`), theme + " 不该重复定义品牌绿").not.toContain("--lake-kernel-brand-green");
    }
  });

  it("例外只钉固定工具栏那个加号，且特异性高于内核规则", () => {
    expect(KERNEL_THEME).toMatch(/:root \.ne-ui-toolbar \.ne-toolbar-widget \.ne-ui-toolbar-insert-card \.ne-icon-t-insert-card\.ne-icon,[\s\S]{0,200}?color: var\(--lake-kernel-brand-green\)/);
    // 别把它拆成等特异性写法（同特异性下后注入的内核样式会赢）
    expect(KERNEL_THEME).not.toMatch(/(^|\n)\.ne-ui-toolbar \.ne-toolbar-widget \.ne-ui-toolbar-insert-card/);
  });

  it("主题适配仍作用于 --lakex-editor-color-theme（例外不外溢）", () => {
    expect(KERNEL_THEME).toMatch(/--lakex-editor-color-theme: var\(--lake-accent\)/);
    expect(KERNEL_THEME).not.toMatch(/--lakex-editor-color-theme:\s*var\(--lake-kernel-brand-green\)/);
  });
});
