import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoardValueCoalescer } from "./boardValueCoalescer";

describe("画板 value 回灌合并（261103 八批）", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("同一帧内多次 push 只回灌最后一次", () => {
    const applied: number[] = [];
    const c = createBoardValueCoalescer<number>((v) => applied.push(v));
    c.push(1);
    c.push(2);
    c.push(3);
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(16);
    expect(applied).toEqual([3]);
  });

  it("flush 立刻回灌并清掉定时器（外部覆盖 state 前用）", () => {
    const applied: number[] = [];
    const c = createBoardValueCoalescer<number>((v) => applied.push(v));
    c.push(7);
    c.flush();
    expect(applied).toEqual([7]);
    vi.advanceTimersByTime(16);
    expect(applied).toEqual([7]);
  });

  it("cancel 丢弃待回灌值（避免旧值把新值盖回去）", () => {
    const applied: number[] = [];
    const c = createBoardValueCoalescer<number>((v) => applied.push(v));
    c.push(9);
    c.cancel();
    vi.advanceTimersByTime(16);
    expect(applied).toEqual([]);
  });
});
