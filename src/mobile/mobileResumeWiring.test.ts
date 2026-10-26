import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const BRIDGE = readFileSync(new URL("./bridge/sync.ts", import.meta.url), "utf8");
const AUTO = readFileSync(new URL("./hooks/useAutoSync.ts", import.meta.url), "utf8");
const APP = readFileSync(new URL("./MobileApp.tsx", import.meta.url), "utf8");

describe("移动端断点续传接线（261026）", () => {
  it("syncNow 开始写标记、成功才清除（失败保留，下次续），标记落 device_state", () => {
    expect(BRIDGE).toContain("markSyncInterrupted(resumeDb)");
    expect(BRIDGE).toContain("clearSyncInterrupted(resumeDb)");
    expect(BRIDGE).toContain("await ensureDb()");
    const begin = BRIDGE.indexOf("markSyncInterrupted(resumeDb)");
    const clear = BRIDGE.indexOf("clearSyncInterrupted(resumeDb)");
    expect(begin).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(begin);
  });

  it("续传标记持久化在 device_state（localStorage 只作迁移兜底）", () => {
    const MARKER = readFileSync(new URL("./sync/syncResumeMarker.ts", import.meta.url), "utf8");
    expect(MARKER).toContain("device_state");
    expect(MARKER).toContain("INSERT INTO device_state");
    expect(MARKER).toContain("localStorage");
  });

  it("冷启动/回前台检测到未完成同步时无条件补一次（manual 也续）", () => {
    expect(AUTO).toContain("hasInterruptedSync(");
    expect(AUTO).toContain("续传未完成的同步");
    // 续传判断必须在 shouldSyncOnOpenClose 之前（优先于自动档位）
    expect(AUTO.indexOf("hasInterruptedSync(")).toBeLessThan(AUTO.indexOf("shouldSyncOnOpenClose(readSettings())"));
  });

  it("同步中列表渐进刷新（文档先出来）", () => {
    expect(APP).toContain("subscribeSyncProgress");
    expect(APP).toContain("refreshAll");
  });
});
