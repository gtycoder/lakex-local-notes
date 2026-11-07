import { describe, expect, it } from "vitest";
import { MOBILE_ACCENTS, mobileAccentForNotebook, mobileAccentVars } from "./mobileAccent";

describe("移动端笔记本动态主色（261107 v2）", () => {
  it("同一 id 稳定映射到同一颜色（重启/换端不变）", () => {
    const a = mobileAccentForNotebook("nb-1");
    const b = mobileAccentForNotebook("nb-1");
    expect(a).toBe(b);
  });

  it("只使用固定 5 色板（不允许任意取色）", () => {
    for (const id of ["a", "b", "nb-123", "uuid-xxxx", "笔记本"]) {
      expect(MOBILE_ACCENTS).toContain(mobileAccentForNotebook(id));
    }
  });

  it("空/异常 id 回落墨蓝", () => {
    expect(mobileAccentForNotebook("").name).toBe("墨蓝");
    expect(mobileAccentForNotebook(null).name).toBe("墨蓝");
    expect(mobileAccentForNotebook(undefined).name).toBe("墨蓝");
  });

  it("CSS 变量映射只包含 --mb-accent / --mb-accent-ink", () => {
    const vars = mobileAccentVars("nb-1");
    expect(Object.keys(vars).sort()).toEqual(["--mb-accent", "--mb-accent-ink", "--mb-accent-soft", "--mb-canvas-glow"]);
    expect(vars["--mb-accent"]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("不同 id 能命中不同色（散列有区分度，避免全部同色）", () => {
    const names = new Set(["nb-1", "nb-2", "nb-3", "nb-4", "nb-5"].map((id) => mobileAccentForNotebook(id).name));
    expect(names.size).toBeGreaterThan(1);
  });
});
