import { describe, expect, it } from "vitest";
import {
  bitableFormDraftDefaults,
  bitableFormFields,
  bitableFormValues,
  formableBitableFields,
  missingRequiredBitableFields,
} from "./bitableForm";
import { createBitableField, createBitableView, createDefaultBitableTable, type BitableView } from "./bitableDoc";

function tableOf() {
  const table = createDefaultBitableTable("收集表");
  table.fields = [
    { ...createBitableField("select", "类型", "f-type"), required: true, options: [{ id: "o1", name: "复盘" }] },
    { ...createBitableField("text", "内容", "f-content"), required: true },
    createBitableField("attachment", "附件", "f-file"),
    { ...createBitableField("date", "日期", "f-date"), defaultValue: "2026-10-30" },
    createBitableField("createdTime", "创建时间", "f-created"),
    createBitableField("ai", "AI 摘要", "f-ai"),
  ];
  const grid = createBitableView("grid", "内容", "v-grid");
  const form: BitableView = { ...createBitableView("form", "表单", "v-form"), formFieldIds: ["f-type", "f-content", "f-date"] };
  table.views = [grid, form];
  table.activeViewId = grid.id;
  return { table, grid, form };
}

describe("bitableForm（两端共用的表单语义）", () => {
  it("可填写字段排除系统时间与 AI；题目顺序 = formFieldIds", () => {
    const { table, grid, form } = tableOf();
    expect(formableBitableFields(table).map((f) => f.id)).toEqual(["f-type", "f-content", "f-file", "f-date"]);
    expect(bitableFormFields(table, form).map((f) => f.id)).toEqual(["f-type", "f-content", "f-date"]);
    // 未配置 = 全部可填写字段
    expect(bitableFormFields(table, grid).map((f) => f.id)).toEqual(["f-type", "f-content", "f-file", "f-date"]);
    // 配了但全部失效 ⇒ 回落全量（不渲染空表单）
    expect(bitableFormFields(table, { ...form, formFieldIds: ["gone", "gone2"] }).map((f) => f.id))
      .toEqual(["f-type", "f-content", "f-file", "f-date"]);
  });

  it("必填校验按展示值判空", () => {
    const { table, form } = tableOf();
    const fields = bitableFormFields(table, form);
    expect(missingRequiredBitableFields(fields, {}).map((f) => f.id)).toEqual(["f-type", "f-content"]);
    expect(missingRequiredBitableFields(fields, { "f-type": "o1", "f-content": "  " }).map((f) => f.id)).toEqual(["f-content"]);
    expect(missingRequiredBitableFields(fields, { "f-type": "o1", "f-content": "写完" })).toEqual([]);
  });

  it("提交值 = 默认值 + 草稿；未知键丢弃；不就地改入参", () => {
    const { table } = tableOf();
    const draft = { "f-type": "o1", "f-content": "一条", ghost: "x" };
    const values = bitableFormValues(table, draft);
    expect(values["f-date"]).toBe("2026-10-30");
    expect(values["f-type"]).toBe("o1");
    expect("ghost" in values).toBe(false);
    expect(draft).toEqual({ "f-type": "o1", "f-content": "一条", ghost: "x" });
  });

  it("草稿默认值来自字段默认值（与提交值同源）", () => {
    const { table } = tableOf();
    expect(bitableFormDraftDefaults(table)["f-date"]).toBe("2026-10-30");
  });
});
