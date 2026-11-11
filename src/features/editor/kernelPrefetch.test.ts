import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importState = vi.hoisted(() => ({ count: 0 }));

// 预取目标是 EditorTab（连带 lakeRuntime/内核 chunk）：mock 掉，避免测试里真加载内核。
// 注：模块缓存跨用例保留（vi.resetModules 不会重跑 mock factory），所以「模块求值次数」只在
// 第一次真正 import 时可观测；本文件按声明顺序测：SSR → Now 触发 import → 空闲兜底的调度行为。
vi.mock("./EditorTab", () => {
  importState.count += 1;
  return { EditorTab: () => null };
});

async function loadFresh(): Promise<typeof import("./kernelPrefetch")> {
  vi.resetModules();
  return await import("./kernelPrefetch");
}

/** 立即预取路径不用 fake timers（动态 import 在假定时器下不 settle）：真实计时 + 轮询。 */
async function waitForImport(count: number): Promise<void> {
  const started = Date.now();
  while (importState.count < count && Date.now() - started < 5000) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function stubDom(): { idleQueue: Array<() => void> } {
  const idleQueue: Array<() => void> = [];
  vi.stubGlobal("window", { requestIdleCallback: (cb: () => void) => { idleQueue.push(cb); return 1; } });
  vi.stubGlobal("document", {});
  return { idleQueue };
}

describe("prefetchEditorKernel（P12 内核预取；261111 冷启动预热重做）", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("无 window/document（node/SSR）=> 两个入口都直接 no-op", async () => {
    vi.useFakeTimers();
    const before = importState.count;
    const { prefetchEditorKernel, prefetchEditorKernelNow } = await loadFresh();
    prefetchEditorKernel();
    prefetchEditorKernelNow();
    prefetchEditorKernelNow();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(importState.count).toBe(before);
  });

  it("立即预取：不等空闲、立即 import 同一 EditorTab 模块；重复调用只 import 一次", async () => {
    const { idleQueue } = stubDom();
    const before = importState.count;
    const { prefetchEditorKernel, prefetchEditorKernelNow } = await loadFresh();
    prefetchEditorKernelNow();
    prefetchEditorKernelNow();
    await waitForImport(before + 1);
    expect(importState.count).toBe(before + 1);
    // 已经预取过：再调空闲兜底既不再定时，也不会重复 import
    prefetchEditorKernel();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(idleQueue.length).toBe(0);
    expect(importState.count).toBe(before + 1);
  });

  it("空闲兜底：首帧后 500ms 的第一段空闲里触发（不再等 3s）；重复调用只排一次", async () => {
    vi.useFakeTimers();
    const { idleQueue } = stubDom();
    const { prefetchEditorKernel } = await loadFresh();
    prefetchEditorKernel();
    prefetchEditorKernel();
    await vi.advanceTimersByTimeAsync(499);
    expect(idleQueue.length).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(idleQueue.length).toBe(1);
    idleQueue[0]();
    await vi.dynamicImportSettled();
    expect(importState.count).toBeGreaterThanOrEqual(1);
    // 已预取过：再调不会重新排空闲
    prefetchEditorKernel();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(idleQueue.length).toBe(1);
  });

  it("Now 会取消尚未触发的空闲定时器（不二次排空闲）", async () => {
    vi.useFakeTimers();
    const { idleQueue } = stubDom();
    const { prefetchEditorKernel, prefetchEditorKernelNow } = await loadFresh();
    prefetchEditorKernel();
    await vi.advanceTimersByTimeAsync(200);
    prefetchEditorKernelNow();
    vi.useRealTimers();
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
    expect(idleQueue.length).toBe(0);
  });
});
