import { describe, expect, it } from "vitest";
import { HOME_TABS, pagerScrollLeft, settledIndex, tabAt, tabIndex } from "./tabPager";

describe("首页横向分页判据（261019，对齐语雀 pager）", () => {
  it("tab ↔ 下标：顺序固定为 小记 → 知识库，未知值回落第一页", () => {
    expect(HOME_TABS).toEqual(["quick", "library"]);
    expect(tabIndex("quick")).toBe(0);
    expect(tabIndex("library")).toBe(1);
    expect(tabIndex("nope" as never)).toBe(0);
    expect(tabAt(0)).toBe("quick");
    expect(tabAt(1)).toBe("library");
    expect(tabAt(-3)).toBe("quick");
    expect(tabAt(9)).toBe("library");
  });

  it("tab → 滚动目标：第 N 页 = N × 宽度；宽度未量到/非法时归 0（首帧不跳）", () => {
    expect(pagerScrollLeft(0, 412)).toBe(0);
    expect(pagerScrollLeft(1, 412)).toBe(412);
    expect(pagerScrollLeft(1, 0)).toBe(0);
    expect(pagerScrollLeft(1, -10)).toBe(0);
    expect(pagerScrollLeft(1, Number.NaN)).toBe(0);
    expect(pagerScrollLeft(7, 412)).toBe(412);
  });

  it("滚动位置 → 页码：过半算下一页，回弹/越界夹紧", () => {
    expect(settledIndex(0, 412)).toBe(0);
    expect(settledIndex(0.49 * 412, 412)).toBe(0);
    expect(settledIndex(0.51 * 412, 412)).toBe(1);
    expect(settledIndex(412, 412)).toBe(1);
    expect(settledIndex(1.4 * 412, 412)).toBe(1);
    expect(settledIndex(-80, 412)).toBe(0);   // 首屏右滑回弹
    expect(settledIndex(9999, 412)).toBe(1);  // 越界
    expect(settledIndex(412, 0)).toBe(0);     // 宽度未量到
    expect(settledIndex(Number.NaN, 412)).toBe(0);
  });
});
