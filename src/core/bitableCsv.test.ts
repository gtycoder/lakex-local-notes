import { describe, expect, it } from "vitest";
import { bitablesToBody, createBitableField, createBitableRecord, createDefaultBitableTable, parseBitableBody } from "./bitableDoc.js";
import { bitableTableCsv, coerceCsvCell, defaultCsvMapping, importCsvRows, parseCsv, type CsvColumnMapping } from "./bitableCsv.js";

describe("CSV 导出（Excel 通用）", () => {
  it("BOM + CRLF + 表头 + 值口径（多值/布尔/附件只出展示名）", () => {
    const table = createDefaultBitableTable("名单");
    const primary = table.fields[0];
    const tags = createBitableField("multiSelect", "标签");
    tags.options = [{ id: "o1", name: "甲" }, { id: "o2", name: "乙" }];
    const boolF = createBitableField("boolean", "启用");
    const att = createBitableField("attachment", "附件");
    table.fields.push(tags, boolF, att);
    const record = createBitableRecord();
    record.values[primary.id] = "带,逗号";
    record.values[tags.id] = ["o1", "o2"];
    record.values[boolF.id] = true;
    record.values[att.id] = [{ file: "1700000000000_ab12cd34.pdf", name: "报告.pdf", size: 1 }];
    table.records = [record];

    const csv = bitableTableCsv(table);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM：Windows Excel 中文不乱码
    expect(csv).toContain("\r\n");          // CRLF
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe([primary.name, "标签", "启用", "附件"].join(","));
    expect(lines[1]).toBe('"带,逗号","甲, 乙",TRUE,报告.pdf'); // 逗号值加引号 / 多值 ", " / 布尔 TRUE / 附件出展示名
    expect(csv).not.toContain("1700000000000_ab12cd34.pdf");   // 磁盘名绝不外显
  });

  it("RFC 4180 转义：引号双写", () => {
    const table = createDefaultBitableTable("t");
    table.fields.push(createBitableField("text", "备注"));
    const record = createBitableRecord();
    record.values[table.fields[1].id] = '说 "你好"';
    table.records = [record];
    const lines = bitableTableCsv(table).replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[1]).toBe(',"说 ""你好"""'); // 主字段空 + 备注引号双写
  });

  it("attachmentLabel 覆盖：压缩包导出时单元格指向归档内相对路径", () => {
    const table = createDefaultBitableTable("名单");
    const att = createBitableField("attachment", "附件");
    table.fields.push(att);
    const record = createBitableRecord();
    record.values[att.id] = [
      { file: "1700000000000_ab12cd34.pdf", name: "报告.pdf", size: 1 },
      { file: "1700000000001_cd34ef56.pdf", name: "报告.pdf", size: 1 },
    ];
    table.records = [record];
    const lines = bitableTableCsv(table, undefined, { attachmentLabel: (a) => "附件/" + a.name })
      .replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[1]).toBe(',"附件/报告.pdf, 附件/报告.pdf"');
  });
});

describe("CSV 解析（RFC 4180 + BOM）", () => {
  it("引号 / 字段内换行 / 双写引号 / CRLF/LF / 尾行 / BOM", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("\uFEFFa,b")).toEqual([["a", "b"]]);
    expect(parseCsv('"a,b",c')).toEqual([["a,b", "c"]]);
    expect(parseCsv('"line1\nline2",x')).toEqual([["line1\nline2", "x"]]);
    expect(parseCsv('"he said ""hi""",y')).toEqual([['he said "hi"', "y"]]);
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,")).toEqual([["a", ""]]);
  });
});

describe("CSV 导入映射与类型转换", () => {
  it("defaultCsvMapping：同名匹配，未知列忽略", () => {
    const table = createDefaultBitableTable("t");
    const num = createBitableField("number", "数量");
    table.fields.push(num);
    const mapping = defaultCsvMapping(table, ["数量", "不存在"]);
    expect(mapping[0].target).toEqual({ kind: "field", fieldId: num.id });
    expect(mapping[1].target).toEqual({ kind: "skip" });
  });

  it("coerceCsvCell：正确值通过，坏值给原因", () => {
    const number = createBitableField("number", "n");
    const rating = createBitableField("rating", "r");
    const progress = createBitableField("progress", "p");
    const bool = createBitableField("boolean", "b");
    const date = createBitableField("date", "d");
    const select = createBitableField("select", "s");
    select.options = [{ id: "o1", name: "甲" }];
    const multi = createBitableField("multiSelect", "m");
    multi.options = [{ id: "o1", name: "甲" }, { id: "o2", name: "乙" }];

    expect(coerceCsvCell(number, "12")).toEqual({ ok: true, value: 12 });
    expect(coerceCsvCell(number, "x").ok).toBe(false);
    expect(coerceCsvCell(rating, "3")).toEqual({ ok: true, value: 3 });
    expect(coerceCsvCell(rating, "9").ok).toBe(false);
    expect(coerceCsvCell(progress, "150").ok).toBe(false);
    expect(coerceCsvCell(bool, "是")).toEqual({ ok: true, value: true });
    expect(coerceCsvCell(bool, "maybe").ok).toBe(false);
    expect(coerceCsvCell(date, "2026-01-02")).toEqual({ ok: true, value: "2026-01-02" });
    expect(coerceCsvCell(date, "2026/1/2").ok).toBe(false);
    expect(coerceCsvCell(select, "甲")).toEqual({ ok: true, value: "o1" });
    expect(coerceCsvCell(select, "丙").ok).toBe(false);
    expect(coerceCsvCell(multi, "甲, 乙")).toEqual({ ok: true, value: ["o1", "o2"] });
    expect(coerceCsvCell(multi, "丙").ok).toBe(false);
  });

  it("importCsvRows：追加记录、坏格丢弃、全空行跳过、可新建文本列", () => {
    const table = createDefaultBitableTable("t");
    const num = createBitableField("number", "数量");
    table.fields.push(num);
    const doc = parseBitableBody(bitablesToBody([table], table.id))!;
    const rows = [["文本", "数量", "额外"], ["甲", "1", "x"], ["乙", "坏", "y"], ["", "", ""]];
    const mapping: CsvColumnMapping[] = [
      { column: 0, target: { kind: "field", fieldId: table.fields[0].id } },
      { column: 1, target: { kind: "field", fieldId: num.id } },
      { column: 2, target: { kind: "new", type: "text" } },
    ];
    const result = importCsvRows(doc, table.id, rows, mapping, { hasHeader: true });
    expect(result.added).toBe(2);        // 甲、乙（乙的坏「数量」只丢该格）
    expect(result.droppedCells).toBe(1); // 乙的「坏」数量
    expect(result.droppedRows).toBe(1);  // 全空行
    const next = result.doc.tables.find((t) => t.id === table.id)!;
    expect(next.fields.some((f) => f.name === "额外" && f.type === "text")).toBe(true); // 新建文本列
    const imported = next.records[next.records.length - 2];
    expect(imported.values[num.id]).toBe(1);
    const second = next.records[next.records.length - 1];
    expect(second.values[num.id]).toBeUndefined(); // 坏格未写入
  });
});
