import { describe, expect, it } from "vitest";
import { createBitableField, createBitableRecord, createDefaultBitableTable, groupRecords, groupRecordsTree, type BitableRecord } from "./bitableDoc";

function rec(fieldId: string, value: unknown, id: string): BitableRecord {
  const r = createBitableRecord(id);
  r.values = { [fieldId]: value };
  return r;
}

function tableWithSelect() {
  const table = createDefaultBitableTable();
  const field = createBitableField("select", "状态", "fld-s");
  field.options = [{ id: "o1", name: "待开始" }, { id: "o2", name: "进行中" }];
  table.fields = [table.fields[0], field];
  return table;
}

describe("多维表分组 groupRecords", () => {
  it("按单选取选项名分组，空值组排最后", () => {
    const table = tableWithSelect();
    const groups = groupRecords(table, [rec("fld-s", "o2", "r1"), rec("fld-s", "o1", "r2"), rec("fld-s", "", "r3")], { fieldId: "fld-s" });
    expect(groups.map((g) => g.label)).toEqual(["待开始", "进行中", "(空)"]);
    expect(groups[0].records.map((r) => r.id)).toEqual(["r2"]);
    expect(groups[1].records.map((r) => r.id)).toEqual(["r1"]);
    expect(groups[2].records.map((r) => r.id)).toEqual(["r3"]);
  });

  it("降序反转组序，空值组仍最后", () => {
    const table = tableWithSelect();
    const groups = groupRecords(table, [rec("fld-s", "o2", "r1"), rec("fld-s", "o1", "r2"), rec("fld-s", "", "r3")], { fieldId: "fld-s", desc: true });
    expect(groups.map((g) => g.label)).toEqual(["进行中", "待开始", "(空)"]);
  });

  it("多级分组（T03）：两级/三级树、组内保持传入顺序、count 含子级、空值恒最后", () => {
    const table = tableWithSelect();
    const second = createBitableField("select", "优先级", "fld-p");
    second.options = [{ id: "p1", name: "高" }, { id: "p2", name: "低" }];
    const third = createBitableField("number", "分数", "fld-n");
    table.fields.push(second, third);
    const mk = (id: string, s: string, p: string) => { const record = createBitableRecord(id); record.values = { "fld-s": s, "fld-p": p }; return record; };
    const records = [mk("r1", "o1", "p2"), mk("r2", "o1", "p1"), mk("r3", "o2", "p1"), mk("r4", "", "p1")];
    const tree = groupRecordsTree(table, records, [{ fieldId: "fld-s" }, { fieldId: "fld-p" }]);
    expect(tree.map((n) => n.label)).toEqual(["待开始", "进行中", "(空)"]);
    expect(tree.map((n) => n.level)).toEqual([0, 0, 0]);
    expect(tree[0].count).toBe(2);
    expect(tree[0].records.map((r) => r.id)).toEqual(["r1", "r2"]);
    // 子级组间按该级字段的展示值排序（中文 localeCompare：低 < 高）
    expect(tree[0].children.map((n) => n.label)).toEqual(["低", "高"]);
    expect(tree[0].children[0].records.map((r) => r.id)).toEqual(["r1"]);
    expect(tree[0].children[1].records.map((r) => r.id)).toEqual(["r2"]);
    expect(tree[0].children[0].level).toBe(1);
    // 折叠 key 沿用「组键 = 选项名」的既有口径，逐级拼接保证唯一
    expect(tree[0].children[0].key).toBe("fld-s:待开始/fld-p:低");
    const deep = groupRecordsTree(table, records, [{ fieldId: "fld-s" }, { fieldId: "fld-p" }, { fieldId: "fld-n" }]);
    expect(deep[0].children[0].children[0].level).toBe(2);
    expect(deep[0].children[0].children[0].label).toBe("(空)");
  });

  it("多级分组：无有效规则/字段被删 → 空数组（由界面按未分组拍平）", () => {
    const table = tableWithSelect();
    expect(groupRecordsTree(table, [rec("fld-s", "o1", "r1")], [])).toEqual([]);
    expect(groupRecordsTree(table, [rec("fld-s", "o1", "r1")], [{ fieldId: "fld-missing" }])).toEqual([]);
  });

  it("无规则时返回单组并保持原顺序", () => {
    const table = createDefaultBitableTable();
    const groups = groupRecords(table, [createBitableRecord("a"), createBitableRecord("b")], undefined);
    expect(groups).toHaveLength(1);
    expect(groups[0].records.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

