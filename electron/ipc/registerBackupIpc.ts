/**
 * 261105 Batch4-E：自动备份 IPC（读取配置/状态、保存配置、立即备份、备份目录占用）。
 *
 * 备份本身由 main 的 AutoBackup 调度器实现（VACUUM INTO 主库+小记库、轮转、单飞、内容未变跳过）；
 * 这里只做参数校验与转接，非法配置直接拒绝（不静默降级）。
 * 261105 task-68：「备份占用」= 只读 stat（份数/总字节/最新最旧），**不读文件内容**、不删任何文件。
 */
import { IpcInputError } from "../ipcLimits.js";
import type { IpcRegistrar } from "./registrar.js";
import { backupsDir, measureBackupUsage, normalizeAutoBackupSettings, type AutoBackupSettings, type AutoBackupState, type BackupUsage } from "../autoBackup.js";

export interface BackupIpcRunner {
  getSettings(): AutoBackupSettings;
  getState(): AutoBackupState | null;
  saveSettings(settings: AutoBackupSettings): void;
  runNow(): Promise<{ state: AutoBackupState | null; message: string }>;
}

export function registerBackupIpc(ipc: IpcRegistrar, deps: { runner: BackupIpcRunner; userDataDir: string }): void {
  const { runner, userDataDir } = deps;
  ipc.handle("get_backup_settings", () => ({ settings: runner.getSettings(), state: runner.getState() }));
  ipc.handle("save_backup_settings", (raw: unknown) => {
    const settings = normalizeAutoBackupSettings(raw);
    if (!settings) throw new IpcInputError("自动备份配置无效（启用/间隔 1|7 天/保留份数 1-50/大小上限 10MB-5GB）");
    runner.saveSettings(settings);
    return { settings };
  });
  ipc.handle("run_backup_now", () => runner.runNow());
  // 只读统计：目录口径与轮转同一个 backupsDir（不手拼路径）；目录不存在返回 exists:false 而不是报错。
  ipc.handle("get_backup_usage", (): BackupUsage => measureBackupUsage(backupsDir(userDataDir)));
}
