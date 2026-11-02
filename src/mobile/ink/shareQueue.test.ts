/**
 * 分享串行队列（261102 T2-E）纯类测试。
 *
 * 钉住三件事：① 严格串行（一次只跑一个、按入队顺序）；② 等待上限（默认 5，超出丢弃并回调一次）；
 * ③ 异常不阻塞后续（handler 抛错走 onError，队列继续把后面的跑完）。
 */
import { describe, expect, it } from "vitest";
import { SHARE_QUEUE_FULL_HINT, SHARE_QUEUE_LIMIT, ShareQueue } from "./shareQueue";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("ShareQueue（分享串行队列）", () => {
  it("串行执行：一次只跑一个，按入队顺序", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const queue = new ShareQueue<string>({
      handle: async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(item);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      },
    });

    expect(queue.enqueue("a")).toBe(true);
    expect(queue.enqueue("b")).toBe(true);
    expect(queue.enqueue("c")).toBe(true);
    await flush();
    expect(started).toEqual(["a"]);
    expect(queue.size).toBe(2);

    releases.shift()!();
    await flush();
    expect(started).toEqual(["a", "b"]);
    releases.shift()!();
    await flush();
    expect(started).toEqual(["a", "b", "c"]);
    releases.shift()!();
    await flush();

    expect(maxActive).toBe(1);
    expect(queue.size).toBe(0);
    expect(queue.busy).toBe(false);
  });

  it("等待上限默认 5：第 7 个被丢弃并回调一次（当前处理的 1 个 + 等待 5 个）", async () => {
    const dropped: string[] = [];
    const queue = new ShareQueue<string>({
      handle: () => new Promise<void>(() => { /* 永远不结束：模拟长导入 */ }),
      onOverflow: (item) => dropped.push(item),
    });
    expect(SHARE_QUEUE_LIMIT).toBe(5);

    for (const id of ["a", "b", "c", "d", "e", "f"]) expect(queue.enqueue(id)).toBe(true);
    await flush();
    expect(queue.busy).toBe(true);
    expect(queue.size).toBe(5);
    expect(queue.enqueue("g")).toBe(false);
    expect(dropped).toEqual(["g"]);
    expect(SHARE_QUEUE_FULL_HINT).toContain("队列已满");
    expect(SHARE_QUEUE_FULL_HINT).toContain("丢弃本次分享");
  });

  it("自定义上限（最小 1）：满了丢弃、未满入队", async () => {
    const dropped: string[] = [];
    const queue = new ShareQueue<string>({
      limit: 1,
      handle: () => new Promise<void>(() => { /* 不结束 */ }),
      onOverflow: (item) => dropped.push(item),
    });
    expect(queue.enqueue("x")).toBe(true); // 立刻开始处理
    expect(queue.enqueue("y")).toBe(true); // 占满唯一等待位
    expect(queue.enqueue("z")).toBe(false);
    expect(dropped).toEqual(["z"]);
    expect(queue.size).toBe(1);
    // 非法上限（0/NaN）回落到默认 5：q0 立刻处理 + q1..q4 排队 ⇒ 都应入队成功
    for (const badLimit of [0, Number.NaN]) {
      const fallback = new ShareQueue<string>({ limit: badLimit, handle: async () => undefined });
      for (let i = 0; i < SHARE_QUEUE_LIMIT; i += 1) expect(fallback.enqueue("q" + i)).toBe(true);
    }
  });

  it("异常不阻塞队列：handler 抛错 → onError 收到，后续任务继续执行", async () => {
    const handled: string[] = [];
    const errors: Array<[string, unknown]> = [];
    const queue = new ShareQueue<string>({
      handle: async (item) => {
        handled.push(item);
        if (item === "bad") throw new Error("boom");
      },
      onError: (item, reason) => errors.push([item, reason]),
    });

    queue.enqueue("bad");
    queue.enqueue("ok");
    await flush();
    await flush();

    expect(handled).toEqual(["bad", "ok"]);
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe("bad");
    expect((errors[0][1] as Error).message).toBe("boom");
    expect(queue.busy).toBe(false);
    expect(queue.size).toBe(0);
  });

  it("onOverflow / onError 缺省时不抛（老调用方兼容）", async () => {
    const queue = new ShareQueue<string>({ limit: 1, handle: async () => { throw new Error("x"); } });
    queue.enqueue("a");
    await flush();
    expect(queue.enqueue("b")).toBe(true);
    await flush();
    expect(queue.size).toBe(0);
  });
});
