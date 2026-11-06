import { describe, expect, it } from "vitest";
import {
  applyBitableViewOrder,
  moveViewIds,
  reorderBitableViewsByDrag,
} from "./mobileBitableViewOrder";
import { bitablesToBody, createBitableView, createDefaultBitableTable, parseBitableBody, type BitableDoc } from "../../core/bitableDoc";

/** 三个视图的文档：grid / kanban / gallery（顺序 = a, b, c）。 */
function docWithThreeViews(): BitableDoc {
  const table = createDefaultBitableTable("数据表 1", "tbl_a");
  const views = [
    createBitableView("grid", "表格", "vew_a"),
    createBitableView("kanban", "看板", "vew_b"),
    createBitableView("gallery", "画册", "vew_c"),
  ];
  return {
    kind: "bitable",
    version: 1,
    activeTableId: table.id,
    tables: [{ ...table, views, activeViewId: views[0].id }],
  } as BitableDoc;
}

const idsOf = (doc: BitableDoc) => doc.tables[0].views.map((view) => view.id);

describe("moveViewIds（拖拽落点 → 新顺序，纯逻辑）", () => {
  const ids = ["vew_a", "vew_b", "vew_c"] as const;

  it("往后拖：after 目标 = 插到目标之后（a 拖到 b 后面）", () => {
    expect(moveViewIds(ids, "vew_a", "vew_b", "after")).toEqual(["vew_b", "vew_a", "vew_c"]);
    expect(moveViewIds(ids, "vew_a", "vew_c", "after")).toEqual(["vew_b", "vew_c", "vew_a"]);
  });

  it("往前拖：before 目标 = 插到目标之前（c 拖到 a 前面）", () => {
    expect(moveViewIds(ids, "vew_c", "vew_a", "before")).toEqual(["vew_c", "vew_a", "vew_b"]);
    expect(moveViewIds(ids, "vew_b", "vew_a", "before")).toEqual(["vew_b", "vew_a", "vew_c"]);
  });

  it("落回原位 / 非法输入 ⇒ 返回原数组引用（调用方据此短路，不写盘）", () => {
    expect(moveViewIds(ids, "vew_a", "vew_b", "before")).toBe(ids);
    expect(moveViewIds(ids, "vew_b", "vew_a", "after")).toBe(ids);
    expect(moveViewIds(ids, "vew_a", "vew_a", "after")).toBe(ids);
    expect(moveViewIds(ids, "vew_x", "vew_b", "after")).toBe(ids);
    expect(moveViewIds(ids, "vew_a", "vew_x", "after")).toBe(ids);
  });
});

describe("applyBitableViewOrder（顺序写回文档 = 文档数据）", () => {
  it("按给定顺序重排 views；activeViewId / records / fields 不动", () => {
    const doc = docWithThreeViews();
    const next = applyBitableViewOrder(doc, "tbl_a", ["vew_c", "vew_a", "vew_b"]);
    expect(idsOf(next)).toEqual(["vew_c", "vew_a", "vew_b"]);
    expect(next.tables[0].activeViewId).toBe(doc.tables[0].activeViewId);
    expect(next.tables[0].records).toBe(doc.tables[0].records);
    expect(next.tables[0].fields).toBe(doc.tables[0].fields);
    expect(next.activeTableId).toBe(doc.activeTableId);
    // 原文档不被就地修改（纯变换）
    expect(idsOf(doc)).toEqual(["vew_a", "vew_b", "vew_c"]);
  });

  it("顺序没变 ⇒ 返回原 doc 引用（commit 靠引用判「无变化」）", () => {
    const doc = docWithThreeViews();
    expect(applyBitableViewOrder(doc, "tbl_a", ["vew_a", "vew_b", "vew_c"])).toBe(doc);
    expect(applyBitableViewOrder(doc, "tbl_missing", ["vew_c"])).toBe(doc);
  });

  it("防御：认不出的 id 忽略、没列到的视图按原相对顺序追加在末尾（任何情况下不丢视图）", () => {
    const doc = docWithThreeViews();
    expect(idsOf(applyBitableViewOrder(doc, "tbl_a", ["vew_x", "vew_b"]))).toEqual(["vew_b", "vew_a", "vew_c"]);
    expect(idsOf(applyBitableViewOrder(doc, "tbl_a", []))).toEqual(["vew_a", "vew_b", "vew_c"]);
  });
});

describe("落盘 → 重开（顺序写在正文里，重开按正文顺序）", () => {
  it("重排后序列化的正文再解析回来，views 顺序保持（刷新/重开不变）", () => {
    const doc = docWithThreeViews();
    const next = reorderBitableViewsByDrag(doc, "tbl_a", "vew_a", "vew_c", "after");
    const body = bitablesToBody(next.tables, next.activeTableId);
    const reopened = parseBitableBody(body);
    expect(reopened).not.toBeNull();
    expect(reopened!.tables[0].views.map((view) => view.id)).toEqual(["vew_b", "vew_c", "vew_a"]);
    // 只有 views 顺序变：正文里表/记录/字段与改前一致（不是"顺手写脏"）
    const before = parseBitableBody(bitablesToBody(doc.tables, doc.activeTableId))!;
    expect(reopened!.tables[0].records).toEqual(before.tables[0].records);
    expect(reopened!.tables[0].fields).toEqual(before.tables[0].fields);
  });
});

describe("reorderBitableViewsByDrag（一次拖拽的完整纯变换）", () => {
  it("往下拖一格：a 拖到 b 之后 ⇒ [b, a, c]；无变化时原引用", () => {
    const doc = docWithThreeViews();
    expect(idsOf(reorderBitableViewsByDrag(doc, "tbl_a", "vew_a", "vew_b", "after"))).toEqual(["vew_b", "vew_a", "vew_c"]);
    expect(reorderBitableViewsByDrag(doc, "tbl_a", "vew_a", "vew_b", "before")).toBe(doc);
    expect(reorderBitableViewsByDrag(doc, "tbl_missing", "vew_a", "vew_b", "after")).toBe(doc);
  });
});
