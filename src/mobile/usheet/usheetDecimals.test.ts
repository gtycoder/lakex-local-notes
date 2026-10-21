import { describe, expect, it } from "vitest";
import { DECIMAL_MAX, decimalStepMessage, stepNumberFormatDecimals } from "./usheetDecimals";

describe("移动端表格小数位步进（语雀分工：一级 +1 / ⋯ 卡 −1）", () => {
  it("常规（空 pattern）从整数起步，+1 得一位小数", () => {
    expect(stepNumberFormatDecimals("", 1)).toMatchObject({ ok: true, changed: true, pattern: "#,##0.0" });
  });

  it("加/减都只改小数点后的 0 的个数，其余字符原样保留", () => {
    expect(stepNumberFormatDecimals("#,##0.00", 1).pattern).toBe("#,##0.000");
    expect(stepNumberFormatDecimals("#,##0.00", -1).pattern).toBe("#,##0.0");
    expect(stepNumberFormatDecimals("¥#,##0.00", 1).pattern).toBe("¥#,##0.000");
    expect(stepNumberFormatDecimals("0.00%", 1).pattern).toBe("0.000%");
  });

  it("减到 0 位就把小数点整段去掉", () => {
    expect(stepNumberFormatDecimals("#,##0.0", -1)).toMatchObject({ ok: true, changed: true, pattern: "#,##0" });
  });

  it("边界：0 位不能再减、9 位不能再加（changed=false，带 reason）", () => {
    expect(stepNumberFormatDecimals("#,##0", -1)).toMatchObject({ ok: false, changed: false, reason: "min" });
    const maxed = "#,##0." + "0".repeat(DECIMAL_MAX);
    expect(stepNumberFormatDecimals(maxed, 1)).toMatchObject({ ok: false, changed: false, reason: "max" });
  });

  it("文本与日期时间不静默 no-op，给出可读原因", () => {
    expect(stepNumberFormatDecimals("@", 1)).toMatchObject({ ok: false, reason: "text" });
    expect(stepNumberFormatDecimals("yyyy-MM-dd", 1)).toMatchObject({ ok: false, reason: "date" });
    expect(stepNumberFormatDecimals("HH:mm:ss", -1)).toMatchObject({ ok: false, reason: "date" });
    expect(decimalStepMessage("text")).toBe("文本格式没有小数位");
    expect(decimalStepMessage("min")).toBe("已经是整数位，不能再减");
  });

  it("纯符号 / 空壳 pattern 判为 invalid，不产出坏 pattern", () => {
    expect(stepNumberFormatDecimals("%", 1)).toMatchObject({ ok: false, reason: "invalid" });
  });
});
