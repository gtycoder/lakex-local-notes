// @vitest-environment jsdom
/**
 * 大表格粘贴护栏（A+B，261008）护栏：纯逻辑真单测 + 接线源码级断言。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TABLE_PASTE_MAX_CELLS, TABLE_PASTE_MAX_ROWS, countHtmlTable, noteRefCardHtml, onOversizeTablePaste,
  oversizeTableShape, parseHtmlTableToSheetBody, sheetDocTitle, emitOversizeTablePaste,
} from "./tablePasteGuard";

// ⚠️ jsdom 环境下 import.meta.url 是 http:// ⇒ 不能给 readFileSync；源码护栏走 cwd 相对路径。
const SRC = join(process.cwd(), "src/features/editor");
const INTERCEPTOR = readFileSync(join(SRC, "clipboardHtml.ts"), "utf8");
const DIALOG = readFileSync(join(SRC, "TablePasteGuardDialog.tsx"), "utf8");
const APP = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");

const table = (rows: number, cols: number) =>
  "<table>" + Array.from({ length: rows }, (_, r) =>
    "<tr>" + Array.from({ length: cols }, (_, c) => `<td>第${r + 1}行${c + 1}列</td>`).join("") + "</tr>").join("") + "</table>";

describe("大表格粘贴护栏：纯逻辑", () => {
  it("计数：行/格；没有表格返回 null", () => {
    expect(countHtmlTable(table(3, 2))).toEqual({ rows: 3, cells: 6 });
    expect(countHtmlTable("<p>纯文本</p>")).toBeNull();
    expect(countHtmlTable("")).toBeNull();
  });

  it("阈值：超行数或超格数才拦（边界不拦）", () => {
    // 口径值（261008 用户定稿）：1000 行 / 5000 格；边界本身放行，超出才拦
    expect(TABLE_PASTE_MAX_ROWS).toBe(1000);
    expect(TABLE_PASTE_MAX_CELLS).toBe(5000);
    expect(oversizeTableShape(table(TABLE_PASTE_MAX_ROWS, 2))).toBeNull();
    expect(oversizeTableShape(table(TABLE_PASTE_MAX_ROWS + 1, 2))).not.toBeNull();
    const wideCols = Math.ceil(TABLE_PASTE_MAX_CELLS / 2) + 1;
    expect(oversizeTableShape(table(2, wideCols))).not.toBeNull();
    expect(oversizeTableShape("<p>没有表格</p>")).toBeNull();
  });

  it("解析成表格文档正文（kind=sheet v2，含 row/column 与 celldata）", () => {
    const body = parseHtmlTableToSheetBody(table(2, 2));
    expect(body).toBeTruthy();
    const doc = JSON.parse(body!);
    expect(doc.kind).toBe("sheet");
    expect(doc.version).toBe(2);
    expect(doc.sheets[0].row).toBe(2);
    expect(doc.sheets[0].column).toBe(2);
    expect(doc.sheets[0].celldata).toHaveLength(4);
    expect(doc.sheets[0].celldata[0].v.m).toContain("第1行1列");
    expect(doc.sheets[0].celldata[0].v.tb).toBe("2");
    expect(parseHtmlTableToSheetBody("<p>无表</p>")).toBeNull();
  });

  it("标题与卡片 HTML（内核认的 ne-custom-card 形态）", () => {
    expect(sheetDocTitle({ rows: 5500, cells: 33000 }, Date.UTC(2026, 9, 8))).toContain("5500 行");
    const html = noteRefCardHtml({ noteId: "n-1", title: "被引用表格" });
    expect(html).toContain('class="ne-custom-card"');
    expect(html).toContain('data-custom-name="lake-note-ref"');
    expect(decodeURIComponent(/data-value="([^"]*)"/.exec(html)![1])).toContain('"$name":"lake-note-ref"');
  });

  it("事件通道：订阅/退订/广播", () => {
    const seen: number[] = [];
    const off = onOversizeTablePaste((p) => seen.push(p.shape.rows));
    emitOversizeTablePaste({ shape: { rows: 5001, cells: 30006 }, html: "", at: 1 });
    off();
    emitOversizeTablePaste({ shape: { rows: 1, cells: 1 }, html: "", at: 2 });
    expect(seen).toEqual([5001]);
  });
});

describe("大表格粘贴护栏：接线", () => {
  it("拦截器必须拦在捕获阶段并阻止本次粘贴（否则内核收下大表照样卡死）", () => {
    expect(INTERCEPTOR).toContain("oversizeTableShape(pastedHtml)");
    expect(INTERCEPTOR).toContain("event.preventDefault()");
    expect(INTERCEPTOR).toContain("event.stopImmediatePropagation()");
    expect(INTERCEPTOR).toContain("emitOversizeTablePaste(");
    expect(INTERCEPTOR.indexOf("oversizeTableShape(pastedHtml)")).toBeLessThan(INTERCEPTOR.indexOf("clipboardData.getData = "));
    expect(INTERCEPTOR).toMatch(/},\s*true\s*\);/);
  });

  it("对话框：A 的明确提示 + B 的一键存为表格文档 + 引用卡落点", () => {
    expect(DIALOG).toContain("粘贴的表格过大");
    expect(DIALOG).toContain("存为表格文档");
    expect(DIALOG).toContain("阻止本次粘贴");
    expect(DIALOG).toContain("native.createSheetIn(parentId, title)");
    expect(DIALOG).toContain("insertAtPosition");
    expect(DIALOG).toContain("noteRefCardHtml(");
    expect(APP).toContain("<TablePasteGuardDialog parentId=");
  });
});
