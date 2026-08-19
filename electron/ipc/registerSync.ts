import type { IpcMainInvokeEvent } from "electron";
import type { QuickNotesStore } from "../quickNotes.js";
import type { Store } from "../store.js";
import { runDeepCleanup, runGcReconcile, testConnection, type SyncProgress } from "../sync.js";
import { runQuickNotesDeepCleanup } from "../quickNotesSync.js";
import { IpcInputError } from "../ipcLimits.js";
import type { IpcRegistrar } from "./registrar.js";

const MAX_S3_STRING_LENGTH = 2048;
const MAX_S3_KEY_LENGTH = 512;

/**
 * W-14：S3 Secret 掩码。get_s3_settings 不再把解密后的明文 Secret 返回渲染层
 * （渲染层所有 console 输出会经 console-message 转发落盘）。设置面板显示掩码；
 * 保存时若 secretAccessKey 仍为掩码则保留已存储密钥，否则按新值覆盖。
 */
export const S3_SECRET_MASK = "********";

interface ValidatedS3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function assertS3Settings(settings: unknown): asserts settings is ValidatedS3Settings {
  if (!settings || typeof settings !== "object") throw new IpcInputError("S3 配置格式无效");
  const s = settings as Record<string, unknown>;
  for (const key of ["endpoint", "region", "bucket", "prefix", "accessKeyId", "secretAccessKey"] as const) {
    const v = s[key];
    if (typeof v !== "string" || v.length > (key === "endpoint" || key === "region" ? MAX_S3_STRING_LENGTH : MAX_S3_KEY_LENGTH)) {
      throw new IpcInputError(`S3 配置字段 ${key} 无效`);
    }
  }
  if (typeof s.forcePathStyle !== "boolean") throw new IpcInputError("S3 配置 forcePathStyle 无效");
}

function clampNum(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback;
}

interface SyncIpcDeps {
  store: Store;
  quickNotes: QuickNotesStore;
  runFullSync(onProgress?: (progress: SyncProgress) => void): Promise<unknown>;
  enqueueMaintenance<T>(task: () => Promise<T>): Promise<T>;
  broadcastSyncProgress(progress: SyncProgress): void;
  restartGcTimers(): void;
  restartSyncTimers(): void;
}

export function registerSyncIpc(ipc: IpcRegistrar, deps: SyncIpcDeps): void {
  const { store, quickNotes, runFullSync, enqueueMaintenance, broadcastSyncProgress, restartGcTimers, restartSyncTimers } = deps;

  ipc.handle("get_s3_settings", () => {
    const settings = store.getS3Settings();
    if (!settings) return null;
    return { ...settings, secretAccessKey: S3_SECRET_MASK };
  });
  ipc.handle("save_s3_settings", (settings: unknown) => {
    assertS3Settings(settings);
    const next = { ...(settings as Parameters<Store["saveS3Settings"]>[0]) };
    // 掩码回传 = 用户未修改密钥 → 保留存储中的原值（含未配置时保持空）
    if (next.secretAccessKey === S3_SECRET_MASK) {
      next.secretAccessKey = store.getS3Settings()?.secretAccessKey ?? "";
    }
    store.saveS3Settings(next);
  });
  ipc.handle("test_s3_connection", () => testConnection(store));
  ipc.handle("get_s3_gc_settings", () => store.getS3GcSettings());
  ipc.handle("get_trash_reminder", () => store.listTrashReminder(store.getS3GcSettings().trashAutoPurgeDays));
  ipc.handle("save_s3_gc_settings", (settings: unknown) => {
    if (!settings || typeof settings !== "object") throw new IpcInputError("云端回收配置格式无效");
    const s = settings as Record<string, unknown>;
    store.saveS3GcSettings({
      gcRetentionDays: clampNum(s.gcRetentionDays, 7, 0, 3650),
      gcIntervalHours: clampNum(s.gcIntervalHours, 24, 0, 720),
      trashAutoPurgeDays: clampNum(s.trashAutoPurgeDays, 0, 0, 3650),
    });
    restartGcTimers();
  });
  ipc.handle("get_sync_settings", () => store.getSyncSettings());
  ipc.handle("save_sync_settings", async (settings: unknown) => {
    if (!settings || typeof settings !== "object") throw new IpcInputError("同步配置格式无效");
    const raw = settings as Record<string, unknown>;
    if (typeof raw.enabled !== "boolean") throw new IpcInputError("同步开关格式无效");
    if (raw.autoMode !== "interval" && raw.autoMode !== "onOpenClose" && raw.autoMode !== "manual") {
      throw new IpcInputError("同步模式格式无效");
    }
    const next: Parameters<Store["saveSyncSettings"]>[0] = {
      enabled: raw.enabled,
      autoMode: raw.autoMode,
      autoIntervalMinutes: clampNum(raw.autoIntervalMinutes, 15, 1, 1440),
    };
    const previous = store.getSyncSettings();
    if (previous.enabled && !next.enabled) {
      try {
        await runFullSync();
      } catch (error) {
        throw new Error(`关闭云同步前的最后对齐失败：${String(error)}`);
      }
    }
    store.saveSyncSettings(next);
    restartSyncTimers();
    restartGcTimers();
    if (!previous.enabled && next.enabled) {
      void runFullSync().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[sync] 重新开启后的对齐失败:", message);
        broadcastSyncProgress({ phase: "done", message: "同步失败", error: message });
      });
    }
    return store.getSyncSettings();
  });
  ipc.handle("list_s3_gc_pending", () => store.listS3GcPending());
  ipc.handle("list_s3_gc_log", () => store.listS3GcLog());
  ipc.handle("run_s3_gc_reconcile", () => {
    if (!store.getSyncSettings().enabled) throw new Error("云同步已关闭");
    return enqueueMaintenance(() => runGcReconcile(store));
  });
  ipc.handle("run_s3_deep_cleanup", (dryRun: boolean) => {
    if (!store.getSyncSettings().enabled) throw new Error("云同步已关闭");
    return enqueueMaintenance(async () => {
      const settings = store.getS3Settings();
      if (!settings) throw new Error("请先保存 S3 配置");
      const gcSettings = store.getS3GcSettings();
      const lake = await runDeepCleanup(store, { dryRun: !!dryRun });
      const quick = await runQuickNotesDeepCleanup(quickNotes, settings, { dryRun: !!dryRun, gcRetentionDays: gcSettings.gcRetentionDays });
      return { dryRun: !!dryRun, lake, quickNotes: quick };
    });
  });
  ipc.handleEvent("sync_now", (event: IpcMainInvokeEvent) => {
    if (!store.getSyncSettings().enabled) throw new Error("云同步已关闭，请先在偏好设置中开启");
    const send = (progress: SyncProgress) => {
      try { event.sender.send("sync-progress", progress); } catch { /* 窗口已关闭 */ }
    };
    return runFullSync(send);
  });
  ipc.handle("get_sync_status", () => store.getSyncStatus());
}
