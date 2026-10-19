import { describe, expect, it } from "vitest";
import { registerUsheetActiveSheet, usheetActiveSheetId } from "./usheetActiveSheet.js";

describe("表格活动工作表登记表", () => {
  it("未登记 / 注销后取不到（导出回退第一张工作表）", () => {
    expect(usheetActiveSheetId("nope")).toBeNull();
    const off = registerUsheetActiveSheet("n1", () => "s2");
    expect(usheetActiveSheetId("n1")).toBe("s2");
    off();
    expect(usheetActiveSheetId("n1")).toBeNull();
  });

  it("同一 noteId 重挂载时新 getter 生效；旧注销函数不会误删新登记", () => {
    const off1 = registerUsheetActiveSheet("n2", () => "s1");
    const off2 = registerUsheetActiveSheet("n2", () => "s3");
    expect(usheetActiveSheetId("n2")).toBe("s3");
    off1();
    expect(usheetActiveSheetId("n2")).toBe("s3");
    off2();
    expect(usheetActiveSheetId("n2")).toBeNull();
  });

  it("getter 抛错 / 返回空串时按“取不到”处理，不把异常抛给导出动作", () => {
    const off = registerUsheetActiveSheet("n3", () => { throw new Error("boom"); });
    expect(usheetActiveSheetId("n3")).toBeNull();
    off();
    const off2 = registerUsheetActiveSheet("n4", () => "");
    expect(usheetActiveSheetId("n4")).toBeNull();
    off2();
  });
});
