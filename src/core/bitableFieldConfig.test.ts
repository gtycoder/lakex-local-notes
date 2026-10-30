import { describe, expect, it } from "vitest";
import { updateBitableField } from "./bitableMutations";
import { createBitableField, createBitableRecord, createDefaultBitableTable, type BitableDoc } from "./bitableDoc";

function docOf(): BitableDoc {
  const table = createDefaultBitableTable("表", "t1");
  table.fields = [
    { ...createBitableField("date", "日期", "f-date"), defaultValue: "2026-06-09" },
    { ...createBitableField("select", "类型", "f-type"), options: [{ id: "o1", name: "复盘", color: "green" }] },
    createBitableField("text", "内容", "f-text"),
  ];
  return { kind: "bitable", version: 1, tables: [table], activeTableId: "t1" };
}

describe("updateBitableField（移动端修改字段的 core 语义）", () => {
  it("改名 + 改默认值 + 必填；无变化返回原引用", () => {
    const doc = docOf();
    const next = updateBitableField(doc, "t1", "f-date", { name: "截止日", defaultValue: "2026-07-01", required: true });
    const field = next.tables[0].fields.find((x) => x.id === "f-date")!;
    expect(field.name).toBe("截止日");
    expect(field.defaultValue).toBe("2026-07-01");
    expect(field.required).toBe(true);
    expect(updateBitableField(next, "t1", "f-date", { name: "截止日", defaultValue: "2026-07-01", required: true })).toBe(next);
  });

  it("日期三态：created 只写 dateAutoFill；显式 undefined 清空默认值", () => {
    const doc = docOf();
    const created = updateBitableField(doc, "t1", "f-date", { dateAutoFill: true, defaultValue: undefined });
    const field = created.tables[0].fields.find((x) => x.id === "f-date")!;
    expect(field.dateAutoFill).toBe(true);
    expect(field.defaultValue).toBeUndefined();
    const cleared = updateBitableField(created, "t1", "f-date", { dateAutoFill: false });
    expect(cleared.tables[0].fields.find((x) => x.id === "f-date")!.dateAutoFill).toBeUndefined();
  });

  it("删选项时清掉记录里的引用（不显示裸 id）；多选过滤保留仍存在的", () => {
    const table = createDefaultBitableTable("表", "t1");
    table.fields = [
      { ...createBitableField("select", "类型", "f-sel"), options: [{ id: "o1", name: "A", color: "green" }, { id: "o2", name: "B", color: "blue" }] },
      { ...createBitableField("multiSelect", "多选", "f-multi"), options: [{ id: "m1", name: "M1", color: "green" }, { id: "m2", name: "M2", color: "blue" }] },
    ];
    table.records = [
      { ...createBitableRecord("r1"), createdAt: "t", updatedAt: "t", values: { "f-sel": "o1", "f-multi": ["m1", "m2"] } },
    ];
    const doc: BitableDoc = { kind: "bitable", version: 1, tables: [table], activeTableId: "t1" };
    const next = updateBitableField(doc, "t1", "f-sel", { options: [{ id: "o2", name: "B", color: "blue" }] });
    expect(next.tables[0].records[0].values["f-sel"]).toBeUndefined();
    const multi = updateBitableField(next, "t1", "f-multi", { options: [{ id: "m2", name: "M2", color: "blue" }] });
    expect(multi.tables[0].records[0].values["f-multi"]).toEqual(["m2"]);
  });

  it("选项整体替换（id 保留）；进度颜色可设可清；字段不存在原样返回", () => {
    const doc = docOf();
    const options = [{ id: "o1", name: "复盘", color: "green" }, { id: "o2", name: "提问", color: "blue" }];
    const next = updateBitableField(doc, "t1", "f-type", { options });
    expect(next.tables[0].fields.find((x) => x.id === "f-type")!.options).toEqual(options);
    const progress = updateBitableField(next, "t1", "f-type", { progressColor: "#3f5fa0" });
    expect(progress.tables[0].fields.find((x) => x.id === "f-type")!.progressColor).toBe("#3f5fa0");
    const cleared = updateBitableField(progress, "t1", "f-type", { progressColor: undefined });
    expect(cleared.tables[0].fields.find((x) => x.id === "f-type")!.progressColor).toBeUndefined();
    expect(updateBitableField(doc, "t1", "gone", { required: true })).toBe(doc);
  });
});
