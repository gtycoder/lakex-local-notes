import { describe, expect, it } from "vitest";
import { submitMobileForm } from "./mobileBitableForm";
import { createBitableField, createBitableView, createDefaultBitableTable, type BitableDoc } from "../../core/bitableDoc";

// 表单的题目/必填/默认值语义已上收 src/core/bitableForm.ts（两端共用，见 bitableForm.test.ts）；
// 这里只验移动端的「提交 = 新增一条记录」这条接线。

function docOf() {
  const table = createDefaultBitableTable("收集表");
  table.id = "t1";
  table.fields = [
    { ...createBitableField("select", "类型", "f-type"), required: true, options: [{ id: "o1", name: "复盘" }] },
    { ...createBitableField("text", "内容", "f-content"), required: true },
    { ...createBitableField("date", "日期", "f-date"), defaultValue: "2026-10-30" },
  ];
  const grid = createBitableView("grid", "内容", "v-grid");
  const form = { ...createBitableView("form", "表单", "v-form"), formFieldIds: ["f-type", "f-content", "f-date"] };
  table.views = [grid, form];
  table.activeViewId = "v-grid";
  table.records = [];
  const doc: BitableDoc = { kind: "bitable", version: 1, tables: [table], activeTableId: "t1" };
  return { doc };
}

describe("移动端表单提交接线", () => {
  it("提交 = 表新增一条记录：默认值补齐、未知键丢弃、记录数 +1", () => {
    const { doc } = docOf();
    const before = doc.tables[0].records.length;
    const result = submitMobileForm(doc, "t1", { "f-type": "o1", "f-content": "一条内容", ghost: "x" });
    expect(result.doc).not.toBe(doc);
    expect(result.doc.tables[0].records.length).toBe(before + 1);
    const record = result.doc.tables[0].records.find((r) => r.id === result.recordId)!;
    expect(record.values["f-content"]).toBe("一条内容");
    expect(record.values["f-date"]).toBe("2026-10-30");
    expect("ghost" in record.values).toBe(false);
    expect(doc.tables[0].records.length).toBe(before); // 原 doc 不被就地修改
  });

  it("表不存在时原样返回（不抛错）", () => {
    const { doc } = docOf();
    expect(submitMobileForm(doc, "gone", {}).doc).toBe(doc);
    expect(submitMobileForm(doc, "gone", {}).recordId).toBe("");
  });
});
