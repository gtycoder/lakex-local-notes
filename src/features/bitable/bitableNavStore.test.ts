/**
 * 多维表设备本地导航（261006 选 C）单一来源护栏：桌面 `BitableEditor` 与移动端 `MobileBitableViewer`
 * 共用这里的读写与「应用导航」，避免两份实现漂移（导航绝不进正文）。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { applyBitableNav, BITABLE_NAV_KEY_PREFIX, readBitableNav, writeBitableNav } from "./bitableNavStore";
import { createBitableView, createDefaultBitableTable, type BitableDoc } from "../../core/bitableDoc";

function docOfTwoTables(): BitableDoc {
  const t1 = createDefaultBitableTable("表一");
  const t2 = { ...createDefaultBitableTable("表二"), id: "t2" };
  return { kind: "bitable", version: 1, tables: [t1, t2], activeTableId: t1.id };
}

describe("bitableNavStore（设备本地导航单一来源）", () => {
  beforeEach(() => { localStorage.clear(); });

  it("读写同一份存储：键前缀固定，读空/坏数据回落空对象", () => {
    writeBitableNav("n1", { tableId: "t2" });
    expect(localStorage.getItem(BITABLE_NAV_KEY_PREFIX + "n1")).toBeTruthy();
    expect(readBitableNav("n1").tableId).toBe("t2");
    expect(readBitableNav("missing")).toEqual({});
    localStorage.setItem(BITABLE_NAV_KEY_PREFIX + "bad", "{not json");
    expect(readBitableNav("bad")).toEqual({});
  });

  it("applyBitableNav：按记下的表/视图恢复；失效回落正文默认 / 第一张表", () => {
    const doc = docOfTwoTables();
    const second = doc.tables[1];
    const view = createBitableView("grid", "第二个视图");
    const withView = { ...doc, tables: doc.tables.map((t) => (t.id === second.id ? { ...t, views: [...t.views, view] } : t)) };

    const applied = applyBitableNav(withView, { tableId: second.id, viewIds: { [second.id]: view.id } });
    expect(applied.activeTableId).toBe(second.id);
    expect(applied.tables.find((t) => t.id === second.id)?.activeViewId).toBe(view.id);

    // 记下的 id 已失效 ⇒ 回落（表回正文默认，视图保持原样）
    const fallback = applyBitableNav(withView, { tableId: "gone", viewIds: { [second.id]: "gone" } });
    expect(fallback.activeTableId).toBe(doc.activeTableId);
    expect(fallback.tables.find((t) => t.id === second.id)?.activeViewId).toBe(doc.tables[1].activeViewId);
  });

  it("applyBitableNav 不写正文导航以外的字段（纯函数，不读 storage）", () => {
    const doc = docOfTwoTables();
    const applied = applyBitableNav(doc, { tableId: doc.tables[1].id });
    expect(applied.tables.map((t) => t.records.length)).toEqual(doc.tables.map((t) => t.records.length));
    expect(applied).not.toBe(doc);
  });
});
