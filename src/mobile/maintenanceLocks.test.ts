/**
 * F16 机制回归：**写域不得被维护域阻塞**（判据见 src/core/maintenancePolicy.ts）。
 *
 * 实测背景（261010）：旧实现两条域共用一条队列 ⇒ 弱网下本地写等整轮同步 152.0s（基线写 32ms）。
 * 这里用真实的两个队列实例断言独立性 —— 不必上模拟器，CI 即可卡住回归。
 */
import { describe, expect, it } from "vitest";
import { maintenanceQueue, withWriteLock, writeLock } from "./maintenanceLocks";

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** 竞速：赢=拿到值，输=超时（说明被阻塞了）。 */
function raceWithTimeout<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([work, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);
}

describe("F16：写域与维护域相互独立", () => {
  it("维护域被整轮同步占满时，写域仍然立刻完成（旧实现会一直等）", async () => {
    const gate = deferred();
    const syncRound = maintenanceQueue.run("maintenance", async () => { await gate.promise; });
    const write = await raceWithTimeout(writeLock.run("write", async () => "done" as const), 500);
    expect(write).toBe("done");
    gate.release();
    await syncRound;
  });

  it("同步侧的片段短锁（withWriteLock）与用户写同域 ⇒ 彼此串行", async () => {
    const gate = deferred();
    const first = withWriteLock(async () => { await gate.promise; });
    let secondRan = false;
    const second = withWriteLock(async () => { secondRan = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondRan).toBe(false);
    gate.release();
    await first;
    await second;
    expect(secondRan).toBe(true);
  });

  it("写域内的写彼此串行（不因拆域而失去顺序）", async () => {
    const order: string[] = [];
    const gate = deferred();
    const a = writeLock.run("write", async () => { await gate.promise; order.push("a"); });
    const b = writeLock.run("write", async () => { order.push("b"); });
    gate.release();
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
  });

  it("维护域内的轮次彼此串行（同步不与 GC 抢同一份远端状态）", async () => {
    const order: string[] = [];
    const gate = deferred();
    const first = maintenanceQueue.run("maintenance", async () => { await gate.promise; order.push("sync"); });
    const second = maintenanceQueue.run("maintenance", async () => { order.push("gc"); });
    gate.release();
    await Promise.all([first, second]);
    expect(order).toEqual(["sync", "gc"]);
  });
});
