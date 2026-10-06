// @vitest-environment jsdom
/** 表格本机视图记忆（用户 261006）：当前工作表 / 缩放按文档记 localStorage，读默认、写合并、按文档隔离。 */
import { beforeEach, describe, expect, it } from "vitest";
import { readSheetView, resetSheetViews, writeSheetView } from "./sheetViewStore";

beforeEach(() => { localStorage.clear(); resetSheetViews(); });

describe("sheetViewStore", () => {
  it("没记忆时是默认（activeSheetId=null、无缩放）", () => {
    expect(readSheetView("n1")).toEqual({ activeSheetId: null, zooms: {} });
  });

  it("写当前工作表 + 缩放；多表缩放按 sheet id 合并、不互相覆盖", () => {
    writeSheetView("n1", { activeSheetId: "s1", zooms: { s1: 1.1 } });
    writeSheetView("n1", { activeSheetId: "s2", zooms: { s2: 0.8 } });
    expect(readSheetView("n1")).toEqual({ activeSheetId: "s2", zooms: { s1: 1.1, s2: 0.8 } });
  });

  it("按文档隔离", () => {
    writeSheetView("n1", { activeSheetId: "s1", zooms: { s1: 1.1 } });
    expect(readSheetView("n2")).toEqual({ activeSheetId: null, zooms: {} });
  });
});
