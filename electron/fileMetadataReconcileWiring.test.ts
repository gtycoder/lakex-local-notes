import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Batch4-B 装配静态锁：后台对账必须
 * ① 只在同步成功分支打点（onSyncComplete）——不是每次启动/写盘都跑；
 * ② 走维护域 enqueueMaintenance（与同步/GC 串行）；
 * ③ 默认关闭（LAKE_FILE_RECONCILE=1 才启用）；
 * ④ 空闲判定用 powerMonitor.getSystemIdleTime，报告经 Store/Diagnostics 的 fileReconcile 字段暴露。
 * 这些依赖 Electron 运行时（powerMonitor/BrowserWindow），没有单测入口，只能静态锁。
 */
const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
const diagnostics = readFileSync(new URL("./diagnostics.ts", import.meta.url), "utf8");

describe("file metadata reconcile wiring（主进程）", () => {
  it("默认关闭 + 显式环境变量开启", () => {
    expect(main).toContain('process.env.LAKE_FILE_RECONCILE === "1"');
    expect(main).toContain("new FileMetadataReconciler(");
  });

  it("空闲判定 = powerMonitor.getSystemIdleTime；维护域 = enqueueMaintenance", () => {
    expect(main).toContain("powerMonitor.getSystemIdleTime()");
    expect(main).toContain("enqueueMaintenance,");
  });

  it("同步成功分支打点（onSyncComplete 且位于 markSyncComplete 之后）", () => {
    const mark = main.indexOf("store.markSyncComplete(");
    const trigger = main.indexOf("fileReconciler?.onSyncComplete();");
    expect(mark).toBeGreaterThan(0);
    expect(trigger).toBeGreaterThan(mark);
    expect(trigger - mark).toBeLessThan(600);
  });

  it("报告经 Store.setFileReconcileReportProvider → runDataHealthCheck.fileReconcile", () => {
    expect(main).toContain("store.setFileReconcileReportProvider(");
    expect(store).toContain("setFileReconcileReportProvider(provider:");
    expect(store).toContain("fileReconcile: unknown;");
    expect(diagnostics).toContain("fileReconcile: this.ctx.getFileReconcileReport?.() ?? null,");
  });
});
