import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerBackupIpc, type BackupIpcRunner } from "./registerBackupIpc.js";
import { backupsDir, AUTO_BACKUP_DEFAULTS, type AutoBackupSettings, type AutoBackupState } from "../autoBackup.js";
import { IpcInputError } from "../ipcLimits.js";

/**
 * 261105 task-68：备份可观测 IPC —— `get_backup_usage` 只读统计 <userData>/backups。
 * 这里用真目录（fs.stat）+ 假 runner，守住「只读、不读文件内容、目录不存在不报错」与三处接线里的注册侧。
 */
type Handler = (...args: unknown[]) => unknown;

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-backup-ipc-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理尽力而为 */ }
  }
});

const STATE: AutoBackupState = {
  lastBackupAt: "2026-11-06T14:08:04.000Z",
  result: "partial",
  message: "已备份主库：metadata-x.sqlite3；注意：小记库不可用：本次未备份小记库",
  fingerprint: null,
  mainFile: "metadata-x.sqlite3",
  quickNotesFile: null,
};

function harness(userDataDir: string) {
  const handlers = new Map<string, Handler>();
  const ipc = {
    handle: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    handleEvent: (channel: string, handler: Handler) => { handlers.set(channel, handler); },
    registry: new Map(),
  };
  const saved: AutoBackupSettings[] = [];
  const runNow = vi.fn(async () => ({ state: STATE, message: STATE.message }));
  let settings: AutoBackupSettings = { ...AUTO_BACKUP_DEFAULTS };
  const runner: BackupIpcRunner = {
    getSettings: () => settings,
    getState: () => STATE,
    saveSettings: (next) => { settings = next; saved.push(next); },
    runNow,
  };
  registerBackupIpc(ipc as unknown as Parameters<typeof registerBackupIpc>[0], { runner, userDataDir });
  return {
    saved,
    runNow,
    channels: () => [...handlers.keys()].sort(),
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
  };
}

function writeBackup(dir: string, name: string, bytes: number): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.alloc(bytes));
}

describe("registerBackupIpc：通道注册", () => {
  it("注册 4 个通道：读取设置/保存设置/立即备份/只读占用", () => {
    const h = harness(tempDir());
    expect(h.channels()).toEqual(["get_backup_settings", "get_backup_usage", "run_backup_now", "save_backup_settings"]);
  });

  it("get_backup_settings 同时返回配置与上次状态；run_backup_now 直接转接 runner", async () => {
    const h = harness(tempDir());
    expect(h.call("get_backup_settings")).toEqual({ settings: AUTO_BACKUP_DEFAULTS, state: STATE });
    const result = await h.call("run_backup_now");
    expect(h.runNow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ state: STATE, message: STATE.message });
  });
});

describe("registerBackupIpc：save_backup_settings 参数校验（不静默降级）", () => {
  it("合法配置：归一后落盘并回传", () => {
    const h = harness(tempDir());
    const next = { enabled: false, intervalDays: 7, keepCount: 3, maxTotalBytes: 100 * 1024 * 1024 };
    expect(h.call("save_backup_settings", next)).toEqual({ settings: next });
    expect(h.saved).toEqual([next]);
  });

  it("非法配置一律 IpcInputError，且不写设置", () => {
    const h = harness(tempDir());
    for (const bad of [null, {}, { enabled: true, intervalDays: 3, keepCount: 7, maxTotalBytes: 300 * 1024 * 1024 }, { enabled: "yes" }]) {
      expect(() => h.call("save_backup_settings", bad)).toThrowError(IpcInputError);
    }
    expect(h.saved).toEqual([]);
  });
});

describe("registerBackupIpc：get_backup_usage（只读 stat）", () => {
  it("没有备份目录 ⇒ exists:false、0 份（首次启动的常态，不报错）", () => {
    const userDataDir = tempDir();
    const usage = harness(userDataDir).call("get_backup_usage") as Record<string, unknown>;
    expect(usage).toMatchObject({ dir: backupsDir(userDataDir), exists: false, groups: 0, files: 0, totalBytes: 0, newestAt: null, oldestAt: null });
  });

  it("有多份备份 ⇒ 份数/字节/最新时间正确（路径口径 = backupsDir，不手拼）", () => {
    const userDataDir = tempDir();
    const dir = backupsDir(userDataDir);
    writeBackup(dir, "metadata-2026-11-01T00-00-00.sqlite3", 4096);
    writeBackup(dir, "quicknotes-2026-11-01T00-00-00.sqlite3", 1024);
    writeBackup(dir, "metadata-2026-11-02T00-00-00.sqlite3", 4096);
    writeBackup(dir, "quicknotes-2026-11-02T00-00-00.sqlite3", 1024);
    const usage = harness(userDataDir).call("get_backup_usage") as Record<string, unknown>;
    expect(usage).toMatchObject({
      dir,
      exists: true,
      groups: 2,
      files: 4,
      totalBytes: 10240,
      newestAt: "2026-11-02T00:00:00.000Z",
      oldestAt: "2026-11-01T00:00:00.000Z",
      warnings: [],
    });
  });
});
