import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { type Store } from "../store.js";
import type { QuickNotesStore } from "../quickNotes.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./deviceStore.js";
import { migratePersisted } from "../../src/core/s3v3/state/intentLogState.js";
import {
  createDeviceStoreMeta, createFileBackedAssetIo, mergeSyncMarkers,
  type AssetIoPort, type DeviceStoreMeta,
} from "../../src/core/s3v3/state/deviceStore.js";
import { createDesktopPlatformPort } from "./desktopPlatformPort.js";
import { createNodeFileDriver } from "./nodeFileDriver.js";

/**
 * 桌面现有 Store → S3v3DeviceStore 适配器（E2-4：**薄壳**）。
 *
 * 决策/映射（loadState/saveState/saveFolders/saveQuickNotes/资产 IO/信封迁移）都在
 * src/core/s3v3/state/deviceStore.ts；本文件只做：
 * - 平台装配：`PlatformDataPort`（Store/QuickNotesStore）＋ `FileDriver`（fs）；
 * - 平台私有生命周期：正文 staging（引擎 writeBody → saveState 落盘）、正文 hash 缓存、
 *   「资产目录延迟删」（行/正文落库后再删）、quick-notes 库存在性护栏；
 * - baseline 文件（gzip）与 saveBaseline 的 UI dirty 清理。
 */
export class DesktopStoreDevice implements S3v3DeviceStore {
  static readonly MISSING_SCAN_INTERVAL_MS = 15 * 60_000;
  private readonly store: Store;
  private readonly stateFile: string;
  private readonly baselineFile: string;
  private readonly stagedBodies = new Map<string, Uint8Array>();
  /** 已登记删除的资产目录：延迟到该篇正文/行落库之后再真删（P0-3 顺序要求）。 */
  private readonly clearedAssets = new Set<string>();
  private readonly skipQuickNotesGuard: boolean;
  /** 正文 hash 缓存：文件 mtime+size 未变则复用，避免每轮全库读正文。首次/变更文件才重算。 */
  private readonly hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();
  private readonly quickNotes?: QuickNotesStore;
  /** 同步期兜底创建/复用的目录（未进远端索引）：同轮 deleteMissing 不得删，否则文档父级悬空。 */
  private readonly protectedFolderIds = new Set<string>();
  /** 本轮 loadState 时缺正文队列是否非空（决定 saveState 收尾要不要清库；正常轮为 false）。 */
  private sawRecoverySeen = false;
  private readonly assetIo: AssetIoPort;
  private readonly meta: DeviceStoreMeta;

  constructor(store: Store, storeRoot: string, opts: { stateFile?: string; baselineFile?: string; skipQuickNotesGuard?: boolean; quickNotes?: QuickNotesStore } = {}) {
    this.skipQuickNotesGuard = !!opts.skipQuickNotesGuard;
    this.quickNotes = opts.quickNotes;
    this.store = store;
    const dir = path.join(storeRoot, "sync-v3");
    this.stateFile = opts.stateFile ?? path.join(dir, "state.json");
    this.baselineFile = opts.baselineFile ?? path.join(dir, "baseline.json.gz");
    const files = createNodeFileDriver();
    const quick = this.quickNotes;
    this.assetIo = createFileBackedAssetIo({
      files,
      assetDirFor: (noteId: string) => this.store.noteAssetsPathFor(noteId),
      ...(quick ? { quickAssetDirFor: (quickNoteId: string) => quick.quickNoteAssetsPathFor(quickNoteId) } : {}),
      // 桌面：删除资产目录必须延迟到正文/行落库之后，这里只登记（saveState 内按篇 flush）。
      removeAssetsDir: async (noteId: string) => { this.clearedAssets.add(noteId); },
    });
    this.meta = createDeviceStoreMeta({
      platform: createDesktopPlatformPort(store, quick),
      files,
      assets: this.assetIo,
      state: {
        read: () => this.readJson<unknown>(this.stateFile),
        write: (persisted) => this.writeAtomic(this.stateFile, JSON.stringify(persisted)),
      },
      baseline: { load: () => this.loadBaseline() },
      stagedBodies: this.stagedBodies,
      hashCache: this.hashCache,
      protectedFolderIds: this.protectedFolderIds,
      markRecoverySeen: (seen: boolean) => { this.sawRecoverySeen = seen; },
      recoveryConsumed: () => {
        if (!this.sawRecoverySeen) return;
        try { this.store.clearBodyRecoveryPending(); } catch { /* 清理失败不影响同步结果 */ }
        this.sawRecoverySeen = false;
      },
      flushAssetDirDeletion: async (noteId: string) => {
        if (!this.clearedAssets.has(noteId)) return;
        try { await fs.rm(this.store.getNotePaths(noteId).assetsDir, { recursive: true, force: true }); } catch { /* ignore */ }
      },
      clearAssetDirDeletions: () => this.clearedAssets.clear(),
      log: (message: string) => this.store.logScopes.sync.info(message),
    });
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    if (!this.quickNotes && !this.skipQuickNotesGuard) {
      const quickDb = path.join(path.dirname(this.stateFile), "..", "quick-notes", "metadata.sqlite3");
      if (await this.exists(quickDb)) throw new Error("DesktopStoreDevice: quick notes store 未注入（拒绝静默跳过小记）");
    }
  }

