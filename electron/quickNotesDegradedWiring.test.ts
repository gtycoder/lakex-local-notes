/**
 * Batch3-A 静态接线锁：quick-notes 库损坏不得卡 splash。
 * 主进程恢复路径依赖 Electron 运行时（QuickNotesStore 构造/窗口/IPC），没有直接单测入口；
 * 这里锁住顺序与分流，防止后续重构把「独立 try/catch + 降级模式 + 同步前置断言」改回去。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const quickNotes = readFileSync(new URL("./quickNotes.ts", import.meta.url), "utf8");
const desktopSync = readFileSync(new URL("./s3v3/desktopSync.ts", import.meta.url), "utf8");
const registerSync = readFileSync(new URL("./ipc/registerSync.ts", import.meta.url), "utf8");

describe("小记库降级接线（main.ts 静态锁）", () => {
  it("QuickNotesStore 构造有独立 try/catch，失败走 availability 判定（不再裸构造卡 splash）", () => {
    expect(main).toMatch(/let quickNotesOpenError: unknown = null;\s*try \{\s*quickNotes = new QuickNotesStore\(workspaceRoot\(\), log\);\s*\} catch \(error\) \{\s*quickNotesOpenError = error;\s*\}/);
    expect(main).toContain("decideQuickNotesAvailability({ openError: quickNotesOpenError })");
    expect(main).toContain("setQuickNotesAvailability(quickNotesAvailability)");
    expect(main).toContain("createUnavailableQuickNotesStore(degradedMessage)");
  });

  it("降级分支不注册 v3、不跑 recoverConversions（空小记世界会被同步误判下载/删除）", () => {
    const degradedAt = main.indexOf('if (quickNotesAvailability.mode === "degraded")');
    const elseAt = main.indexOf("} else {", degradedAt);
    const registerAt = main.indexOf("setQuickNotesStoreForV3(quickNotes)", degradedAt);
    const recoverAt = main.indexOf("quickNotes.recoverConversions(", degradedAt);
    expect(degradedAt).toBeGreaterThan(0);
    expect(elseAt).toBeGreaterThan(degradedAt);
    expect(registerAt).toBeGreaterThan(elseAt);
    expect(recoverAt).toBeGreaterThan(elseAt);
  });

  it("降级时跳过自动同步与退出同步；手动/单条同步由 desktopSync 前置断言给出可读错误", () => {
    expect(main).toContain('const autoSyncAllowed = getQuickNotesAvailability().mode === "ok"');
    expect(main).toContain("if (!autoSyncAllowed) return;");
    // 条件行可能被其他批次（如安全模式）加上前缀，这里只锁「autoSyncAllowed 必须参与该判据」。
    expect(main).toMatch(/autoSyncAllowed\s*&&\s*canTouchNetwork\(/);
    const quitGuard = main.indexOf('if (getQuickNotesAvailability().mode === "degraded") return;', main.indexOf('app.on("before-quit"'));
    expect(quitGuard).toBeGreaterThan(0);
    // 261112：旧 quick-notes 通道与 LAKE_SYNC_PROTOCOL / LAKE_S3V3_QUICK_NOTES 死开关已删，
    // 生产调用恒为 true（小记库降级时仍必须拦截整轮同步）。
    expect(desktopSync).not.toContain("quickV3");
    expect(desktopSync.match(/assertQuickNotesSyncAvailable\(true\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("设置→同步诊断可见：get_sync_status 最前面插一条降级报告（复用既有通道）", () => {
    expect(main).toContain("quickNotesAvailability: () => getQuickNotesAvailability()");
    expect(registerSync).toContain("buildQuickNotesUnavailableReport(availability)");
    expect(registerSync).toContain("quickNotesAvailability?(): QuickNotesAvailability");
  });

  it("降级替身有静态标记（同步/测试可显式判定，不依赖 instanceof）", () => {
    expect(quickNotes).toContain("export function createUnavailableQuickNotesStore(");
    expect(quickNotes).toContain("export function isQuickNotesUnavailableStore(");
    expect(quickNotes).toContain("unavailableQuickNotesStores");
  });
});
