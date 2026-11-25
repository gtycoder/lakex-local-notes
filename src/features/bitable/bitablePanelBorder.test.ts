/**
 * 多维表面板件 1px 边框原语门禁（261125 用户裁决 5 / 审计 R-04）。
 *
 * 口径：多维表面板件的 1px 边框**保持不改**（用户裁决「选 2 + 合理化」），但宽度必须走专用原语，
 * 不许再散写 1px 字面宽度：
 *   · --bt-panel-border-w = 1px（宽度单一来源，例外登记见 docs/DESIGN.md Shapes）；
 *   · --bt-panel-border   = var(--bt-panel-border-w) solid var(--lake-border-1)（标准面）。
 * 颜色一律走既有令牌，不写色值。
 *
 * **内容区表格线不参与**（.bt-grid th/td、.bt-group-*、.bt-rel-grid th/td）——DESIGN「文档正文/编辑器内部
 * 等内容区不参与 0.5px 统一」，其字面取值另由 bitableEditorMount.test 钉住，这里也保证它们不被收编。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDITOR = readFileSync(path.join(HERE, "bitableEditor.css"), "utf8");
const CSS_FILES = readdirSync(HERE).filter((f) => f.endsWith(".css"));

/** 内容区表格线：允许保留字面 1px 宽度的选择器（整条规则内出现即视为内容区线）。 */
const CONTENT_TABLE_SELECTORS = [
  ".bt-grid th",
  ".bt-group-start > td",
  ".bt-group-body > td",
  ".bt-group-end > td",
  ".bt-rel-grid th",
  ".bt-rel-grid td",
];

/** 取某行所属规则的选择器头（回溯最近的 '{'）。 */
function enclosingSelector(lines: string[], index: number): string {
  for (let j = index; j >= 0; j--) {
    const open = lines[j].lastIndexOf("{");
    if (open >= 0) {
      const head = lines[j].slice(0, open).trim();
      if (head) return head;
    }
  }
  return "";
}

describe("多维表面板件 1px 边框原语（261125 用户裁决 5）", () => {
  it("单一来源变量定义在多维表样式根（bitableEditor.css :root），颜色走令牌", () => {
    expect(EDITOR).toContain("--bt-panel-border-w: 1px;");
    expect(EDITOR).toContain("--bt-panel-border: var(--bt-panel-border-w) solid var(--lake-border-1);");
    // 原语定义区内不许出现颜色字面量
    const block = EDITOR.match(/:root \{[^}]*--bt-panel-border[^}]*\}/)?.[0] ?? "";
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    // 两个变量各只定义一次（防第二来源）
    expect(EDITOR.match(/--bt-panel-border-w\s*:/g)?.length).toBe(1);
    expect(EDITOR.match(/--bt-panel-border\s*:/g)?.length).toBe(1);
  });

  it("面板件 1px 边框全部收编进原语（宽度只从 --bt-panel-border-w 来）", () => {
    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      const lines = readFileSync(path.join(HERE, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/(?<![-\w])border[a-z-]*\s*:\s*[^;]*\b1px\b/.test(line)) return;
        if (line.includes("var(--bt-panel-border")) return; // 已收编
        const sel = enclosingSelector(lines, i);
        if (CONTENT_TABLE_SELECTORS.some((s) => sel.includes(s))) return; // 内容区表格线
        offenders.push(file + ":" + (i + 1) + "  [" + sel + "]  " + line.trim());
      });
    }
    expect(offenders, "以下面板件边框仍在散写 1px 宽度：\n" + offenders.join("\n")).toEqual([]);
  });

  it("内容区表格线保持字面值（不参与收编，禁止被改写成原语）", () => {
    expect(EDITOR).toMatch(/\.bt-grid th, \.bt-grid td \{ border-right: 1px solid var\(--lake-border-2\); border-bottom: 1px solid var\(--lake-border-2\)/);
    expect(EDITOR).not.toMatch(/\.bt-grid th, \.bt-grid td \{[^}]*--bt-panel-border/);
    const views = readFileSync(path.join(HERE, "bitableViews.css"), "utf8");
    expect(views).not.toMatch(/\.bt-group-start > td[^{]*\{[^}]*--bt-panel-border/);
  });
});
