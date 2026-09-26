import { describe, expect, it } from "vitest";
import { createBitableField, createBitableRecord, duplicateValues, type BitableRecord } from "./bitableDoc";

function rec(fieldId: string, value: unknown, id: string): BitableRecord {
  const r = createBitableRecord(id);
  r.values = { [fieldId]: value };
  return r;
}

describe("多维表高亮重复值 duplicateValues", () => {
  it("返回出现次数 > 1 的展示值，忽略空值", () => {
    const field = createBitableField("text", "文本", "fld-t");
    const set = duplicateValues(field, [rec("fld-t", "a", "1"), rec("fld-t", "a", "2"), rec("fld-t", "b", "3"), rec("fld-t", "", "4")]);
    expect([...set]).toEqual(["a"]);
  });
  it("无重复时为空集", () => {
    const field = createBitableField("text", "文本", "fld-t");
    expect(duplicateValues(field, [rec("fld-t", "a", "1"), rec("fld-t", "b", "2")]).size).toBe(0);
  });
});
