// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { MOBILE_BITABLE_LAYOUT_KEY_PREFIX, readBitableRecordLayout, writeBitableRecordLayout } from "./mobileBitableViewPrefs";

describe("移动端多维表布局偏好（设备本地，不进正文）", () => {
  beforeEach(() => { localStorage.clear(); });

  it("读写同一份存储：按 noteId/tableId/viewId 分层", () => {
    writeBitableRecordLayout("n1", "t1", "v1", { mode: "card", columns: 2, cover: true });
    expect(readBitableRecordLayout("n1", "t1", "v1")).toEqual({ mode: "card", columns: 2, cover: true });
    expect(readBitableRecordLayout("n1", "t1", "v2")).toEqual({});
    expect(readBitableRecordLayout("n2", "t1", "v1")).toEqual({});
    expect(localStorage.getItem(MOBILE_BITABLE_LAYOUT_KEY_PREFIX + "n1")).toBeTruthy();
  });

  it("写空对象 = 恢复缺省：条目与键都清掉，不留旧快照", () => {
    writeBitableRecordLayout("n1", "t1", "v1", { mode: "card" });
    writeBitableRecordLayout("n1", "t1", "v1", {});
    expect(localStorage.getItem(MOBILE_BITABLE_LAYOUT_KEY_PREFIX + "n1")).toBeNull();
    expect(readBitableRecordLayout("n1", "t1", "v1")).toEqual({});
  });

  it("坏数据/坏 JSON 回落空对象（不抛错、不影响打开文档）", () => {
    localStorage.setItem(MOBILE_BITABLE_LAYOUT_KEY_PREFIX + "bad", "{not json");
    expect(readBitableRecordLayout("bad", "t1", "v1")).toEqual({});
    localStorage.setItem(MOBILE_BITABLE_LAYOUT_KEY_PREFIX + "weird", JSON.stringify({ t1: { v1: { mode: "nope", columns: 3 } } }));
    expect(readBitableRecordLayout("weird", "t1", "v1")).toEqual({});
  });

  it("同一张表多个视图互不覆盖", () => {
    writeBitableRecordLayout("n1", "t1", "v1", { mode: "card" });
    writeBitableRecordLayout("n1", "t1", "v2", { columns: 2 });
    expect(readBitableRecordLayout("n1", "t1", "v1")).toEqual({ mode: "card" });
    expect(readBitableRecordLayout("n1", "t1", "v2")).toEqual({ columns: 2 });
  });
});