  private async exists(p: string): Promise<boolean> { try { await fs.stat(p); return true; } catch { return false; } }
  private async readJson<T>(file: string): Promise<T | null> {
    try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { return null; }
  }
  private async writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
    const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  }

  // ===== E2-4：世界状态编排 = core 单一实现 =====
  async loadState(): Promise<DeviceState | null> { return this.meta.loadState(); }
  async saveState(state: DeviceState): Promise<void> { return this.meta.saveState(state); }

  async loadBaseline(): Promise<DeviceBaseline | null> {
    try { return JSON.parse(gunzipSync(await fs.readFile(this.baselineFile)).toString("utf8")) as DeviceBaseline; } catch { return null; }
  }
  async saveBaseline(baseline: DeviceBaseline): Promise<void> {
    await this.writeAtomic(this.baselineFile, gzipSync(Buffer.from(JSON.stringify(baseline)), { level: 1 }));
    // baseline 只在发布成功后写 ⇒ 这里批量清 UI dirty；20k 也只两条批量 UPDATE。
    this.store.markNotesSynced(baseline.lake.notes.map((n) => n.id));
  }

  /**
   * 缺正文清单（261028，内核自愈用）：staging 优先；其余走 Store.readNote 一次读盘。
   * 「真的观察到正文缺失才入队」（事件驱动，正常同步不扫描）。
   */
  async readBody(id: string): Promise<Uint8Array | null> {
    const staged = this.stagedBodies.get(id);
    if (staged) return staged;
    try {
      const doc = this.store.readNote(id);
      if (doc.bodyMissing) {
        this.store.markBodyRecoveryPending([id]);
        return null;
      }
      return new TextEncoder().encode(doc.content);
    } catch { return null; }
  }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> { this.stagedBodies.set(id, bytes); }
  async deleteBody(id: string): Promise<void> { this.stagedBodies.delete(id); }
  async writeHistory(id: string, bytes: Uint8Array): Promise<string> {
    try { this.store.createHistorySnapshot(id, new TextDecoder().decode(bytes), true); } catch { /* ignore */ }
    return id;
  }
  async archiveBody(id: string, bytes: Uint8Array | null): Promise<void> { if (bytes) await this.writeHistory(id, bytes); }

  // ===== E2-4：资产 IO = core 单一实现（这里只委托）=====
  async listAssets(id: string): Promise<string[]> { return this.assetIo.listAssets(id); }
  async readAsset(id: string, filename: string): Promise<Uint8Array | null> { return this.assetIo.readAsset(id, filename); }
  async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> { return this.assetIo.writeAsset(id, filename, bytes); }
  async deleteAssetsDir(id: string): Promise<void> { return this.assetIo.deleteAssetsDir(id); }
  async listQuickAssets(id: string): Promise<string[]> { return this.assetIo.listQuickAssets(id); }
  async readQuickAsset(id: string, filename: string): Promise<Uint8Array | null> { return this.assetIo.readQuickAsset(id, filename); }
  async writeQuickAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> { return this.assetIo.writeQuickAsset(id, filename, bytes); }
  async deleteQuickAssetsDir(id: string): Promise<void> { return this.assetIo.deleteQuickAssetsDir(id); }

  async readQuickBody(id: string): Promise<Uint8Array | null> {
    if (!this.quickNotes) return null;
    try { return new Uint8Array(await fs.readFile(this.quickNotes.quickNotePathFor(id))); } catch { return null; }
  }
  async writeQuickBody(id: string, bytes: Uint8Array): Promise<void> {
    if (!this.quickNotes) throw new Error("quickNotes 未注入");
    const file = this.quickNotes.quickNotePathFor(id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.writeAtomic(file, bytes);
  }
  async deleteQuickBody(id: string): Promise<void> {
    if (!this.quickNotes) return;
    try { await fs.unlink(this.quickNotes.quickNotePathFor(id)); } catch { /* 已不存在 */ }
  }

  /** 轻量落盘同步标记：不跑整轮 saveState（不碰正文/脏标记），只清信封标记 + DB cloud_deleted 投影。 */
  async persistSyncMarkers(markers: { remotePurged: string[]; restorePending: string[] }): Promise<void> {
    try { this.store.applyNotesCloudDeleted(markers.remotePurged); } catch { /* 投影失败不阻断 */ }
    // E3-1 信封化后：必须把标记并进 envelope（spread 旧 JSON + 覆盖顶层键会静默丢标记）。
    const persisted = migratePersisted(await this.readJson<unknown>(this.stateFile));
    if (!persisted) return;
    await this.writeAtomic(this.stateFile, JSON.stringify(mergeSyncMarkers(persisted, markers)));
  }

  /** 单条推送记账：markSynced 同时清 restore_pending_at；按内容 hash 未变才标（I2 守卫）。 */
  async markQuickNoteSynced(id: string, expectedContentHash: string): Promise<void> {
    if (!this.quickNotes) return;
    this.quickNotes.markSyncedIfUnchanged(id, expectedContentHash);
  }

  /** 小记冲突副本：本地版本归档为小记回收站里的**新 id**（纯本地，不向云端发布删除/新增）。 */
  async archiveQuickNote(id: string): Promise<void> {
    if (!this.quickNotes) return;
    this.quickNotes.archiveLocalToTrash(id);
  }
}
