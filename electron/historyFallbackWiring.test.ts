import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 兜底快照的**主进程接线**护栏（Batch4-C）：行为/选择逻辑在 src/core/historyFallbackPolicy.test.ts
 * 与 electron/historyFallback.test.ts 里测；这里只钉四条容易静默回归的启动接线：
 * ① 定时器用「兜底」而不是旧的 flushHistorySnapshots（旧路径只在内存里记 saveNote，重启丢）；
 * ② 单飞防重入；③ 启动不立即跑（只有 setInterval）；④ 设置 0 = 关闭、失败不阻断。
 */
const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const STORE = readFileSync(new URL("./store.ts", import.meta.url), "utf8");

describe("兜底快照接线（桌面主进程）", () => {
  it("定时器走 runHistoryFallback，不再用内存脏集合 flushHistorySnapshots", () => {
    expect(MAIN).toContain("store.runHistoryFallback()");
    expect(MAIN).not.toContain("flushHistorySnapshots");
    expect(STORE).toContain("runHistoryFallback(options?: HistoryFallbackOptions)");
  });

  it("开关 0 = 关闭（间隔判据单一来源 = core 的 shouldRunHistoryFallback）", () => {
    expect(MAIN).toMatch(/const fallbackMinutes = historyFallbackMinutes\(cfg\.snapshotIntervalMinutes\);/);
    expect(MAIN).toMatch(/if \(shouldRunHistoryFallback\(fallbackMinutes\)\) \{/);
  });

  it("单飞防重入 + 启动不立即跑（只有 setInterval，没有首轮立即调用）", () => {
    expect(MAIN).toContain("let historyFallbackRunning = false;");
    expect(MAIN).toMatch(/if \(historyFallbackRunning\) return;/);
    expect(MAIN).toContain("historyFallbackRunning = true;");
    // P2-A：兜底改为异步分片后，单飞标记必须在 promise finally 里释放（覆盖整个异步窗口）
    expect(MAIN).toMatch(/\.finally\(\(\) => \{ historyFallbackRunning = false; \}\);/);
    expect(MAIN).toContain("void store.runHistoryFallback()");
    // 首轮延迟 = 一个间隔：定时器体内才调用，注册之前不调用
    const beforeTimer = MAIN.slice(0, MAIN.indexOf("snapshotTimer = setInterval(() => {"));
    expect(beforeTimer.endsWith("if (shouldRunHistoryFallback(fallbackMinutes)) {\n        ")).toBe(true);
  });

  it("失败只记日志、不阻断（兜底不能影响启动/保存）", () => {
    expect(MAIN).toContain('log.history.warn("[history] 兜底快照失败（不阻断）：');
  });
});
