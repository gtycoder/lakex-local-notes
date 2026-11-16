import { describe, expect, it, vi } from "vitest";
import { createFrameCoalescer, type FrameScheduler } from "./aiWritingStreamBatching";

/** 手动调度器：记下 callback，测试自行 flush 帧。 */
function manualScheduler() {
  const pending = new Map<number, () => void>();
  let nextId = 1;
  const scheduler: FrameScheduler = {
    request(callback) { const id = nextId++; pending.set(id, callback); return id; },
    cancel(id) { pending.delete(id); },
  };
  return {
    scheduler,
    fireFrame() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach((cb) => cb()); },
    pendingCount() { return pending.size; },
  };
}

describe("createFrameCoalescer", () => {
  it("同一帧内 50 次 push 只提交最后一个值（合帧）", () => {
    const emit = vi.fn();
    const { scheduler, fireFrame, pendingCount } = manualScheduler();
    const coalescer = createFrameCoalescer<number>(emit, scheduler);
    for (let i = 0; i < 50; i += 1) coalescer.push(i);
    expect(emit).not.toHaveBeenCalled();
    expect(pendingCount()).toBe(1);
    fireFrame();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(49);
  });

  it("flush 同步提交待提交值（结束/停止当帧完整）", () => {
    const emit = vi.fn();
    const { scheduler } = manualScheduler();
    const coalescer = createFrameCoalescer<string>(emit, scheduler);
    coalescer.push("A");
    coalescer.push("AB");
    coalescer.flush();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("AB");
    // flush 后帧已取消：再触发队列不会重复提交。
    coalescer.flush();
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("cancel 丢弃待提交值；下一个 push 重新起帧", () => {
    const emit = vi.fn();
    const { scheduler, fireFrame, pendingCount } = manualScheduler();
    const coalescer = createFrameCoalescer<string>(emit, scheduler);
    coalescer.push("旧");
    coalescer.cancel();
    expect(coalescer.pending()).toBe(false);
    fireFrame();
    expect(emit).not.toHaveBeenCalled();
    coalescer.push("新");
    expect(pendingCount()).toBe(1);
    fireFrame();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("新");
  });

  it("flush 无事可做时不提交（不产生空帧 state 更新）", () => {
    const emit = vi.fn();
    const { scheduler } = manualScheduler();
    const coalescer = createFrameCoalescer<number>(emit, scheduler);
    coalescer.flush();
    expect(emit).not.toHaveBeenCalled();
  });
});
