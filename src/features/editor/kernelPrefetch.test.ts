import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importState = vi.hoisted(() => ({ count: 0 }));

// 预取目标是 EditorTab（连带 lakeRuntime/内核 chunk）：mock 掉，避免测试里真加载内核。
vi.mock("./EditorTab", () => {
  importState.count += 1;
  return { EditorTab: () => null };
});

async function loadFresh(): Promise<typeof import("./kernelPrefetch")> {
  vi.resetModules();
  return await import("./kernelPrefetch");
}

describe("prefetchEditorKernel（P12 内核空闲预取）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    importState.count = 0;
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("无 window/document（node/SSR）=> 直接 no-op", async () => {
    const { prefetchEditorKernel } = await loadFresh();
    prefetchEditorKernel();
    prefetchEditorKernel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(importState.count).toBe(0);
  });

  it("有 window => 3s 后的空闲回调里只预取一次（幂等）", async () => {
    const idleQueue: Array<() => void> = [];
    vi.stubGlobal("window", { requestIdleCallback: (cb: () => void) => { idleQueue.push(cb); return 1; } });
    vi.stubGlobal("document", {});
    const { prefetchEditorKernel } = await loadFresh();
    prefetchEditorKernel();
    prefetchEditorKernel();
    await vi.advanceTimersByTimeAsync(2999);
    expect(idleQueue.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(idleQueue.length).toBe(1);
    idleQueue[0]();
    await vi.dynamicImportSettled();
    expect(importState.count).toBe(1);
  });
});
