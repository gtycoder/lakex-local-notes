import { describe, expect, it, vi } from "vitest";
import { flushDirtyBeforeLifecycle } from "./lifecycleFlush.js";

describe("flushDirtyBeforeLifecycle（审计 F01 单一来源）", () => {
  it("无 tab / clean tab：直接放行，不触发保存", async () => {
    const persist = vi.fn();
    expect(await flushDirtyBeforeLifecycle(undefined, persist)).toEqual({ proceed: true, persisted: false });
    expect(await flushDirtyBeforeLifecycle({ dirty: false }, persist)).toEqual({ proceed: true, persisted: false });
    expect(persist).not.toHaveBeenCalled();
  });

  it("脏 tab + 保存成功：放行且已持久化", async () => {
    const out = await flushDirtyBeforeLifecycle({ dirty: true }, async () => ({ ok: true }));
    expect(out).toEqual({ proceed: true, persisted: true });
  });

  it("脏 tab + 保存失败：不放行（失败留在原文档）", async () => {
    const out = await flushDirtyBeforeLifecycle({ dirty: true }, async () => ({ ok: false }));
    expect(out).toEqual({ proceed: false, persisted: false });
  });

  it("脏 tab + blocked（回收站只读）：放行但不算持久化", async () => {
    const out = await flushDirtyBeforeLifecycle({ dirty: true }, async () => ({ ok: false, blocked: true }));
    expect(out).toEqual({ proceed: true, persisted: false });
  });
});
