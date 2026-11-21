// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clipboardTableFrom, isUniverInternalCopy, parseHtmlTable, parseTsv } from "./usheetClipboardTable";

/** 从文档表格卡（Lake/语雀）复制的真实形状：<table class="ne-table"> + 单元格内嵌 div。 */
const LAKE_TABLE = `<meta charset="utf-8"><div class="ne-table-wrap"><table class="ne-table"><colgroup><col width="120"></colgroup><tbody>
<tr><td><div class="ne-td"><div class="ne-td-content">甲1</div></div></td><td><div class="ne-td"><div class="ne-td-content">甲2</div></div></td><td><div class="ne-td"><div class="ne-td-content">甲3</div></div></td></tr>
<tr><td><div class="ne-td"><div class="ne-td-content">乙1</div></div></td><td><div class="ne-td"><div class="ne-td-content">乙2</div></div></td><td><div class="ne-td"><div class="ne-td-content">乙3</div></div></td></tr>
</tbody></table></div>`;

const EXCEL_TABLE = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body><!--StartFragment--><table border=1 style="border-collapse:collapse"><tr><td style="mso-number-format:General">x1</td><td>x2</td></tr><tr><td>y1</td><td>y2</td></tr></table><!--EndFragment--></body></html>`;

const UNIVER_INTERNAL = `<meta charset="utf-8"><table data-copy-id="qsNoE5"><tr><td>1</td><td>2</td></tr></table>`;

describe("usheetClipboardTable（261121：文档表格卡 → 我们自己的表格）", () => {
  it("Lake 表格卡（ne-table + 单元格内嵌 div）解析成 2×3 矩阵，不再只剩一格", () => {
    expect(parseHtmlTable(LAKE_TABLE)).toEqual([
      ["甲1", "甲2", "甲3"],
      ["乙1", "乙2", "乙3"],
    ]);
  });

  it("Excel 风格表格同样可解析（保留原路径能力）", () => {
    expect(parseHtmlTable(EXCEL_TABLE)).toEqual([["x1", "x2"], ["y1", "y2"]]);
  });

  it("Univer 自己的复制（data-copy-id）= 不接管（内部粘贴要保样式/合并）", () => {
    expect(isUniverInternalCopy(UNIVER_INTERNAL)).toBe(true);
    expect(clipboardTableFrom({ html: UNIVER_INTERNAL, text: "1\t2" })).toBeNull();
  });

  it("colspan / rowspan 按 Excel 语义铺开：左上留值、其余补空", () => {
    const html = "<table><tr><td colspan=2>A</td><td>B</td></tr><tr><td rowspan=2>C</td><td>D</td><td>E</td></tr><tr><td>F</td><td>G</td></tr></table>";
    expect(parseHtmlTable(html)).toEqual([
      ["A", "", "B"],
      ["C", "D", "E"],
      ["", "F", "G"],
    ]);
  });

  it("尾部全空的行/列被裁掉；单元格内换行压成单个空格", () => {
    const html = "<table><tr><td>标题<br>续行</td><td></td></tr><tr><td></td><td></td></tr></table>";
    expect(parseHtmlTable(html)).toEqual([["标题 续行"]]);
  });

  it("没有表格的 HTML → null（单格文本交回内核）", () => {
    expect(parseHtmlTable("<p>只有一段话</p>")).toBeNull();
  });

  it("TSV：多行多列 → 矩阵；行尾空白清理；CRLF 归一", () => {
    expect(parseTsv("a1\tb1\r\nc1\td1   \r\n")).toEqual([["a1", "b1"], ["c1", "d1"]]);
    expect(parseTsv("只有一行")).toBeNull();
    // 单格（哪怕带尾随制表符）仍算单格 ⇒ 交回内核，不接管
    expect(parseTsv("单格\t")).toBeNull();
  });

  it("clipboardTableFrom 优先级：内部复制 > 表格 HTML > TSV", () => {
    expect(clipboardTableFrom({ html: LAKE_TABLE, text: "甲1\t甲2" })?.source).toBe("html-table");
    expect(clipboardTableFrom({ html: "<p>x</p>", text: "p\tq" })?.source).toBe("tsv");
    expect(clipboardTableFrom({ html: "", text: "" })).toBeNull();
  });
});
describe("⌘V 纠正式接管（261122 用户现场：真实按键只落一格）", () => {
  const EDITOR = readFileSync(process.cwd() + "/src/features/usheet/UniverSheetEditor.tsx", "utf8");
  const keydownBlock = EDITOR.slice(EDITOR.indexOf("const onKeyDown = (event: KeyboardEvent)"), EDITOR.indexOf("window.addEventListener(\"keydown\", onKeyDown, true)"));

  it("keydown 里**不拦**：不 preventDefault / 不 stopImmediatePropagation（拦了内部复制/图片/纯文本全废）", () => {
    expect(keydownBlock).not.toContain("preventDefault");
    expect(keydownBlock).not.toContain("stopImmediatePropagation");
  });

  it("只接管外部表格：内部复制（data-copy-id）直接跳过；用矩阵纠正式覆盖内核的异步粘贴", () => {
    expect(keydownBlock).toContain("isUniverInternalCopy(payload.html)");
    expect(keydownBlock).toContain("clipboardTableFrom(");
    expect(keydownBlock).toContain("[80, 320, 700]");
  });
});
