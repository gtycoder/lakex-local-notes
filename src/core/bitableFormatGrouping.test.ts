import { describe, expect, it } from "vitest";
import { applyViewToRecords, computeColumnStat, createBitableField, createBitableRecord, duplicateValues, groupRecords } from "./bitableDoc";
import type { BitableTable } from "./bitableDoc";

const ts = "2026-09-01T00:00:00.000Z";

describe("显示格式不改变分组语义（261030）", () => {
  it("日期字段设 M月D日 后，不同年份的同月同日仍是两组", () => {
    const table: BitableTable = {
      id: "t1", name: "表", activeViewId: "v1",
      views: [{ id: "v1", name: "内容", type: "grid" }],
      fields: [{ ...createBitableField("date", "日期", "f"), format: "md" }],
      records: [
        { ...createBitableRecord("r1"), createdAt: ts, updatedAt: ts, values: { f: "2026-06-09" } },
        { ...createBitableRecord("r2"), createdAt: ts, updatedAt: ts, values: { f: "2025-06-09" } },
      ],
    };
    const groups = groupRecords(table, table.records, { fieldId: "f" });
    expect(groups.length).toBe(2);
    expect(groups.map((g) => g.records.length)).toEqual([1, 1]);
    // 展示仍是格式化后的（label 由展示值决定），但分组 key 不同
    expect(groups.map((g) => g.label)).toEqual(["2025-06-09", "2026-06-09"]);
  });

  it("数字字段设 2 位小数后，1 与 1.0 仍按原始值分组", () => {
    const table: BitableTable = {
      id: "t1", name: "表", activeViewId: "v1",
      views: [{ id: "v1", name: "内容", type: "grid" }],
      fields: [{ ...createBitableField("number", "数字", "n"), format: "decimal2" }],
      records: [
        { ...createBitableRecord("r1"), createdAt: ts, updatedAt: ts, values: { n: "1" } },
        { ...createBitableRecord("r2"), createdAt: ts, updatedAt: ts, values: { n: "1.0" } },
      ],
    };
    const groups = groupRecords(table, table.records, { fieldId: "n" });
    expect(groups.length).toBe(2);
  });
});
describe("显示格式不改变排序/筛选/统计/查重（261030）", () => {
  const makeTable = (format: string) => ({
    id: "t1", name: "表", activeViewId: "v1",
    views: [{ id: "v1", name: "内容", type: "grid" as const, sorts: [{ fieldId: "f" }] }],
    fields: [{ ...createBitableField("date", "日期", "f"), format }],
    records: [
      { ...createBitableRecord("r1"), createdAt: ts, updatedAt: ts, values: { f: "2026-06-09" } },
      { ...createBitableRecord("r2"), createdAt: ts, updatedAt: ts, values: { f: "2025-06-09" } },
    ],
  });

  it("排序按原始日期（与显示格式无关）", () => {
    for (const format of ["", "md"]) {
      const table = makeTable(format);
      const sorted = applyViewToRecords(table, table.views[0]);
      expect(sorted.map((r) => r.id)).toEqual(["r2", "r1"]);
    }
  });

  it("筛选按原始日期等于（格式 md 仍能筛到）", () => {
    const table = makeTable("md");
    const view = { ...table.views[0], sorts: undefined, filters: [{ fieldId: "f", operator: "equalTo" as const, value: "2026-06-09" }] };
    const rows = applyViewToRecords(table, view);
    expect(rows.map((r) => r.id)).toEqual(["r1"]);
  });

  it("数字统计与查重按原始值（千分位/小数格式不影响）", () => {
    const table = {
      id: "t1", name: "表", activeViewId: "v1",
      views: [{ id: "v1", name: "内容", type: "grid" as const }],
      fields: [{ ...createBitableField("number", "数字", "n"), format: "decimal2" }],
      records: [
        { ...createBitableRecord("a"), createdAt: ts, updatedAt: ts, values: { n: "1" } },
        { ...createBitableRecord("b"), createdAt: ts, updatedAt: ts, values: { n: "1.0" } },
        { ...createBitableRecord("c"), createdAt: ts, updatedAt: ts, values: { n: "2" } },
      ],
    };
    expect(computeColumnStat(table.fields[0], table.records, "sum")).toBe("4");
    expect(computeColumnStat(table.fields[0], table.records, "unique")).toBe("3");
    expect(duplicateValues(table.fields[0], table.records).size).toBe(0);
  });
});
