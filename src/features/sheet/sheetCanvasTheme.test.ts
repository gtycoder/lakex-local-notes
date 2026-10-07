/**
 * 表格暗色模式护栏（261008）。
 *
 * 暗色只做「展示层」：canvas（网格线/行列头/单元格默认底色/默认字色）与图标 <symbol>
 * 的颜色由 patches/@fortune-sheet+{core,react}+1.0.4.patch 改成读 --lake-* 令牌；
 * DOM 外壳由 sheetEditor.css 映射；主题切换由 SheetEditor 补发 window.resize 触发重绘。
 * 三者都靠「源码/补丁文本」约束，避免将来回归成写死浅色。
 *
 * 红线：主题色绝不进正文 / S3 / 历史（无 setCellFormat/setCellValue 写入路径），也不进撤销栈。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("./SheetEditor.tsx", import.meta.url), "utf8");
const CSS = readFileSync(new URL("./sheetEditor.css", import.meta.url), "utf8");
const CORE_PATCH = readFileSync(new URL("../../../patches/@fortune-sheet+core+1.0.4.patch", import.meta.url), "utf8");
const REACT_PATCH = readFileSync(new URL("../../../patches/@fortune-sheet+react+1.0.4.patch", import.meta.url), "utf8");

describe("表格暗色模式护栏（261008）", () => {
  it("core patch：canvas 颜色读主题令牌（网格/表头/单元格底/默认字色）", () => {
    expect(CORE_PATCH).toContain("syncLakeSheetCanvasTheme");
    for (const token of ["--lake-text-1", "--lake-border-1", "--lake-bg-canvas", "--lake-bg-subtle"]) {
      expect(CORE_PATCH).toContain(token);
    }
    // 新增字段承载「单元格底 / 表头底」，并由 sync 写入；渲染点改为读这些字段
    expect(CORE_PATCH).toContain("cellBgStyle");
    expect(CORE_PATCH).toContain("headerBgStyle");
    expect(CORE_PATCH).toMatch(/\+\s*renderCtx\.fillStyle = defaultStyle\.(cellBgStyle|headerBgStyle|fillStyle);/);
    expect(CORE_PATCH).toContain("syncLakeSheetCanvasTheme();");
  });

  it("react patch：图标 <symbol> 颜色改为 currentColor（<use> shadow 树里文档 CSS 不可达）", () => {
    expect(REACT_PATCH).toMatch(/\+\s*(fill|stroke): "currentColor"/);
  });

  it("SheetEditor：只在 data-theme 变化后补发 window.resize（重绘不写数据）", () => {
    expect(SRC).toMatch(/attributeFilter: \["data-theme"\]/);
    expect(SRC).toMatch(/observer\.observe\(document\.documentElement, \{ attributes: true/);
    // 只重绘：不得出现任何把主题色写回单元格的调用
    expect(SRC).not.toMatch(/setCellFormat\([^)]*lake/i);
  });

  it("外壳 CSS：暗色块只映射 --lake-* 令牌，无颜色字面量", () => {
    const at = CSS.indexOf("表格暗色模式");
    expect(at).toBeGreaterThan(-1);
    const block = CSS.slice(at);
    expect(block).toMatch(/\.sheet-editor \.fortune-toolbar \{[\s\S]*?background: var\(--lake-bg-subtle\)/);
    expect(block).toMatch(/\.sheet-editor \.fortune-toolbar-button,[\s\S]*?color: var\(--lake-text-2\)/);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
  });
});
