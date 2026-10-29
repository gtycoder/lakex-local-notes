import { describe, expect, it } from "vitest";
import { HOME_TABS, initialPagerState, pagerScrollLeft, reducePager, settledIndex, tabAt, tabIndex } from "./tabPager";

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

/**
 * 状态机单测（261028 MOB-03）：把 HomePage 里原来四份 ref 镜像 + 600ms 定时器覆盖的三类真实路径钉住 ——
 * 快速连点、手势横滑、程序化滚动不误判。DOM 适配层（useTabPager）只执行这里的 effect，不再另做判断。
 */
describe("分页状态机 reducePager（261028 MOB-03）", () => {
  it("点 tab = 程序化滚动：中途的 scroll 不回写，settled 才按最终位置落 tab", () => {
    const state = initialPagerState("quick", 412);
    const click = reducePager(state, { type: "tab-click", tab: "library", scrollLeft: 0, width: 412 });
    expect(click.effect).toEqual({ scrollLeft: 412, behavior: "smooth" });
    // 状态机不假设 DOM 已经照做：程序化态由 scrollTo 之后的 programmatic-start 事件置位。
    expect(click.state.programmatic).toBe(false);
    expect(click.state.tab).toBe("library");
    const started = reducePager(click.state, { type: "programmatic-start" });
    expect(started.state.programmatic).toBe(true);

    // 动画途中（还没到一半多）的 scroll 只来自 scrollTo，不代表用户意图 ⇒ 不回写旧 tab。
    const midway = reducePager(started.state, { type: "scroll", scrollLeft: 120 });
    expect(midway.commitTab).toBeUndefined();
    expect(midway.state.tab).toBe("library");

    // tab 在点击时已经乐观置为 library ⇒ 吸附到位不需要再回写一次（commitByScroll 只服务"用户滚出来的变化"）。
    const settled = reducePager(midway.state, { type: "settled", scrollLeft: 412 });
    expect(settled.state.programmatic).toBe(false);
    expect(settled.commitTab).toBeUndefined();
    expect(settled.state.commitByScroll).toBe(false);
    expect(settled.state.tab).toBe("library");
  });

  it("滚动回写造成的 tab 变化不再程序化滚一次（只销账）", () => {
    const committed = { ...initialPagerState("quick", 412), tab: "library" as const, commitByScroll: true };
    const synced = reducePager(committed, { type: "tab-click", tab: "library", scrollLeft: 412, width: 412 });
    expect(synced.effect).toBeUndefined();
    expect(synced.state.commitByScroll).toBe(false);
    expect(synced.state.programmatic).toBe(false);
  });

  it("快速连点：每次点击都重算目标位置，最后一次的方向说了算（不靠定时器清标记）", () => {
    let state = initialPagerState("quick", 412);
    let transition = reducePager(state, { type: "tab-click", tab: "library", scrollLeft: 0, width: 412 });
    state = reducePager(transition.state, { type: "programmatic-start" }).state;
    expect(transition.effect).toEqual({ scrollLeft: 412, behavior: "smooth" });

    // 动画刚起步（scrollLeft 100）就又点回小记。
    transition = reducePager(state, { type: "tab-click", tab: "quick", scrollLeft: 100, width: 412 });
    state = transition.state;
    expect(transition.effect).toEqual({ scrollLeft: 0, behavior: "smooth" });
    expect(state.programmatic).toBe(true);
    expect(state.tab).toBe("quick");

    // 再点一次知识库：目标仍按宽度算（程序化态可重入，不需要先等 settled）。
    transition = reducePager(state, { type: "tab-click", tab: "library", scrollLeft: 40, width: 412 });
    expect(transition.effect).toEqual({ scrollLeft: 412, behavior: "smooth" });
  });

  it("手势横滑：过半就回写一次；touchend/settled 不重复回写", () => {
    let state = initialPagerState("quick", 412);
    let transition = reducePager(state, { type: "user-scroll-start" });
    state = transition.state;
    expect(state.interacting).toBe(true);

    transition = reducePager(state, { type: "scroll", scrollLeft: 0.51 * 412 });
    state = transition.state;
    expect(transition.commitTab).toBe("library");
    expect(state.tab).toBe("library");
    expect(state.commitByScroll).toBe(true);

    // 继续滑到贴边：tab 已是 library ⇒ 不再重复提交（避免父级被同一个 tab 反复刷新）。
    transition = reducePager(state, { type: "scroll", scrollLeft: 412 });
    expect(transition.commitTab).toBeUndefined();
    state = transition.state;

    transition = reducePager(state, { type: "user-scroll-end" });
    state = transition.state;
    expect(state.interacting).toBe(false);

    transition = reducePager(state, { type: "settled", scrollLeft: 412 });
    expect(transition.commitTab).toBeUndefined();
    expect(transition.state.programmatic).toBe(false);
  });

  it("用户接管：手势打断程序化滚动后，scroll 立刻恢复回写", () => {
    const clicked = reducePager(initialPagerState("quick", 412), { type: "tab-click", tab: "library", scrollLeft: 0, width: 412 });
    const started = reducePager(clicked.state, { type: "programmatic-start" });
    expect(started.state.programmatic).toBe(true);

    const grabbed = reducePager(started.state, { type: "user-scroll-start" });
    expect(grabbed.state.programmatic).toBe(false);
    expect(grabbed.state.interacting).toBe(true);

    // 拖回第一页：与 clicked.state.tab（乐观置 library）不同 ⇒ 回写 quick。
    const draggedBack = reducePager(grabbed.state, { type: "scroll", scrollLeft: 60 });
    expect(draggedBack.commitTab).toBe("quick");
  });

  it("程序化滚动期间用户手势不动时，scroll 一律不回写", () => {
    let state = reducePager(initialPagerState("quick", 412), { type: "tab-click", tab: "library", scrollLeft: 0, width: 412 }).state;
    state = reducePager(state, { type: "programmatic-start" }).state;
    expect(state.programmatic).toBe(true);
    for (const scrollLeft of [80, 200, 300, 411]) {
      const transition = reducePager(state, { type: "scroll", scrollLeft });
      expect(transition.commitTab).toBeUndefined();
      state = transition.state;
    }
    // 目标 tab 点击时已乐观落位 ⇒ settled 只放开压制，不再重复回写。
    const settled = reducePager(state, { type: "settled", scrollLeft: 412 });
    expect(settled.commitTab).toBeUndefined();
    expect(settled.state.programmatic).toBe(false);
  });

  it("宽度变化（横竖屏）：立即重对齐且用 auto；手指按着时只记宽度、不抢滚动", () => {
    const state = { ...initialPagerState("library", 412), tab: "library" as const };
    const resized = reducePager({ ...state, programmatic: false }, { type: "resize", scrollLeft: 412, width: 300 });
    expect(resized.effect).toEqual({ scrollLeft: 300, behavior: "auto" });
    expect(resized.state.width).toBe(300);

    const interacting = reducePager({ ...state, interacting: true }, { type: "resize", scrollLeft: 412, width: 300 });
    expect(interacting.effect).toBeUndefined();
    expect(interacting.state.width).toBe(300);
  });

  it("首帧宽度未量到：不产生假滚动、也不误判页码（回到首屏时靠 resize 再对齐）", () => {
    const state = initialPagerState("quick", 0);
    const click = reducePager(state, { type: "tab-click", tab: "library", scrollLeft: 0, width: 0 });
    expect(click.effect).toBeUndefined();
    expect(click.state.programmatic).toBe(false);
    const scroll = reducePager(click.state, { type: "scroll", scrollLeft: 200 });
    expect(scroll.commitTab).toBeUndefined();
  });

  it("同一 tab 的 tab-click（挂载/恢复路由）：位置不对就补一次对齐，位置对就不滚", () => {
    const offscreen = reducePager(initialPagerState("quick", 412), { type: "tab-click", tab: "quick", scrollLeft: 412, width: 412 });
    expect(offscreen.effect).toEqual({ scrollLeft: 0, behavior: "smooth" });
    const aligned = reducePager(initialPagerState("quick", 412), { type: "tab-click", tab: "quick", scrollLeft: 0, width: 412 });
    expect(aligned.effect).toBeUndefined();
    expect(aligned.state.programmatic).toBe(false);
  });
});
