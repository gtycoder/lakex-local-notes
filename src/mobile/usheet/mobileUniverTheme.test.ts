import { describe, expect, it } from "vitest";
import { MOBILE_UNIVER_THEME_OVERRIDES, withMobileUniverTheme } from "./mobileUniverTheme";

describe("移动端表格画布主题（261021 P4-1：对齐语雀 §2.8）", () => {
  const base = () => ({ gray: { "50": "#fafbfc", "200": "#e6e8ec", "900": "#1f2329" }, primary: { "500": "#3f5fa0", "600": "#33497f" } });

  it("覆盖表头底 / 网格线基色 / 选区蓝，其余键原样保留", () => {
    const themed = withMobileUniverTheme(base());
    expect(themed.gray["50"]).toBe("#f4f5f5");
    expect(themed.gray["200"]).toBe("#f4f4f3");
    expect(themed.primary["600"]).toBe("#2f8ef4");
    expect(themed.gray["900"]).toBe("#1f2329");
  });

  it("网格线目标色 = mix(gray.200, gray.900, 7%) ≈ #e5e5e5（内核公式固定 7%，这里对拍一次）", () => {
    const themed = withMobileUniverTheme(base());
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = hex(themed.gray["200"]);
    const b = hex(themed.gray["900"]);
    const mixed = a.map((v, i) => Math.round(v + (b[i] - v) * 0.07));
    expect(mixed).toEqual([229, 229, 229]); // #e5e5e5
  });

  it("不改入参（结构化克隆），且不存在的调色板不会凭空创建", () => {
    const input = base();
    withMobileUniverTheme(input);
    expect(input.gray["50"]).toBe("#fafbfc");
    const partial = withMobileUniverTheme({ gray: { "50": "#fff" } } as Record<string, Record<string, unknown>>);
    expect(partial.primary).toBeUndefined();
  });

  it("覆盖表是单一来源（档位齐全、值都是 hex）", () => {
    expect(MOBILE_UNIVER_THEME_OVERRIDES).toHaveLength(4);
    for (const [, , value] of MOBILE_UNIVER_THEME_OVERRIDES) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });
});
