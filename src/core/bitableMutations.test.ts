import { describe, expect, it } from "vitest";
import {
  BITABLE_DOC_KIND, BITABLE_DOC_VERSION, isBitableFilterGroup,
  type BitableDoc, type BitableField, type BitableRecord, type BitableTable, type BitableView,
} from "./bitableDoc";
import {
  addBitableRecord, addBitableRecordWithValues, appendBitableAttachments, deleteBitableField,
  duplicateBitableField, setBitableCellValue, setBitableRecordValues, stripFieldFromView, stripViewRefsForFieldType,
} from "./bitableMutations";

const T = "2026-09-01T00:00:00.000Z";

function field(id: string, type: BitableField["type"], name = id, extra: Partial<BitableField> = {}): BitableField {
  return { id, name, type, ...extra };
}
function record(id: string, values: Record<string, unknown>): BitableRecord {
  return { id, values, createdAt: T, updatedAt: T };
}
function view(id: string, extra: Partial<BitableView> = {}): BitableView {
  return { id, name: id, type: "grid", ...extra };
}
function table(id: string, fields: BitableField[], records: BitableRecord[], views: BitableView[]): BitableTable {
  return { id, name: id, fields, records, views, activeViewId: views[0]?.id ?? "" };
}
function doc(tables: BitableTable[], activeTableId = tables[0].id): BitableDoc {
  return { kind: BITABLE_DOC_KIND, version: BITABLE_DOC_VERSION, tables, activeTableId };
}

