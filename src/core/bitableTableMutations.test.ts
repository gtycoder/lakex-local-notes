import { describe, expect, it } from "vitest";
import { deleteBitableTable, duplicateBitableTable, renameBitableTable } from "./bitableMutations";
import { createBitableField, createBitableRecord, createBitableView, createDefaultBitableTable, type BitableDoc } from "./bitableDoc";

const ts = "2026-09-01T00:00:00.000Z";

function docOf(): BitableDoc {
  const t1 = createDefaultBitableTable("观点收集", "t1");
  t1.fields = [
    createBitableField("text", "内容", "f1"),
    { ...createBitableField("select", "类型", "f2"), options: [{ id: "o1", name: "复盘", color: "green" }] },
    { ...createBitableField("relationOneWay", "关联", "f3"), relation: { tableId: "t2", allowMultiple: true, pairedFieldId: "f9" } },
    createBitableField("date", "日期", "f4"),
  ];
  t1.views = [
    { ...createBitableView("grid", "内容", "v1"), groups: [{ fieldId: "f4" }], hiddenFieldIds: ["f1"] },
    { ...createBitableView("kanban", "看板", "v2"), kanbanGroupFieldId: "f2", kanbanFieldIds: ["f1"] },
  ];
  t1.activeViewId = "v2";
  t1.records = [
    { ...createBitableRecord("r1"), createdAt: ts, updatedAt: ts, values: { f1: "内容一", f2: "o1", f3: ["d1"], f4: "2026-06-09" } },
  ];
  const t2 = createDefaultBitableTable("目标表", "t2");
  t2.fields = [createBitableField("text", "名称", "f9")];
  t2.records = [{ ...createBitableRecord("d1"), createdAt: ts, updatedAt: ts, values: { f9: "目标甲" } }];
  return { kind: "bitable", version: 1, tables: [t1, t2], activeTableId: "t1" };
}

describe("数据表级写入（重命名 / 删除 / 复制，两端共用）", () => {
  it("重命名：去空格；空名/无变化/表不存在都返回原引用", () => {
    const doc = docOf();
    const renamed = renameBitableTable(doc, "t1", "  新名字  ");
    expect(renamed).not.toBe(doc);
    expect(renamed.tables[0].name).toBe("新名字");
    expect(renameBitableTable(doc, "t1", "   ")).toBe(doc);
    expect(renameBitableTable(doc, "t1", "观点收集")).toBe(doc);
    expect(renameBitableTable(doc, "gone", "x")).toBe(doc);
  });

  it("删除：至少保留一张；删活动表回落到第一张", () => {
    const doc = docOf();
    expect(deleteBitableTable(doc, "t1").tables.map((t) => t.id)).toEqual(["t2"]);
    expect(deleteBitableTable(doc, "t1").activeTableId).toBe("t2");
    expect(deleteBitableTable(doc, "t2").activeTableId).toBe("t1");
    const one = { ...doc, tables: [doc.tables[0]] };
    expect(deleteBitableTable(one, "t1")).toBe(one);
    expect(deleteBitableTable(doc, "gone")).toBe(doc);
  });

  it("复制：新 id、名称加副本、记录值按新字段 id、视图字段引用换新 id、关联清值去配对", () => {
    const doc = docOf();
    const { doc: next, tableId } = duplicateBitableTable(doc, "t1");
    expect(next.tables.length).toBe(3);
    const copy = next.tables.find((t) => t.id === tableId)!;
    expect(copy.name).toBe("观点收集 副本");
    expect(copy.id).not.toBe("t1");
    const oldIds = doc.tables[0].fields.map((f) => f.id);
    const newIds = copy.fields.map((f) => f.id);
    expect(newIds.some((id) => oldIds.includes(id))).toBe(false);
    // 记录值跟着新字段 id 走（非关联字段）
    const record = copy.records[0];
    const contentField = copy.fields[0];
    const typeField = copy.fields[1];
    expect(record.values[contentField.id]).toBe("内容一");
    expect(record.values[typeField.id]).toBe("o1");
    // 关联字段：清空值 + 去掉双向配对
    const relationCopy = copy.fields[2];
    expect(relationCopy.relation?.pairedFieldId).toBeUndefined();
    expect(record.values[relationCopy.id]).toBeUndefined();
    // 视图配置的字段引用换 id：看板分组 = 新 f2；分组/隐藏也换
    const kanban = copy.views.find((v) => v.type === "kanban")!;
    expect(kanban.kanbanGroupFieldId).toBe(typeField.id);
    expect(copy.activeViewId).toBe(kanban.id);
    const grid = copy.views.find((v) => v.type === "grid")!;
    expect(grid.groups?.[0].fieldId).toBe(copy.fields[3].id);
    expect(grid.hiddenFieldIds).toEqual([contentField.id]);
    // 原表不动
    expect(doc.tables.length).toBe(2);
  });

  it("复制不存在的表：原样返回（不抛错）", () => {
    const doc = docOf();
    expect(duplicateBitableTable(doc, "gone")).toEqual({ doc, tableId: "" });
  });
});
