import type { IpcMainInvokeEvent } from "electron";
import type { QuickNotesStore } from "../quickNotes.js";
import type { Store } from "../store.js";
import { runDeepCleanup, runGcReconcile, testConnection, type SyncProgress } from "../sync.js";
import { runQuickNotesDeepCleanup } from "../quickNotesSync.js";
import type { IpcRegistrar } from "./registrar.js";

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

  ipc.handle("get_s3_settings", () => store.getS3Settings());
  ipc.handle("save_s3_settings", (settings: unknown) => store.saveS3Settings(settings as Parameters<Store["saveS3Settings"]>[0]));
  ipc.handle("test_s3_connection", () => testConnection(store));
  ipc.handle("get_s3_gc_settings", () => store.getS3GcSettings());
  ipc.handle("get_trash_reminder", () => store.listTrashReminder(store.getS3GcSettings().trashAutoPurgeDays));
  ipc.handle("save_s3_gc_settings", (settings: unknown) => {
    store.saveS3GcSettings(settings as Parameters<Store["saveS3GcSettings"]>[0]);
    restartGcTimers();
  });
  ipc.handle("get_sync_settings", () => store.getSyncSettings());
  ipc.handle("save_sync_settings", async (settings: unknown) => {
    const next = settings as Parameters<Store["saveSyncSettings"]>[0];
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
