import { describe, expect, it } from "vitest";
import { createBitableField, createBitableRecord, createDefaultBitableTable, groupRecords, type BitableRecord } from "./bitableDoc";

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

  it("无规则时返回单组并保持原顺序", () => {
    const table = createDefaultBitableTable();
    const groups = groupRecords(table, [createBitableRecord("a"), createBitableRecord("b")], undefined);
    expect(groups).toHaveLength(1);
    expect(groups[0].records.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
