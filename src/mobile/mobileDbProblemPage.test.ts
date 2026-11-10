/**
 * 坏库页 / 崩溃隔离接线护栏（261105，静态源码契约）。
 *
 * 与 mobileBootError.test.ts 同一口径：这几条是「用户能不能自己走出去」的硬约束，
 * 用源码断言把**顺序与入口**钉住（真机渲染由设备走查覆盖）：
 *  - 坏库分支必须优先于普通启动失败分支；
 *  - 坏库页必须有「从云端恢复（换机/坏库）」并真的调 bridge.restoreFromCloud；
 *  - 根入口必须装全局异常兜底 + 根 ErrorBoundary；
 *  - 首页/工作区/设置/搜索/AI 各有一层隔离。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const APP = readFileSync(new URL("./MobileApp.tsx", import.meta.url), "utf8");
const MAIN = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
const HOME = readFileSync(new URL("./home/HomePage.tsx", import.meta.url), "utf8");

describe("坏库页（261105）", () => {
  it("坏库分支优先于启动失败分支（重试没意义时先给恢复出口）", () => {
    const dbBranch = APP.indexOf("if (dbUnhealthy) return (");
    const errorBranch = APP.indexOf("if (error) return (");
    expect(dbBranch).toBeGreaterThan(-1);
    expect(errorBranch).toBeGreaterThan(dbBranch);
  });

  it("三个处置动作：从云端恢复（走 bridge.restoreFromCloud）/ 重试 / 清理缓存后重试 / 复制诊断", () => {
    expect(APP).toContain("从云端恢复（换机/坏库）");
    expect(APP).toContain("await bridge.restoreFromCloud()");
    expect(APP).toContain("onRestoreFromCloud={() => void restoreAfterDbProblem()}");
    expect(APP).toContain("onClearCacheAndRetry={() => void clearCacheAndRetry()}");
    expect(APP).toContain("onCopyDiagnostics={() => void copyBootDiagnostics()}");
    // 恢复前必须二次确认（会把云端没有的本机文档移入回收站）
    expect(APP).toContain("confirmMobile({");
    expect(APP).toContain("移入回收站");
  });

  it("坏库由 classifyDbOpenError / quick_check 两条路径判定，不靠文案猜测", () => {
    expect(APP).toContain("classifyDbOpenError(e)");
    expect(APP).toContain("checkMobileDbHealth(await ensureDb())");
    expect(APP).toContain("describeDbHealth(health)");
  });
});

describe("崩溃隔离 + 全局异常（261105）", () => {
  it("根入口：装全局 handler + 读原生崩溃记录 + 根 ErrorBoundary", () => {
    expect(MAIN).toContain("installGlobalErrorHandlers();");
    expect(MAIN).toContain("void consumeNativeCrashLog();");
    expect(MAIN).toContain('<MobileErrorBoundary scope="app">');
    expect(MAIN).toContain("MobileApp initialCapture");
  });

  it("逐层隔离：首页/工作区/设置/搜索/AI 各一层（261110：AI 从全屏路由改为首页第 4 格分页，隔离层跟着搬进 HomePage）", () => {
    for (const scope of ["home", "workspace", "settings", "search"]) {
      expect(APP).toContain('scope="' + scope + '"');
    }
    expect(HOME).toContain('scope="ai"');
  });

  it("诊断复制带上最近崩溃记录与日记告警；设置页也有导出入口", () => {
    expect(APP).toContain("formatCrashEntries(readCrashLog(10))");
    const ABOUT = readFileSync(new URL("./settings/BasicSettingsSections.tsx", import.meta.url), "utf8");
    expect(ABOUT).toContain("复制诊断信息");
    expect(ABOUT).toContain("formatCrashEntries(readCrashLog(10))");
    // 261110 wave2：日记 console.warn 级告警（桌面 diaryStore 的 log 通道同义物）随同一份诊断带出。
    expect(ABOUT).toContain("formatDiaryWarnings(readDiaryWarnings(10))");
    expect(ABOUT).toContain("最近日记告警");
  });
});
