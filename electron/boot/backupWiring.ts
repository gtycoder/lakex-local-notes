/**
 * 自动备份装配（C-04 从 main.ts J 原样搬出）：主库 + 小记库整库备份（VACUUM INTO + 轮转）。
 * 就绪后每 6h tick、启动不立即跑（避免抢首屏/首同步 IO）；单飞 + 维护域串行；内容未变（size+mtime）
 * 跳过；失败只记日志、绝不阻断主流程。小记库降级（损坏）时不带路径 ⇒ 不备份小记库、结果明说。
 * 边界：只装配 runner 与 tick；判定/轮转实现 = electron/autoBackup.ts；runner 经 registerIpc 暴露给设置页。
 * 契约：备份目录 <userData>/backups/（与启动恢复页同口径）；设置本机、不进 git/同步。
 */
import { app } from "electron";
import path from "node:path";
import { AUTO_BACKUP_TICK_MS, decideAutoBackup, readDatabaseFingerprint, runBackupCycle } from "../autoBackup.js";
import type { BackupIpcRunner } from "../ipc/registerBackupIpc.js";
import { getQuickNotesAvailability } from "../quickNotesAvailability.js";
import type { Store } from "../store.js";
import { log } from "../logger.js";

export interface BackupWiringDeps {
  store: Store;
  /** 维护域串行队列（唯一实现在 main.ts；备份与同步/GC 互斥）。 */
  enqueueMaintenance: <T>(task: () => Promise<T>) => Promise<T>;
  workspaceRoot: () => string;
}

export function startAutoBackup(deps: BackupWiringDeps): BackupIpcRunner {
  // 261105 Batch4-E：自动备份（主库 + 小记库）。就绪后**每 6h tick，启动不立即跑**；单飞 + 维护域串行，
  // 内容未变（size+mtime）跳过；轮转保留 N 份/总大小上限。失败只记日志，绝不阻断主流程。
  let autoBackupBusy = false;
  const runBackup = async (manual: boolean): Promise<{ state: ReturnType<Store["getAutoBackupState"]>; message: string }> => {
    if (autoBackupBusy) return { state: deps.store.getAutoBackupState(), message: "已有备份正在进行中" };
    autoBackupBusy = true;
    try {
      // 维护域串行（与同步/GC 互斥）：runBackupCycle 做 VACUUM INTO + 轮转，不在写域、不阻塞本地保存。
      return await deps.enqueueMaintenance(async () => {
        const settings = deps.store.getAutoBackupSettings();
        const state = deps.store.getAutoBackupState();
        const mainDbPath = path.join(deps.workspaceRoot(), "metadata.sqlite3");
        const decision = decideAutoBackup({
          enabled: settings.enabled,
          busy: false,
          nowMs: Date.now(),
          lastBackupAtMs: state ? Date.parse(state.lastBackupAt) || null : null,
          intervalDays: settings.intervalDays,
          fingerprint: readDatabaseFingerprint(mainDbPath),
          lastFingerprint: state?.fingerprint ?? null,
          manual,
        });
        if (!decision.run) {
          log.app.info("[backup] 本轮跳过（" + decision.reason + "）");
          return { state, message: "未备份（" + (manual ? "内容未变" : decision.reason) + "）" };
        }
        const result = runBackupCycle({
          userDataDir: app.getPath("userData"),
          mainDbPath,
          // 小记库降级（损坏）时不带路径 ⇒ 不备份小记库，结果明说「小记库不可用」。
          quickNotesDbPath: getQuickNotesAvailability().mode === "ok" ? path.join(deps.workspaceRoot(), "quick-notes", "metadata.sqlite3") : null,
          settings,
          log: (message) => log.app.info(message),
        });
        if (result.state) {
          try { deps.store.saveAutoBackupState(result.state); } catch (error) { log.app.warn("[backup] 状态落盘失败：" + (error as Error).message); }
        }
        return { state: result.state, message: result.message };
      });
    } catch (error) {
      log.app.warn("[backup] 备份失败（不阻断主流程）：" + (error as Error).message);
      return { state: deps.store.getAutoBackupState(), message: "备份失败：" + (error as Error).message };
    } finally {
      autoBackupBusy = false;
    }
  };
  const runner: BackupIpcRunner = {
    getSettings: () => deps.store.getAutoBackupSettings(),
    getState: () => deps.store.getAutoBackupState(),
    saveSettings: (settings) => deps.store.saveAutoBackupSettings(settings),
    runNow: () => runBackup(true),
  };
  // 每 6h tick；首 tick 在 6h 后（启动不立即跑，避免抢首屏/首同步 IO）。
  const timer = setInterval(() => { void runBackup(false); }, AUTO_BACKUP_TICK_MS);
  timer.unref?.();
  return runner;
}
