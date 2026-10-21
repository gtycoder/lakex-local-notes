import { describe, expect, it } from "vitest";
import { DRAG_DEAD_PX, nextSplitDrag, rubberBandWidth, type SplitDragState } from "./SplitHandle";

/**
 * 分栏拖拽的 4px 微抖死区（261017 B）。拖拽本身是纯函数，这里覆盖四种边界：
 * 死区内不动、刚好越过、越过后的跟手、以及 engaged 之后的反向移动。
 */
const base = (): SplitDragState => ({ pointerId: 1, startX: 100, startWidth: 320, current: 320, engaged: false });

describe("SplitHandle 拖拽死区", () => {
  it("位移小于 4px 不进入拖拽（也不落盘）", () => {
    for (const dx of [0, 1, 2, 3]) {
      const s = nextSplitDrag(base(), 100 + dx);
      expect(s.engaged).toBe(false);
      expect(s.current).toBe(320);
    }
  });

  it("刚好越过 4px 才 engaged，且起点重定（不跳 4px）", () => {
    const engaged = nextSplitDrag(base(), 100 + DRAG_DEAD_PX);
    expect(engaged.engaged).toBe(true);
    expect(engaged.startX).toBe(100 + DRAG_DEAD_PX);
    expect(engaged.current).toBe(320);
    const moved = nextSplitDrag(engaged, 120);
    expect(moved.current).toBe(320 + (120 - (100 + DRAG_DEAD_PX)));
  });

  it("engaged 之后不再受死区限制（可反向拖回）", () => {
    const engaged = nextSplitDrag(base(), 110);
    const back = nextSplitDrag(engaged, 108);
    expect(back.current).toBe(318);
  });
});

/** 右侧大纲栏的拖拽边在左：向左拖变宽，向右拖变窄（261022 D1）。 */
describe("SplitHandle 右侧左缘方向（invert）", () => {
  it("invert 时向左拖变宽（位移取反）", () => {
    const engaged = nextSplitDrag(base(), 96, true); // 左移越过死区，起点重定
    expect(engaged.engaged).toBe(true);
    expect(engaged.startX).toBe(96);
    const moved = nextSplitDrag(engaged, 80, true);
    expect(moved.current).toBe(320 + (96 - 80));
  });

  it("invert 时向右拖变窄", () => {
    const engaged = nextSplitDrag(base(), 104, true);
    const moved = nextSplitDrag(engaged, 120, true);
    expect(moved.current).toBe(320 - (120 - 104));
  });

  it("4px 死区对方向不敏感", () => {
    for (const dx of [-3, -2, -1, 1, 2, 3]) {
      expect(nextSplitDrag(base(), 100 + dx, true).engaged).toBe(false);
    }
  });
});

/** 侧栏 / 大纲栏越界仍跟手，但只走 16% 的阻尼（松手由调用方夹回）。 */
describe("SplitHandle 越界橡皮筋", () => {
  it("合法区间内原样返回", () => {
    expect(rubberBandWidth(240, 160, 420)).toBe(240);
  });

  it("低于最小值只走 16%", () => {
    expect(rubberBandWidth(140, 160, 420)).toBeCloseTo(160 - 20 * 0.16);
  });

  it("高于最大值只走 16%", () => {
    expect(rubberBandWidth(440, 160, 420)).toBeCloseTo(420 + 20 * 0.16);
  });
});
