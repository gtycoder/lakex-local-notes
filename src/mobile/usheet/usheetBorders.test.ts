import { describe, expect, it } from "vitest";
import { USHEET_BORDER_COLOR, USHEET_BORDER_IDS, USHEET_BORDER_OPTIONS, applyUsheetBorder } from "./usheetBorders";

describe("移动端表格边框（261021 P5：纯能力项）", () => {
  it("选项表：id 唯一、borderType 都是内核枚举里的字符串值", () => {
    expect(new Set(USHEET_BORDER_OPTIONS.map((o) => o.id)).size).toBe(USHEET_BORDER_OPTIONS.length);
    const allowed = new Set(["top", "bottom", "left", "right", "none", "all", "outside", "inside", "horizontal", "vertical"]);
    for (const option of USHEET_BORDER_OPTIONS) expect(allowed.has(option.borderType)).toBe(true);
    expect(USHEET_BORDER_IDS.has("border-all")).toBe(true);
    expect(USHEET_BORDER_IDS.has("border-nope")).toBe(false);
  });

  it("applyUsheetBorder：注入式调用（style 由运行时枚举传入），非边框 id 返回 false", () => {
    const calls: Array<[string, number, string | undefined]> = [];
    const range = { setBorder: (type: string, style: number, color?: string) => { calls.push([type, style, color]); return true; } };
    expect(applyUsheetBorder(range, "border-all", 1)).toBe(true);
    expect(calls).toEqual([["all", 1, USHEET_BORDER_COLOR]]);
    expect(applyUsheetBorder(range, "border-none", 1)).toBe(true);
    expect(calls[1][0]).toBe("none");
    expect(applyUsheetBorder(range, "bold", 1)).toBe(false);
  });

  it("运行时缺 setBorder facade ⇒ 明确返回 false（不静默 no-op）", () => {
    expect(applyUsheetBorder({}, "border-all", 1)).toBe(false);
  });
});
