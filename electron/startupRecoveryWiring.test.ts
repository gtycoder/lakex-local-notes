/**
 * 启动恢复接线护栏（静态锁，P1-5）。
 *
 * 恢复路径依赖 Electron 运行时（app/BrowserWindow/Store 构造），没有单测入口；
 * 这里用源码断言锁住**顺序与动作清单**，防止后续重构把恢复出口改回「卡 boot splash / 只弹一个退出对话框」：
 * - 完整性预检必须在 Store 构造之前；
 * - 四个恢复动作（备份后重试 / 云端恢复 / 打开数据目录 / 退出）都必须接线；
 * - uncaughtException 必须落持久标记，下次启动读取并在正常启动后消费；
 * - 恢复窗口走同文档 hash（不依赖 preload/IPC，安装包 files 里没有新增 preload）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const recoveryWindow = readFileSync(new URL("./startupRecoveryWindow.ts", import.meta.url), "utf8");

describe("启动恢复接线（main.ts 静态锁）", () => {
  it("完整性预检（quick_check + foreign_key_check）在 Store 构造之前", () => {
    const inspectAt = main.indexOf("inspectDatabaseForStartup(");
    const storeAt = main.indexOf("openedStore = new Store(");
    expect(inspectAt).toBeGreaterThan(0);
    expect(storeAt).toBeGreaterThan(inspectAt);
    expect(main).toContain("decideStartupRecovery(");
    expect(main).toContain("showRecoveryWindow(");
  });

  it("旧的阻塞式完整性弹框已删除（不再只给「退出/继续打开」）", () => {
    expect(main).not.toContain("本地数据库完整性检查未通过");
    expect(main).not.toContain("继续打开可能导致后续写入风险");
  });

  it("恢复模式动作齐全：备份后重试 / 云端恢复 / 从备份恢复 / 打开数据目录 / 重开 / 退出", () => {
    expect(main).toContain("backupDatabaseForRecovery(");
    expect(main).toContain("prepareCloudRestore(");
    expect(main).toContain("restoreMainDatabaseFromBackup(");
    expect(main).toContain("rememberRestoreCandidate(");
    expect(main).toContain("shell.openPath(userDataDir)");
    for (const hook of ["backupAndRetry()", "cloudRestore()", "restoreFromBackup()", "openDataFolder()", "restart()", "quit()"]) {
      expect(main).toContain(hook);
    }
    // 成功路径必须重启进正常启动（relaunch 而不是原地继续半初始化状态）。
    expect(main).toContain("app.relaunch();");
    // 恢复页动作通道必须能解析新按钮（同文档 hash）。
    expect(recoveryWindow).toContain("restore-backup");
  });

  it("备份/重试失败都会回传失败消息（不静默）", () => {
    expect(main).toContain("if (!backup.ok) return { ok: false, message: backup.message };");
    expect(main).toContain("但重试打开仍失败：");
    expect(main).toContain('message: "云端恢复准备失败："');
  });

  it("崩溃标记：uncaughtException 写、启动读并提示、正常启动后消费", () => {
    expect(main).toContain("writeCrashMarker(userDataDir, error)");
    expect(main).toContain("readCrashMarker(userDataDir)");
    expect(main).toContain("removeCrashMarker(userDataDir)");
    expect(main).toContain("installCrashLogging(userDataDir)");
    // 恢复模式保留标记给恢复页；正常启动才消费（上面的 remove 在 recovery return 之后）。
    const recoveryReturn = main.indexOf("      return;", main.indexOf("showRecoveryWindow("));
    const removeAt = main.indexOf("removeCrashMarker(userDataDir)");
    expect(removeAt).toBeGreaterThan(recoveryReturn);
  });
});

describe("恢复窗口（startupRecoveryWindow.ts 静态锁）", () => {
  it("内联页 + 同文档 hash 触发动作；不引入 preload/IPC", () => {
    expect(recoveryWindow).toContain("did-navigate-in-page");
    expect(recoveryWindow).toContain("parseRecoveryActionHash(");
    expect(recoveryWindow).toContain("__recoveryStatus");
    expect(recoveryWindow).not.toContain("preload:");
    expect(recoveryWindow).not.toContain("ipcMain.");
  });

  it("关窗 = 放弃恢复 ⇒ 退出；成功重启前先展示结果", () => {
    expect(recoveryWindow).toContain("if (!exiting) actions.quit();");
    expect(recoveryWindow).toContain("RESTART_DELAY_MS");
    expect(recoveryWindow).toContain("setTimeout(() => actions.restart()");
  });
});
