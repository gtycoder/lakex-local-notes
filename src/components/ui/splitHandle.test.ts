import { describe, expect, it } from "vitest";
import { DRAG_DEAD_PX, nextSplitDrag, type SplitDragState } from "./SplitHandle";

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
