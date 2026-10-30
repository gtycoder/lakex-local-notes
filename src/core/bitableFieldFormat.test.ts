import { describe, expect, it } from "vitest";
import {
  bitableDisplayValue,
  createBitableField,
  createBitableRecord,
  createBitableView,
  createDefaultBitableTable,
  formatBitableDate,
  formatBitableNumber,
  type BitableDoc,
} from "./bitableDoc";
import { convertBitableFieldType, fieldHasData, updateBitableField } from "./bitableMutations";

const ts = "2026-09-01T00:00:00.000Z";

describe("字段显示格式（261030）", () => {
  it("日期四种格式；非法输入原样", () => {
    expect(formatBitableDate("2026-06-09", "")).toBe("2026-06-09");
    expect(formatBitableDate("2026-06-09", "slash")).toBe("2026/06/09");
    expect(formatBitableDate("2026-06-09", "md")).toBe("6月9日");
    expect(formatBitableDate("2026-06-09", "cny")).toBe("2026年6月9日");
    expect(formatBitableDate("not-a-date", "md")).toBe("not-a-date");
    expect(formatBitableDate("2026-06-09T10:00:00.000Z", "slash")).toBe("2026/06/09");
  });

  it("数字千分位与固定小数；非法数字原样", () => {
    expect(formatBitableNumber(1234.5, "")).toBe("1234.5");
    expect(formatBitableNumber(1234.5, "thousands")).toBe("1,234.5");
    expect(formatBitableNumber(2, "decimal0")).toBe("2");
    expect(formatBitableNumber(2, "decimal2")).toBe("2.00");
    expect(formatBitableNumber("abc", "thousands")).toBe("abc");
    expect(formatBitableNumber("1,234", "decimal1")).toBe("1,234.0");
  });

  it("bitableDisplayValue 走字段 format；未设 format 维持旧行为", () => {
    const date = { ...createBitableField("date", "日期", "f"), format: "md" };
    expect(bitableDisplayValue(date, "2026-06-09")).toBe("6月9日");
    const num = { ...createBitableField("number", "数字", "g"), format: "thousands" };
    expect(bitableDisplayValue(num, 1234567)).toBe("1,234,567");
    expect(bitableDisplayValue(createBitableField("date", "日期", "h"), "2026-06-09")).toBe("2026-06-09");
  });

  it("updateBitableField 可设/清 format；无变化原引用", () => {
    const table = createDefaultBitableTable("表", "t1");
    table.fields = [createBitableField("number", "数字", "f")];
    const doc: BitableDoc = { kind: "bitable", version: 1, tables: [table], activeTableId: "t1" };
    const next = updateBitableField(doc, "t1", "f", { format: "decimal2" });
    expect(next.tables[0].fields[0].format).toBe("decimal2");
    const cleared = updateBitableField(next, "t1", "f", { format: undefined });
    expect(cleared.tables[0].fields[0].format).toBeUndefined();
    expect(updateBitableField(cleared, "t1", "f", { format: undefined })).toBe(cleared);
  });
});

describe("字段类型互转（有数据不能转）", () => {
  function docWith(fieldValue: unknown): BitableDoc {
    const table = createDefaultBitableTable("表", "t1");
    table.fields = [
      { ...createBitableField("select", "类型", "f"), required: true, width: 160, options: [{ id: "o1", name: "复盘", color: "green" }] },
      createBitableField("date", "日期", "d"),
    ];
    table.views = [
      { ...createBitableView("kanban", "看板", "v1"), kanbanGroupFieldId: "f" },
      { ...createBitableView("calendar", "日历", "v2"), calendarStartFieldId: "d" },
    ];
    table.records = [{ ...createBitableRecord("r1"), createdAt: ts, updatedAt: ts, values: fieldValue === undefined ? {} : { f: fieldValue } }];
    return { kind: "bitable", version: 1, tables: [table], activeTableId: "t1" };
  }

  it("无数据可转：保留 id/名称/必填/列宽，旧选项丢弃，失效视图引用清掉", () => {
    const doc = docWith(undefined);
    expect(fieldHasData(doc.tables[0], "f")).toBe(false);
    const result = convertBitableFieldType(doc, "t1", "f", "text");
    expect(result.ok).toBe(true);
    const field = result.doc.tables[0].fields.find((x) => x.id === "f")!;
    expect(field.type).toBe("text");
    expect(field.name).toBe("类型");
    expect(field.required).toBe(true);
    expect(field.width).toBe(160);
    expect(field.options).toBeUndefined();
    // 看板分组引用了旧单选字段 ⇒ 转成文本后必须清掉
    expect(result.doc.tables[0].views[0].kanbanGroupFieldId).toBeUndefined();
    // 未涉及的日期视图引用保持
    expect(result.doc.tables[0].views[1].calendarStartFieldId).toBe("d");
  });

  it("有数据（含 false / 0 / 非空串 / 非空数组）一律拒绝；空串/空数组不算", () => {
    for (const value of ["x", 0, false, ["o1"]]) {
      const doc = docWith(value);
      const result = convertBitableFieldType(doc, "t1", "f", "text");
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("has-data");
      expect(result.doc).toBe(doc);
    }
    expect(convertBitableFieldType(docWith(""), "t1", "f", "text").ok).toBe(true);
    expect(convertBitableFieldType(docWith([]), "t1", "f", "text").ok).toBe(true);
    expect(fieldHasData(docWith("").tables[0], "f")).toBe(false);
    expect(fieldHasData(docWith(false).tables[0], "f")).toBe(true);
    expect(fieldHasData(docWith(0).tables[0], "f")).toBe(true);
  });

  it("同类型/未知类型/字段不存在：明确结果，不抛错", () => {
    const doc = docWith(undefined);
    expect(convertBitableFieldType(doc, "t1", "f", "select")).toEqual({ doc, ok: true });
    expect(convertBitableFieldType(doc, "t1", "f", "nope").reason).toBe("unknown-type");
    expect(convertBitableFieldType(doc, "t1", "gone", "text").reason).toBe("missing");
  });
});
