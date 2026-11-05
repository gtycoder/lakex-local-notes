/**
 * 261105 Batch4-E：自动备份 IPC（读取配置/状态、保存配置、立即备份）。
 *
 * 备份本身由 main 的 AutoBackup 调度器实现（VACUUM INTO 主库+小记库、轮转、单飞、内容未变跳过）；
 * 这里只做参数校验与转接，非法配置直接拒绝（不静默降级）。
 */
import { IpcInputError } from "../ipcLimits.js";
import type { IpcRegistrar } from "./registrar.js";
import { normalizeAutoBackupSettings, type AutoBackupSettings, type AutoBackupState } from "../autoBackup.js";

export interface BackupIpcRunner {
  getSettings(): AutoBackupSettings;
  getState(): AutoBackupState | null;
  saveSettings(settings: AutoBackupSettings): void;
  runNow(): Promise<{ state: AutoBackupState | null; message: string }>;
}

export function registerBackupIpc(ipc: IpcRegistrar, deps: { runner: BackupIpcRunner }): void {
  const { runner } = deps;
  ipc.handle("get_backup_settings", () => ({ settings: runner.getSettings(), state: runner.getState() }));
  ipc.handle("save_backup_settings", (raw: unknown) => {
    const settings = normalizeAutoBackupSettings(raw);
    if (!settings) throw new IpcInputError("自动备份配置无效（启用/间隔 1|7 天/保留份数 1-50/大小上限 10MB-5GB）");
    runner.saveSettings(settings);
    return { settings };
  });
  ipc.handle("run_backup_now", () => runner.runNow());
}
