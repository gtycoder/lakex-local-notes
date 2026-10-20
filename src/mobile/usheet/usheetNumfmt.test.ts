/**
 * 移动端表格「数字格式」护栏（261020 P1 第二批）：选项表单一来源 + 注入式调用。
 */
import { describe, expect, it } from "vitest";
import { applyUsheetNumberFormat, USHEET_NUMFMT_IDS, USHEET_NUMFMT_OPTIONS } from "./usheetNumfmt";

describe("usheet 数字格式", () => {
  it("选项表：id 唯一、pattern 唯一（常规=空串），覆盖 常规/文本/数字/整数/百分比/货币/日期/时间/日期时间", () => {
    expect(USHEET_NUMFMT_OPTIONS.map((option) => option.id)).toEqual([...USHEET_NUMFMT_IDS]);
    expect(new Set(USHEET_NUMFMT_OPTIONS.map((option) => option.id)).size).toBe(USHEET_NUMFMT_OPTIONS.length);
    expect(new Set(USHEET_NUMFMT_OPTIONS.map((option) => option.pattern)).size).toBe(USHEET_NUMFMT_OPTIONS.length);
    expect(USHEET_NUMFMT_OPTIONS[0]).toEqual({ id: "numfmt-general", label: "常规（清除格式）", pattern: "" });
    const byId = new Map(USHEET_NUMFMT_OPTIONS.map((option) => [option.id, option.pattern]));
    expect(byId.get("numfmt-text")).toBe("@");
    expect(byId.get("numfmt-number")).toBe("#,##0.00");
    expect(byId.get("numfmt-percent")).toBe("0.00%");
    expect(byId.get("numfmt-currency")).toBe("¥#,##0.00");
    expect(byId.get("numfmt-date")).toBe("yyyy-MM-dd");
    expect(byId.get("numfmt-time")).toBe("HH:mm:ss");
    expect(byId.get("numfmt-datetime")).toBe("yyyy-MM-dd HH:mm:ss");
  });

  it("按菜单 id 调到 facade mixin；未知 id / 运行时缺 mixin 都返回 false（由组件提示）", () => {
    const applied: string[] = [];
    const range = { setNumberFormat: (pattern: string) => { applied.push(pattern); } };
    expect(applyUsheetNumberFormat(range, "numfmt-percent")).toBe(true);
    expect(applyUsheetNumberFormat(range, "numfmt-general")).toBe(true);
    expect(applied).toEqual(["0.00%", ""]);
    expect(applyUsheetNumberFormat(range, "bold")).toBe(false);
    expect(applyUsheetNumberFormat({}, "numfmt-date")).toBe(false);
  });
});
