import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * pad 窗口 resize 回归（261107 实测）：
 * 隐藏的首页分页器在宽度变化时会重对齐滚动，若把 scroll 回写当成用户意图，
 * 就会回调 onTabChange → MobileApp setRoute(home) → 把打开的工作区整块卸载（切窗口丢文档）。
 *
 * 两道护栏一起钉住：
 * ① 首页在后台（route.kind === "notebook"）时 onTabChange 直接忽略；
 * ② 程序化滚动标记必须在 scrollTo 之前置位（否则 resize 触发的首次 scroll 会被回写）。
 */
const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("首页 tab 回写护栏（pad resize 不丢工作区）", () => {
  const APP = read("src/mobile/MobileApp.tsx");
  const PAGER = read("src/mobile/home/useTabPager.ts");

  it("工作区打开时 onTabChange 不改路由（后台首页分页器只对齐、不切 tab）", () => {
    expect(APP).toContain('if (route.kind === "notebook") return;');
  });

  it("useTabPager：programmatic-start 先于 scrollTo（resize 的首次 scroll 不得回写 tab）", () => {
    const start = PAGER.indexOf('dispatchRef.current({ type: "programmatic-start" });');
    const scroll = PAGER.indexOf("el.scrollTo({");
    expect(start).toBeGreaterThan(-1);
    expect(scroll).toBeGreaterThan(-1);
    expect(start).toBeLessThan(scroll);
  });
});
