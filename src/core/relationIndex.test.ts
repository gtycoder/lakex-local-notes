import { describe, expect, it } from "vitest";
import {
  relationTargetRecords,
  type BitableDisplayContext, type BitableField, type BitableRecord, type BitableTable,
} from "./bitableDoc";

function rec(id: string, value: unknown): BitableRecord {
  return { id, values: { f: value }, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
}
const targetField: BitableField = { id: "f", name: "名称", type: "text" };
const relationField: BitableField = { id: "rel", name: "关联", type: "relationOneWay", relation: { tableId: "t2" } };
function ctx(records: BitableRecord[]): BitableDisplayContext {
  const target: BitableTable = { id: "t2", name: "目标", fields: [targetField], records, views: [], activeViewId: "" };
  return { tables: [target] };
}

describe("relationTargetRecords 索引缓存（AR-F6）", () => {
  it("同一 records 引用复用索引；records 换新数组后立即失效", () => {
    const records = [rec("r1", "A"), rec("r2", "B")];
    const c = ctx(records);
    expect(relationTargetRecords(c, relationField, ["r1", "r2"]).map((r) => r.values.f)).toEqual(["A", "B"]);
    // 同一引用重复查询（走缓存）结果一致，且保持存值顺序
    expect(relationTargetRecords(c, relationField, ["r2", "r1"]).map((r) => r.id)).toEqual(["r2", "r1"]);
    // 不可变快照被替换后必须反映新记录（缓存按数组引用失效）
    const c2 = ctx([rec("r1", "A2"), records[1]]);
    expect(relationTargetRecords(c2, relationField, ["r1"]).map((r) => r.values.f)).toEqual(["A2"]);
    // 失效目标跳过、内部 id 保留：再次恢复可用
    const c3 = ctx(records);
    expect(relationTargetRecords(c3, relationField, ["r1", "gone"]).map((r) => r.id)).toEqual(["r1"]);
  });
});
