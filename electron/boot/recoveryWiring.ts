/**
 * 启动恢复页接线（C-04 从 main.ts E 原样搬出）：坏库/打不开时的可操作最小恢复页 ——
 * 备份后重试 / 云端恢复 / 从备份恢复 / 打开数据目录 / 重开 / 退出。
 * 边界：只装配恢复页与 4 个业务回调；启动判定 = boot/startupDecision；恢复实现 = workspaceBackup/
 * workspaceRestoreFromBackup（回滚/隔离语义都在那边）。
 * 契约：P2-B 备份目录统一 <userData>/backups/（与自动备份同口径）；备份成功后**重试打开**（完整走
 * Store 构造/迁移）才允许重启；每条失败路径都回传可读消息（不静默），见 docs/RESILIENCE.md。
 */
import { app, shell } from "electron";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { Store } from "../store.js";
import { createLocalSecretCipher } from "../secretCipher.js";
import { backupDatabaseForRecovery, type StartupRecoveryDecision } from "../startupRecovery.js";
import { showRecoveryWindow } from "../startupRecoveryWindow.js";
import { prepareCloudRestore } from "../workspaceBackup.js";
import { rememberRestoreCandidate, restoreMainDatabaseFromBackup } from "../workspaceRestoreFromBackup.js";
import { pickBackupDatabaseDialog } from "../ipc/registerNotes.js";
import { log } from "../logger.js";
import { errorFields, formatLogFields } from "../../src/core/logFormat.js";
import { logFilePath } from "./paths.js";

export interface RecoveryWiringDeps {
  userDataDir: string;
  workspaceRoot: () => string;
  /** boot 窗口单例（本体在 main.ts；进入恢复页时销毁 splash）。 */
  getBootWindow: () => BrowserWindow | null;
  setBootWindow: (win: BrowserWindow | null) => void;
}

/** 恢复模式：销毁 splash，换成一个可操作的最小恢复页（备份后重试 / 云端恢复 / 打开目录 / 退出）。 */
export function enterStartupRecovery(
  deps: RecoveryWiringDeps,
  startupDecision: StartupRecoveryDecision,
): void {
  const userDataDir = deps.userDataDir;
  log.app.error("[store] 进入启动恢复模式" + formatLogFields({ cause: startupDecision.cause, detail: startupDecision.detail }));
  const boot = deps.getBootWindow();
  if (boot && !boot.isDestroyed()) boot.destroy();
  deps.setBootWindow(null);
  showRecoveryWindow({
    reason: startupDecision.reason || "无法打开本地数据库",
    detail: startupDecision.detail,
    dataDir: userDataDir,
    workspacePath: deps.workspaceRoot(),
    logPath: logFilePath(),
    // P2-B：与自动备份同一目录口径（<userData>/backups/），恢复页不再展示另一个目录。
    backupDir: path.join(userDataDir, "backups"),
    crashMarker: startupDecision.crashMarker,
  }, {
    async backupAndRetry() {
      const backup = backupDatabaseForRecovery({ dbPath: path.join(deps.workspaceRoot(), "metadata.sqlite3"), userDataDir });
      if (!backup.ok) return { ok: false, message: backup.message };
      // 备份成功后**重试打开**（完整走一次 Store 构造/迁移）；成功后重启走正常启动路径。
      try {
        const probe = new Store(deps.workspaceRoot(), createLocalSecretCipher(userDataDir), log);
        probe.close();
      } catch (error) {
        log.app.error("[recovery] 备份后重试打开仍失败" + formatLogFields(errorFields(error)));
        return { ok: false, message: backup.message + "；但重试打开仍失败：" + (error instanceof Error ? error.message : String(error)) };
      }
      return { ok: true, message: backup.message + "；重试打开通过，正在重启…", restart: true };
    },
    async cloudRestore() {
      try {
        // 复用 A2：把当前 workspace 改名隔离保留 → 空库重启。坏库读不到 S3 凭据，重启后需重新配置。
        const { quarantinePath } = prepareCloudRestore(deps.workspaceRoot());
        log.app.info("[recovery] 云端恢复：原数据已隔离到 " + quarantinePath);
        return {
          ok: true,
          message: "原数据已隔离保留在 " + quarantinePath + "，将以全新空库重启；重启后需在设置里重新配置云同步，再从云端拉回。正在重启…",
          restart: true,
        };
      } catch (error) {
        log.app.error("[recovery] 云端恢复准备失败" + formatLogFields(errorFields(error)));
        return { ok: false, message: "云端恢复准备失败：" + (error instanceof Error ? error.message : String(error)) };
      }
    },
    async restoreFromBackup() {
      // Batch4-A：从整库备份导入恢复。文件选择框在主进程（渲染层拿不到任意路径），
      // defaultPath 与设置入口共用同一个选择框（autoBackup.backupsDir 单一来源）。
      const chosen = await pickBackupDatabaseDialog(userDataDir, { buttonLabel: "用此备份恢复" });
      if (!chosen) return { ok: false, message: "已取消选择备份文件" };
      if (!rememberRestoreCandidate(chosen)) {
        return { ok: false, message: "备份文件无效：请选择由本应用「整库备份/导出」产生的 metadata*.sqlite3 文件（其他文件名不支持）" };
      }
      const result = restoreMainDatabaseFromBackup({
        backupPath: chosen,
        currentDbPath: path.join(deps.workspaceRoot(), "metadata.sqlite3"),
        userDataDir,
      });
      if (!result.ok) {
        log.app.error("[recovery] 从备份恢复失败" + formatLogFields({ reason: result.reason ?? "", rolledBack: result.rolledBack ?? false }));
        return { ok: false, message: "从备份恢复失败：" + (result.message ?? result.reason ?? "未知原因") };
      }
      log.app.info("[recovery] 从备份恢复成功，原库隔离到 " + result.quarantinePath);
      return { ok: true, message: result.message ?? "已从备份恢复，正在重启…", restart: true };
    },
    async openDataFolder() {
      const openError = await shell.openPath(userDataDir);
      return openError
        ? { ok: false, message: "打开数据目录失败：" + openError }
        : { ok: true, message: "已打开数据目录：" + userDataDir };
    },
    restart() { app.relaunch(); app.exit(0); },
    quit() { app.quit(); },
  });
}
