import { describe, expect, it } from "vitest";
import { applyBitableFieldOrder, reorderBitableFieldsByDrag } from "./mobileBitableFieldOrder";
import {
  createBitableField,
  createBitableView,
  createDefaultBitableTable,
  orderedAllTableFields,
  orderedTableFields,
  type BitableDoc,
} from "../../core/bitableDoc";

/** 四个字段的文档（顺序 a,b,c,d），两个视图：主视图 vew_main + 备用视图 vew_alt。 */
function docWithFields(): BitableDoc {
  const table = createDefaultBitableTable("数据表 1", "tbl_a");
  const fields = [
    createBitableField("text", "甲", "fld_a"),
    createBitableField("number", "乙", "fld_b"),
    createBitableField("date", "丙", "fld_c"),
    createBitableField("text", "丁", "fld_d"),
  ];
  const main = createBitableView("grid", "表格", "vew_main");
  const alt = createBitableView("grid", "备用", "vew_alt");
  return {
    kind: "bitable",
    version: 1,
    activeTableId: table.id,
    tables: [{ ...table, fields, views: [main, alt], activeViewId: main.id }],
  } as BitableDoc;
}

const orderOf = (doc: BitableDoc, viewId = "vew_main"): string[] => {
  const table = doc.tables[0];
  return orderedAllTableFields(table, table.views.find((view) => view.id === viewId)).map((field) => field.id);
};

describe("applyBitableFieldOrder（列顺序 = 视图级配置）", () => {
  it("只写当前视图的 fieldOrder：全局字段顺序与其它视图都不动", () => {
    const doc = docWithFields();
    const next = applyBitableFieldOrder(doc, "tbl_a", "vew_main", ["fld_c", "fld_a", "fld_b", "fld_d"]);
    expect(orderOf(next)).toEqual(["fld_c", "fld_a", "fld_b", "fld_d"]);
    // 全局 fields 数组一字不动（列顺序是视图级配置）
    expect(next.tables[0].fields).toBe(doc.tables[0].fields);
    // 另一个视图不跟排（无 fieldOrder ⇒ 原顺序）
    expect(orderOf(next, "vew_alt")).toEqual(["fld_a", "fld_b", "fld_c", "fld_d"]);
    // 原 doc 不被就地修改
    expect(orderOf(doc)).toEqual(["fld_a", "fld_b", "fld_c", "fld_d"]);
  });

  it("隐藏字段参与排序但保持隐藏（orderedTableFields 仍剔除它）", () => {
    const base = docWithFields();
    const hidden = {
      ...base,
      tables: base.tables.map((table) => ({
        ...table,
        views: table.views.map((view) => (view.id === "vew_main" ? { ...view, hiddenFieldIds: ["fld_b"] } : view)),
      })),
    };
    const next = applyBitableFieldOrder(hidden, "tbl_a", "vew_main", ["fld_b", "fld_d", "fld_c", "fld_a"]);
    expect(orderOf(next)).toEqual(["fld_b", "fld_d", "fld_c", "fld_a"]);
    expect(orderedTableFields(next.tables[0], next.tables[0].views[0]).map((f) => f.id)).toEqual(["fld_d", "fld_c", "fld_a"]);
  });

  it("防御：未知 id 忽略、漏列字段按原相对顺序追加末尾（任何情况下不丢字段）", () => {
    const doc = docWithFields();
    const next = applyBitableFieldOrder(doc, "tbl_a", "vew_main", ["fld_x", "fld_c", "fld_a", "fld_c"]);
    expect(orderOf(next)).toEqual(["fld_c", "fld_a", "fld_b", "fld_d"]);
  });

  it("顺序未变 / 表或视图不存在 ⇒ 返回原 doc 引用（不产生空写入）", () => {
    const doc = docWithFields();
    expect(applyBitableFieldOrder(doc, "tbl_a", "vew_main", ["fld_a", "fld_b", "fld_c", "fld_d"])).toBe(doc);
    expect(applyBitableFieldOrder(doc, "tbl_x", "vew_main", ["fld_c"])).toBe(doc);
    expect(applyBitableFieldOrder(doc, "tbl_a", "vew_x", ["fld_c"])).toBe(doc);
  });
});

describe("reorderBitableFieldsByDrag（一次拖拽 → 新 fieldOrder）", () => {
  it("拖到目标前/后按行中线落位（与视图拖拽同一槽位判据）", () => {
    const doc = docWithFields();
    const before = reorderBitableFieldsByDrag(doc, "tbl_a", "vew_main", "fld_d", "fld_a", "before");
    expect(orderOf(before)).toEqual(["fld_d", "fld_a", "fld_b", "fld_c"]);
    const after = reorderBitableFieldsByDrag(doc, "tbl_a", "vew_main", "fld_a", "fld_c", "after");
    expect(orderOf(after)).toEqual(["fld_b", "fld_c", "fld_a", "fld_d"]);
  });

  it("已有 fieldOrder 时在其基础上重排（不回退到全局顺序）", () => {
    const base = applyBitableFieldOrder(docWithFields(), "tbl_a", "vew_main", ["fld_c", "fld_a", "fld_b", "fld_d"]);
    const next = reorderBitableFieldsByDrag(base, "tbl_a", "vew_main", "fld_d", "fld_c", "before");
    expect(orderOf(next)).toEqual(["fld_d", "fld_c", "fld_a", "fld_b"]);
  });

  it("落回原位 / 拖到自己 ⇒ 原 doc 引用（commit 不写盘）", () => {
    const doc = docWithFields();
    expect(reorderBitableFieldsByDrag(doc, "tbl_a", "vew_main", "fld_a", "fld_b", "before")).toBe(doc);
    expect(reorderBitableFieldsByDrag(doc, "tbl_a", "vew_main", "fld_b", "fld_a", "after")).toBe(doc);
    expect(reorderBitableFieldsByDrag(doc, "tbl_a", "vew_main", "fld_a", "fld_a", "after")).toBe(doc);
    expect(reorderBitableFieldsByDrag(doc, "tbl_a", "vew_main", "fld_x", "fld_a", "after")).toBe(doc);
  });
});