describe("多维表业务写入纯函数（AR02）", () => {
  it("stripFieldFromView：清掉单视图里所有指向该字段的配置，无引用时返回原引用", () => {
    const v = view("v", {
      hiddenFieldIds: ["a", "b"],
      fieldOrder: ["a", "b"],
      formFieldIds: ["a", "b"],
      highlightDuplicateFieldIds: ["a"],
      fillRules: [
        { id: "fl1", mode: "column", color: "#f00", fieldId: "a" },
        { id: "fl2", mode: "cell", color: "#0f0", condition: { id: "c2", fieldId: "b", operator: "contains" } },
      ],
      filters: [
        { id: "f1", fieldId: "a", operator: "contains" },
        { id: "f2", fieldId: "b", operator: "contains" },
        { id: "g1", operator: "and", filters: [{ id: "f3", fieldId: "a", operator: "contains" }, { id: "f4", fieldId: "b", operator: "contains" }] },
        { id: "g2", operator: "and", filters: [{ id: "f5", fieldId: "a", operator: "contains" }] },
      ],
      sorts: [{ fieldId: "a" }, { fieldId: "b" }],
      groups: [{ fieldId: "a" }, { fieldId: "b" }],
      columnStats: { a: "count", b: "sum" },
      columnTextColors: { a: "#111", b: "#222" },
      formDescriptions: { a: "x", b: "y" },
      kanbanGroupFieldId: "a",
      galleryCoverFieldId: "a",
      calendarStartFieldId: "a",
      calendarEndFieldId: "a",
      calendarTitleFieldId: "a",
      calendarColorFieldId: "a",
    });
    const next = stripFieldFromView(v, "a");
    expect(next).not.toBe(v);
    expect(next.hiddenFieldIds).toEqual(["b"]);
    expect(next.fieldOrder).toEqual(["b"]);
    expect(next.formFieldIds).toEqual(["b"]);
    expect(next.highlightDuplicateFieldIds).toEqual([]);
    expect(next.fillRules).toHaveLength(1);
    expect(next.filters?.map((n) => (isBitableFilterGroup(n) ? n.operator : n.fieldId))).toEqual(["b", "and"]);
    const groups = (next.filters ?? []).filter(isBitableFilterGroup);
    expect(groups).toHaveLength(1);
    expect(groups[0].filters).toHaveLength(1);
    expect(next.sorts).toEqual([{ fieldId: "b" }]);
    expect(next.groups).toEqual([{ fieldId: "b" }]);
    expect(next.columnStats).toEqual({ b: "sum" });
    expect(next.columnTextColors).toEqual({ b: "#222" });
    expect(next.formDescriptions).toEqual({ b: "y" });
    expect(next.kanbanGroupFieldId).toBeUndefined();
    expect(next.galleryCoverFieldId).toBeUndefined();
    expect(next.calendarStartFieldId).toBeUndefined();
    expect(next.calendarEndFieldId).toBeUndefined();
    expect(next.calendarTitleFieldId).toBeUndefined();
    expect(next.calendarColorFieldId).toBeUndefined();
    // 再摘一次已无引用：返回原引用（不产生空变更）
    expect(stripFieldFromView(next, "a")).toBe(next);
  });

  it("stripFieldFromView：筛选树整棵只含该字段时删除 filters 键", () => {
    const v = view("v", { filters: [{ id: "f1", fieldId: "a", operator: "contains" }] });
    const next = stripFieldFromView(v, "a");
    expect(next.filters).toBeUndefined();
    expect(stripFieldFromView(v, "z")).toBe(v);
  });

  it("deleteBitableField：移除字段、跨全部视图清配置、并按需解除双向配对", () => {
    const a = field("fld-a", "relationTwoWay", "关联", { relation: { tableId: "t2", allowMultiple: true, pairedFieldId: "fld-rev" } });
    const keep = field("fld-keep", "text", "保留");
    const rev = field("fld-rev", "relationTwoWay", "反向", { relation: { tableId: "t1", allowMultiple: true, pairedFieldId: "fld-a" } });
    const t1 = table("t1", [a, keep], [record("r1", { "fld-a": ["r2-1"] })], [
      view("v1", { hiddenFieldIds: ["fld-a", "fld-keep"], sorts: [{ fieldId: "fld-a" }] }),
      view("v2", { galleryCoverFieldId: "fld-a" }),
    ]);
    const t2 = table("t2", [rev], [record("r2-1", { "fld-rev": ["r1"] })], [view("v2x")]);
    const before = doc([t1, t2]);
    const after = deleteBitableField(before, "t1", "fld-a");
    expect(after).not.toBe(before);
    const nt1 = after.tables[0], nt2 = after.tables[1];
    expect(nt1.fields.map((f) => f.id)).toEqual(["fld-keep"]);
    expect(nt1.views[0].hiddenFieldIds).toEqual(["fld-keep"]);
    expect(nt1.views[0].sorts).toEqual([]);
    expect(nt1.views[1].galleryCoverFieldId).toBeUndefined();
    expect(nt2.fields[0].type).toBe("relationOneWay");
    expect(nt2.fields[0].relation?.pairedFieldId).toBeUndefined();
    expect(nt2.records[0].values["fld-rev"]).toEqual(["r1"]);
  });

  it("deleteBitableField：只剩一个字段 / 目标不存在时返回原 doc", () => {
    const d = doc([table("t1", [field("only", "text")], [], [view("v")])]);
    expect(deleteBitableField(d, "t1", "only")).toBe(d);
    expect(deleteBitableField(d, "nope", "only")).toBe(d);
    expect(deleteBitableField(d, "t1", "nope")).toBe(d);
  });

  it("setBitableCellValue：普通字段写入更新时间；同值/目标不存在返回原 doc", () => {
    const d = doc([table("t1", [field("f", "text")], [record("r", { f: "a" })], [view("v")])]);
    const next = setBitableCellValue(d, "t1", "r", "f", "b");
    expect(next).not.toBe(d);
    expect(next.tables[0].records[0].values.f).toBe("b");
    expect(next.tables[0].records[0].updatedAt).not.toBe(T);
    expect(setBitableCellValue(next, "t1", "r", "f", "b")).toBe(next);
    expect(setBitableCellValue(d, "t1", "nope", "f", "c")).toBe(d);
    expect(setBitableCellValue(d, "t1", "r", "nope", "c")).toBe(d);
  });

  it("setBitableCellValue：双向关联写值镜像到对侧，且相同 id 集合不重复写", () => {
    const a = field("fld-a", "relationTwoWay", "关联", { relation: { tableId: "t2", allowMultiple: true, pairedFieldId: "fld-rev" } });
    const rev = field("fld-rev", "relationTwoWay", "反向", { relation: { tableId: "t1", allowMultiple: true, pairedFieldId: "fld-a" } });
    const d = doc([
      table("t1", [a], [record("r1", { "fld-a": ["r2-1"] })], [view("v1")]),
      table("t2", [rev], [record("r2-1", { "fld-rev": ["r1"] }), record("r2-2", { "fld-rev": [] })], [view("v2")]),
    ]);
    const next = setBitableCellValue(d, "t1", "r1", "fld-a", ["r2-2"]);
    expect(next.tables[0].records[0].values["fld-a"]).toEqual(["r2-2"]);
    expect(next.tables[1].records[0].values["fld-rev"]).toEqual([]);
    expect(next.tables[1].records[1].values["fld-rev"]).toEqual(["r1"]);
    expect(setBitableCellValue(next, "t1", "r1", "fld-a", ["r2-2"])).toBe(next);
  });

  it("setBitableRecordValues：多字段写入；同值/空 patch/目标不存在返回原 doc", () => {
    const d = doc([table("t1", [field("a", "date"), field("b", "date")], [record("r", { a: "2026-09-01" })], [view("v")])]);
    const next = setBitableRecordValues(d, "t1", "r", { a: "2026-09-02", b: "2026-09-03" });
    expect(next.tables[0].records[0].values).toEqual({ a: "2026-09-02", b: "2026-09-03" });
    expect(setBitableRecordValues(next, "t1", "r", { a: "2026-09-02" })).toBe(next);
    expect(setBitableRecordValues(d, "t1", "r", {})).toBe(d);
    expect(setBitableRecordValues(d, "t1", "nope", { a: "x" })).toBe(d);
  });

  it("appendBitableAttachments：追加条目；空条目/目标不存在返回原 doc", () => {
    const d = doc([table("t1", [field("att", "attachment")], [record("r", {})], [view("v")])]);
    const entry = { file: "1790000000000_ab12cd34.png", name: "图片.png", size: 12 };
    const next = appendBitableAttachments(d, "t1", "r", "att", [entry]);
    expect(next.tables[0].records[0].values.att).toEqual([entry]);
    expect(appendBitableAttachments(next, "t1", "r", "att", [])).toBe(next);
    expect(appendBitableAttachments(d, "t1", "nope", "att", [entry])).toBe(d);
    expect(appendBitableAttachments(d, "t1", "r", "nope", [entry])).toBe(d);
  });

  it("addBitableRecord：按默认值新增并可预置分组字段；表不存在返回原 doc", () => {
    const sel = field("sel", "select", "状态", { defaultValue: "o1" });
    const d = doc([table("t1", [field("txt", "text"), sel], [record("r", {})], [view("v")])]);
    const added = addBitableRecord(d, "t1", { fieldId: "sel", value: "o2" });
    expect(added.doc.tables[0].records).toHaveLength(2);
    const rec = added.doc.tables[0].records[1];
    expect(rec.id).toBe(added.recordId);
    expect(rec.values.sel).toBe("o2");
    const missing = addBitableRecord(d, "nope");
    expect(missing.doc).toBe(d);
    expect(missing.recordId).toMatch(/^rec/);
  });

  it("addBitableRecord：系统时间字段不接受预置值", () => {
    const d = doc([table("t1", [field("f", "text"), field("ct", "createdTime")], [record("r", {})], [view("v")])]);
    const added = addBitableRecord(d, "t1", { fieldId: "ct", value: "2020-01-01" });
    expect(added.doc.tables[0].records[1].values.ct).toBeUndefined();
  });

  it("addBitableRecordWithValues：表单草稿里的双向关联会镜像到目标表", () => {
    const a = field("fld-a", "relationTwoWay", "关联", { relation: { tableId: "t2", allowMultiple: true, pairedFieldId: "fld-rev" } });
    const rev = field("fld-rev", "relationTwoWay", "反向", { relation: { tableId: "t1", allowMultiple: true, pairedFieldId: "fld-a" } });
    const t1 = table("t1", [a], [], [view("v1")]);
    const t2 = table("t2", [rev], [record("r2-1", { "fld-rev": [] })], [view("v2")]);
    const res = addBitableRecordWithValues([t1, t2], "t1", { "fld-a": ["r2-1"] });
    expect(res.tables[0].records).toHaveLength(1);
    expect(res.tables[1].records[0].values["fld-rev"]).toEqual([res.recordId]);
  });

  it("duplicateBitableField：复制双向关联回落为单向、不继承配对；选项 id 重生成", () => {
    const a = field("fld-a", "relationTwoWay", "关联", { relation: { tableId: "t2", allowMultiple: true, pairedFieldId: "fld-rev" } });
    const sel = field("fld-s", "select", "状态", { options: [{ id: "o1", name: "甲" }] });
    const t1 = table("t1", [a, sel], [], [view("v1")]);
    const next = duplicateBitableField([t1], "t1", "fld-a");
    const copy = next[0].fields[1];
    expect(copy.name).toBe("关联 副本");
    expect(copy.type).toBe("relationOneWay");
    expect(copy.relation?.pairedFieldId).toBeUndefined();
    expect(copy.relation?.tableId).toBe("t2");
    expect(next[0].fields[0].type).toBe("relationTwoWay");
    const next2 = duplicateBitableField([t1], "t1", "fld-s");
    const copySel = next2[0].fields[2];
    expect(copySel.options?.[0].name).toBe("甲");
    expect(copySel.options?.[0].id).not.toBe("o1");
    const arr = [t1];
    expect(duplicateBitableField(arr, "t1", "nope")).toBe(arr);
  });

  it("stripViewRefsForFieldType：类型变更清掉不再成立的视图引用，无变化返回原引用", () => {
    const v = view("v", { kanbanGroupFieldId: "f", galleryCoverFieldId: "f", calendarStartFieldId: "f", calendarEndFieldId: "f", calendarColorFieldId: "f" });
    const text = stripViewRefsForFieldType(v, field("f", "text"));
    expect(text.kanbanGroupFieldId).toBeUndefined();
    expect(text.galleryCoverFieldId).toBeUndefined();
    expect(text.calendarStartFieldId).toBeUndefined();
    expect(text.calendarEndFieldId).toBeUndefined();
    expect(text.calendarColorFieldId).toBeUndefined();
    const select = stripViewRefsForFieldType(v, field("f", "select"));
    expect(select.kanbanGroupFieldId).toBe("f");
    expect(select.calendarColorFieldId).toBe("f");
    expect(select.galleryCoverFieldId).toBeUndefined();
    const date = stripViewRefsForFieldType(v, field("f", "date"));
    expect(date.calendarStartFieldId).toBe("f");
    expect(date.calendarEndFieldId).toBe("f");
    expect(date.kanbanGroupFieldId).toBeUndefined();
    const untouched = view("v2", { kanbanGroupFieldId: "other" });
    expect(stripViewRefsForFieldType(untouched, field("f", "text"))).toBe(untouched);
  });
});
