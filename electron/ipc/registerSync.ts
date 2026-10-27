import { app, BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import type { QuickNotesStore } from "../quickNotes.js";
import type { Store } from "../store.js";
import { restoreMissingBodyFromCloud } from "../syncEngineController.js";
import { testConnection } from "../s3Store.js";
import type { SyncProgress } from "../syncTypes.js";
import { runV3DeepCleanup } from "../s3v3/desktopSync.js";
import { AppError } from "../../src/core/storeErrors.js";
import { canTouchNetwork, cloudStateHint, cloudStateOf } from "../../src/core/cloudState.js";
import { decodeS3ConfigTransfer, s3ConfigTransferFileName, summarizeS3Settings } from "../../src/core/s3ConfigTransfer.js";
import { readS3ConfigFile, writeS3ConfigFile } from "../s3ConfigTransferFile.js";
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

  /** 联网入口的**统一判据**（core/cloudState）：没配置 S3 或关闭了云同步 ⇒ 一律不出网。
   *  用户 261006：「关闭云同步 = 当作完全没配置 / 离线本地空间」——所有联网 IPC 都先过这一关。 */
  const requireCloud = (): void => {
    const state = cloudStateOf(!!store.getS3Settings(), store.getSyncSettings());
    if (!canTouchNetwork(state)) throw new AppError("NotConfigured", cloudStateHint(state) ?? "云同步不可用");
  };

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
  /**
   * S3 配置迁移（对应思源「导入 / 导出 S3 配置」）：
   * - **文件**是主路径：对话框、加密封装、解码都在主进程，渲染层拿不到明文 Secret（延续 W-14）。
   * - **粘贴迁移码**保留为备用（手机端「导出迁移码」→ 桌面粘贴导入）。
   */
  const s3TransferWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  ipc.handle("export_s3_config_file", async () => {
    const settings = store.getS3Settings();
    if (!settings) throw new AppError("NotConfigured", "本机还没有保存 S3 配置，请先填写并保存");
    const result = await dialog.showSaveDialog(s3TransferWindow(), {
      title: "导出 S3 配置",
      defaultPath: path.join(app.getPath("downloads"), s3ConfigTransferFileName()),
      filters: [{ name: "Lake S3 配置", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await writeS3ConfigFile(result.filePath, settings);
    return { ok: true, path: result.filePath };
  });
  ipc.handle("import_s3_config_file", async () => {
    const result = await dialog.showOpenDialog(s3TransferWindow(), {
      title: "导入 S3 配置",
      properties: ["openFile"],
      filters: [{ name: "Lake S3 配置", extensions: ["json", "txt"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
    const settings = await readS3ConfigFile(result.filePaths[0]);
    store.saveS3Settings(settings);
    return { ok: true, summary: summarizeS3Settings(settings) };
  });
  ipc.handle("import_s3_config", async (code: unknown) => {
    if (typeof code !== "string" || code.length > 16 * 1024) throw new IpcInputError("S3 迁移码格式无效");
    const settings = await decodeS3ConfigTransfer(code);
    store.saveS3Settings(settings);
    return { summary: summarizeS3Settings(settings) };
  });
  ipc.handle("test_s3_connection", () => testConnection(store));
  ipc.handle("get_s3_gc_settings", () => store.getS3GcSettings());
  ipc.handle("get_trash_reminder", () => store.listTrashReminder(store.getS3GcSettings().trashAutoPurgeDays));
  ipc.handle("run_data_health_check", () => store.runDataHealthCheck());
  /** 资源页「缺正文」→ 从云端拉回（显式动作；失败以 reason 回报，不抛）。
   *  **必须进维护域**：读清单 + 取对象都是出网往返，落地后还要改 sync_base / sync_state
   *  —— 与整轮同步/GC 并发会互踩同一篇的账本（AGENTS §4 互斥域 I3 / 单一队列），故走 enqueueMaintenance。 */
  ipc.handle("restore_missing_body_from_cloud", (id: string) =>
    enqueueMaintenance(() => restoreMissingBodyFromCloud(store, id)));
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
      // 按需资产（P0-4）：只接受显式 true（缺省 undefined = 全量语义）。
      ...(raw.deferAssets === true ? { deferAssets: true } : {}),
    };
    const previous = store.getSyncSettings();
    let alignWarning: string | undefined;
    if (previous.enabled && !next.enabled) {
      // 关掉云同步是**本地动作**：S3 连不上也必须能关（用户恰恰在 S3 不可用时最想关掉它，261006 实测关不掉）。
      // 最后对齐降级为 best-effort：失败只回一条 warning，下次开启同步时会继续对齐。
      try { await runFullSync(); }
      catch (error) { alignWarning = String(error); store.logScopes.sync.warn(`[sync] 关闭云同步前的最后对齐失败（已关闭，下次开启同步时继续）: ${String(error)}`); }
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
    return { ...store.getSyncSettings(), alignWarning };
  });
  ipc.handle("list_s3_gc_pending", () => store.listS3GcPending());
  ipc.handle("list_s3_gc_log", () => store.listS3GcLog());
  ipc.handle("run_s3_deep_cleanup", (dryRun: boolean, _ignoreRetention = false) => {
    requireCloud();
    return enqueueMaintenance(async () => {
      const settings = store.getS3Settings();
      if (!settings) throw new AppError("NotConfigured", "请先保存 S3 配置");
      // v3 统一深度清理（文档 + 小记）；ignoreRetention 由 v3 自身 pending 门禁负责，不再使用旧窗口。
      const result = await runV3DeepCleanup(store, { dryRun: !!dryRun });
      return { dryRun: !!dryRun, deleted: result.deleted, kept: result.kept };
    });
  });
  ipc.handleEvent("sync_now", (event: IpcMainInvokeEvent) => {
    requireCloud();   // 没配置 / 关闭云同步 ⇒ 一个请求都不发（渲染层也拦，这里是兜底）
    const send = (progress: SyncProgress) => {
      try { event.sender.send("sync-progress", progress); } catch { /* 窗口已关闭 */ }
    };
    return runFullSync(send);
  });
  ipc.handle("get_sync_status", () => store.getSyncStatus());
  ipc.handle("get_sync_pending_summary", () => {
    const lake = store.getSyncPendingSummary();
    const quick = quickNotes.getPendingSyncSummary();
    const summary = { documents: lake.documents, folders: lake.folders, resources: 0, quickNotes: quick.items, generatedAt: new Date().toISOString() };
    return { ...summary, total: summary.documents + summary.folders + summary.quickNotes };
  });
}
