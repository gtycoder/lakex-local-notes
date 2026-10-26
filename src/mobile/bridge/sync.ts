import { writeLocalStorage } from "../../lib/localStorageSafe";
import { listAssetKeysFs, loadAssetBytesFs, saveAssetBytesFs, listNoteAssetKeysFs } from "../native/assetFs";
import type { SyncConfig, SyncReport } from "../../core/syncEngineTypes.js";
import { backfillV3Assets, type AssetBackfillPort } from "../../core/s3v3AssetBackfill.js";
import { createMobileS3v3Remote } from "../v3/s3v3Remote.js";
import { buildGcKeepSet } from "../../core/gcDecisions.js";
import { normalizeEndpoint, parseLakeManifest, validateS3Settings } from "../../core/syncUtils.js";
import type { Manifest } from "../../core/manifestTypes.js";
import type { QuickNotesSyncResult } from "../../core/quickNoteSyncTypes.js";
import { createCapacitorS3Store } from "../native/s3Store";
import { canTouchNetwork, cloudStateHint, cloudStateOf, type CloudState } from "../../core/cloudState.js";
import type { S3Settings, SyncSettings } from "../../lib/types";
import type { QuickNotePushOutcome } from "../../core/quickNoteSyncTypes.js";
import { mobileSecretStore } from "../native/secretStore.js";
import { writeSyncStatus } from "../sync/syncStatusStore";
import * as gcRepository from "../data/gcRepository.js";
import * as historyRepository from "../data/historyRepository.js";
import * as diagnosticsRepository from "../data/diagnosticsRepository.js";
import { DEFAULT_S3_PREFIX, S3_STORAGE_KEY, SYNC_STORAGE_KEY, readSyncSettings, ensureDb, dbPort, assertS3Credentials, createS3Client, runWrite, runMaintenance } from "./context";
import { reconcileIndex } from "../data/searchIndex.js";
import { runMobileV3PushQuickNote, runMobileV3Sync } from "../v3/sync.js";

export interface MobileSyncResult {
  message: string;
  notes: SyncReport | null;
  quickNotes: QuickNotesSyncResult | { error: string } | null;
  /** 同步收尾对账搜索索引的耗时（ms）；移动端性能专项观测用。 */
  indexMs?: number;
  /** v3 结构化警告（缺正文/资源缺失等；与桌面 SyncResult.warnings 同构，供 UI 展示）。 */
  warnings?: import("../../lib/types").SyncWarning[];
}

/** 云端状态（单一判据，与桌面同源 src/core/cloudState）：没配置 或 关闭云同步 ⇒ 一律不出网。 */
export async function mobileCloudState(): Promise<CloudState> {
  const cfg = await syncDomain.getS3Settings();
  return cloudStateOf(Boolean(cfg), readSyncSettings());
}
/** 下载这些笔记的已声明资产（best-effort）；失败不阻断调用方（恢复/预览红线）。
 * v3 原生路径（261026 parity B6）：pointer→索引→该篇 assetsHash→声明对象→本地差集下载，
 * 旧实现读的 declared_assets 表在 v3 下永远为空（空操作）。
 * @param onlyMissing true = 只补本地缺失的资源（预览用）；false = 强拉全量（恢复用） */
export async function downloadDeclaredAssetsFor(noteIds: string[], onlyMissing = false): Promise<void> {
  if (noteIds.length === 0) return;
  try {
    // 单一判据：没配置 或 关闭云同步 ⇒ **一个请求都不发**（用户 261006：关闭云同步 = 离线本地空间）
    const state = await mobileCloudState();
    if (!canTouchNetwork(state)) { console.info(`[asset] 跳过补拉（${state}）`); return; }
    const cfg = await syncDomain.getS3Settings();
    if (!cfg) return;
    const remote = createMobileS3v3Remote(cfg);
    const port: AssetBackfillPort = {
      listLocal: async (id) => (await listNoteAssetKeysFs(id)).map((k) => (k.startsWith(id + "/") ? k.slice(id.length + 1) : k)),
      readLocal: async (id, filename) => loadAssetBytesFs(id + "/" + filename),
      writeLocal: async (id, filename, bytes) => saveAssetBytesFs(id + "/" + filename, bytes),
    };
    for (const noteId of noteIds) {
      const result = await backfillV3Assets(remote, "lake", noteId, port, { force: !onlyMissing });
      if (result.warnings.length > 0) console.warn(`[asset] ${noteId} 补拉: ` + result.warnings.slice(0, 5).join(" | "));
      console.info(`[asset] ${noteId} found=${result.found} down=${result.downloaded} skip=${result.skipped} missing=${result.missing.length} failed=${result.failed.length}`);
    }
  } catch (e) {
    console.warn("[asset] 资源下载失败（保留调用方，资源下次同步补拉）", e);
  }
}


/** 单条推送（「保存并同步」；云状态判据在调用方）。
 * v3 parity E2：只 upsert 这一条（其余条目/标签/墓碑云端逐字段不变）；
 * 必须整轮的两条路径（云端无 pointer/无基线/不同代、远端墓碑未恢复）执行一次整轮并回传 full-sync。 */
export async function pushSingleQuickNote(id: string): Promise<QuickNotePushOutcome> {
  const cfg = await syncDomain.getS3Settings();
  if (!cfg) throw new Error("未配置 S3");
  try { assertS3Credentials(cfg); } catch (e) { throw new Error((e as Error).message); }
  const d = await ensureDb();
  const result = await runMobileV3PushQuickNote(d, cfg, id);
  if (result.status === "not-found") return { status: "not-found" };
  if (result.status === "full-sync") {
    const full = await runMobileV3Sync(d, cfg);
    return {
      status: "full-sync",
      reason: result.reason === "remote-deleted" ? "remote-deleted" : "no-remote-manifest",
      result: {
        uploaded: full.uploadedNotes, downloaded: full.downloadedNotes, conflicts: 0,
        manifestId: "v3-g" + full.generation, completedAt: new Date().toISOString(),
      },
    };
  }
  return {
    status: "pushed",
    uploadedContent: result.uploadedContent,
    uploadedAssets: result.uploadedAssets,
    unchanged: result.unchanged,
    manifestId: "v3-g" + result.generation,
  };
}


export const syncDomain = {
  async addS3GcPending(key: string): Promise<void> {
    await runWrite("addS3GcPending", async () => {
      const d = await ensureDb();
      await gcRepository.addS3GcPending(d, key);
    });
  },

  async removeS3GcPending(keys: string[]): Promise<void> {
    await runWrite("removeS3GcPending", async () => {
      const d = await ensureDb();
      await gcRepository.removeS3GcPending(d, keys);
    });
  },

  async listS3GcPending(): Promise<Array<{ key: string; markedAt: string }>> {
    const d = await ensureDb();
    return await gcRepository.listS3GcPending(d);
  },

  async recordS3GcLog(action: string, key: string, reason: string, ok: boolean): Promise<void> {
    await runWrite("recordS3GcLog", async () => {
      const d = await ensureDb();
      await gcRepository.recordS3GcLog(d, action, key, reason, ok);
    });
  },

  getSyncSettings(): SyncSettings {
    return readSyncSettings();
  },

  saveSyncSettings(next: SyncSettings): void {
    writeLocalStorage(SYNC_STORAGE_KEY, JSON.stringify(next));
  },

  async getS3Settings(): Promise<S3Settings | null> {
    try {
      const raw = localStorage.getItem(S3_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<S3Settings>;
      // §17.5/§22.3：secret 不落 localStorage 明文——从 secretStore（WebCrypto 加密 IndexedDB）读取；
      // 旧版本明文 secret 在 saveS3Settings 时已迁移，此处兜底兼容（读到则加密回存并清明文）。
      let secret = parsed.secretAccessKey ?? "";
      const stored = await mobileSecretStore.read("s3.secretAccessKey");
      if (stored !== null) secret = stored;
      else if (secret) {
        await mobileSecretStore.write("s3.secretAccessKey", secret);
        delete parsed.secretAccessKey;
        writeLocalStorage(S3_STORAGE_KEY, JSON.stringify(parsed));
      }
      // D3/D7（261017）：旧数据/手填值在读取时也走同一套规范化（补 https、region 缺省），
      // 保证「设置页显示」「测连通」「真同步」三处看到的是同一个 endpoint/region。
      return {
        ...parsed,
        endpoint: normalizeEndpoint(parsed.endpoint ?? ""),
        region: parsed.region?.trim() || "cn-east-1",
        prefix: parsed.prefix ?? DEFAULT_S3_PREFIX,
        secretAccessKey: secret,
      } as S3Settings;
    } catch {
      return null;
    }
  },

  async saveS3Settings(cfg: S3Settings): Promise<void> {
    // D3/D7（261017）：落库前与桌面同源规范化 + 校验（补 https/去尾斜杠、region 缺省、强制 https）。
    // 移动端只支持虚拟托管公有云（D2 定稿），因此强制 https 不会误伤自建 MinIO。
    const next: S3Settings = {
      ...cfg,
      endpoint: normalizeEndpoint(cfg.endpoint),
      region: cfg.region.trim() || "cn-east-1",
      forcePathStyle: false,
    };
    validateS3Settings(next);
    // P2-8（GPT 审计）：secret 加密存储失败必须让保存整体失败（否则 UI 显示已保存但同步密钥缺失）
    await mobileSecretStore.write("s3.secretAccessKey", next.secretAccessKey);
    const { secretAccessKey: _s, ...rest } = next;
    writeLocalStorage(S3_STORAGE_KEY, JSON.stringify(rest));
  },

  async testS3Connection(): Promise<string> {
    const cfg = await syncDomain.getS3Settings();
    if (!cfg) return "未配置 S3";
    try {
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const client = await createS3Client(cfg);
      const out = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, MaxKeys: 1 }));
      return `OK（对象数 ≥ ${out.KeyCount ?? 0}）`;
    } catch (e) {
      return `FAIL: ${(e as Error).message}`;
    }
  },

  async gcDeepCleanup(): Promise<{ candidateCount: number; deletedCount: number; keys: string[] }> {
    // 快路径：关闭云同步/未配置时连维护队列都不排队、零网络请求；入锁后再判一次，防止等待期间状态变化。
    if (!canTouchNetwork(await mobileCloudState())) return { candidateCount: 0, deletedCount: 0, keys: [] };
    return runMaintenance("gcDeepCleanup", async () => {
      if (!canTouchNetwork(await mobileCloudState())) return { candidateCount: 0, deletedCount: 0, keys: [] };
      const cfg = await syncDomain.getS3Settings();
      if (!cfg) return { candidateCount: 0, deletedCount: 0, keys: [] };
      assertS3Credentials(cfg);
      const syncCfg: SyncConfig = { endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, prefix: cfg.prefix };
      const s3Store = createCapacitorS3Store(syncCfg);
      if (!s3Store.listObjects || !s3Store.deleteMany) return { candidateCount: 0, deletedCount: 0, keys: [] };
      // 从读清单到删对象、写 GC 日志，全段都在维护域内，禁止与 syncNow 交错。
      const latestBytes = await s3Store.getObject(`${syncCfg.prefix}/manifests/latest.json`, { maxBytes: 20 * 1024 * 1024 });
      if (!latestBytes) return { candidateCount: 0, deletedCount: 0, keys: [] }; // 无清单 → 不 GC（安全）
      let manifest;
      try { manifest = parseLakeManifest(latestBytes); } catch { return { candidateCount: 0, deletedCount: 0, keys: [] }; } // 清单损坏 → 不 GC
      // prev 链引用保护（最多 3 层，对齐桌面 MANIFEST_CHAIN_KEEP）
      const prevManifests: Manifest[] = [];
      let prev = manifest.prevCommitId;
      let chain = 0;
      while (prev && chain < 3) {
        const pb = await s3Store.getObject(`${syncCfg.prefix}/manifests/${prev}.json`, { maxBytes: 20 * 1024 * 1024 });
        if (!pb) break;
        try { const pm = parseLakeManifest(pb); prevManifests.push(pm); prev = pm.prevCommitId; } catch { break; }
        chain += 1;
      }
      const d = await ensureDb();
      const keep = buildGcKeepSet({
        manifest,
        extraManifests: prevManifests,
        prefix: syncCfg.prefix,
        historyRefs: await historyRepository.historyAssetRefs(d),
      });
      const pendingByKey = new Map((await syncDomain.listS3GcPending()).map((p) => [p.key, p.markedAt] as const));
      const all = [...(await s3Store.listObjects(`${syncCfg.prefix}/objects/`)), ...(await s3Store.listObjects(`${syncCfg.prefix}/assets/`))];
      const cutoff = Date.now() - 7 * 24 * 3600 * 1000; // 7 天窗口
      const toDelete: string[] = [];
      for (const o of all) {
        if (keep.has(o.key)) continue;
        if (new Date(o.lastModified).getTime() > cutoff) continue; // 创建不足窗口 → 保护
        const marked = pendingByKey.get(o.key);
        if (marked && new Date(marked).getTime() > cutoff) continue; // 本机待回收标记但窗口未过 → 保护
        toDelete.push(o.key);
      }
      const keys = toDelete;
      const deletedCount = keys.length ? await s3Store.deleteMany(keys) : 0;
      for (const key of keys) await gcRepository.recordS3GcLog(d, "delete", key, "deep-clean", true);
      return { candidateCount: all.length, deletedCount, keys };
    });
  },

  async getDiagnostics(): Promise<diagnosticsRepository.MobileDiagnostics> {
    const d = await ensureDb();
    const mobileDb = d;
    return diagnosticsRepository.getDiagnostics(mobileDb, {
      listAssetKeys: listAssetKeysFs,
      getDatabaseSizeBytes: () => mobileDb.databaseSizeBytes(),
    });
  },

  async syncNow(): Promise<MobileSyncResult> {
    // 关闭云同步 = 纯离线本地空间：直接说明原因，**零请求**（与桌面同一判据）。
    if ((await mobileCloudState()) === "offline") {
      return { message: cloudStateHint("offline") ?? "云同步已关闭", notes: null, quickNotes: null };
    }
    try {
      const result = await runMaintenance("syncNow", async () => {
        const cfg = await syncDomain.getS3Settings();
        if (!cfg) return { message: "未配置 S3", notes: null, quickNotes: null };
        try { assertS3Credentials(cfg); } catch (e) { return { message: (e as Error).message, notes: null, quickNotes: null }; }
        const d = await ensureDb();
        const v3 = await runMobileV3Sync(d, { endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, prefix: cfg.prefix });
        try { await reconcileIndex(d); } catch { /* 派生索引失败不影响同步结果 */ }
        const message = v3.warningDetails.length > 0
          ? `v3 同步完成：↑${v3.uploadedNotes} ↓${v3.downloadedNotes}（${v3.warningDetails.length} 项被跳过）`
          : `v3 同步完成：↑${v3.uploadedNotes} ↓${v3.downloadedNotes}`;
        return { message, notes: null, quickNotes: null, ...(v3.warningDetails.length > 0 ? { warnings: v3.warningDetails } : {}) };
      });
      writeSyncStatus({ at: new Date().toISOString(), ok: true, message: result.message });
      return result;
    } catch (error) {
      writeSyncStatus({ at: new Date().toISOString(), ok: false, message: (error as Error)?.message ?? String(error) });
      throw error;
    }
  },

  async listDeletedNotesForSync() { return dbPort.listDeletedNotesForSync!(); },

  readDeletedContent(id: string) { return dbPort.readDeletedContent!(id); },

  async markTombstonesPublished(ids: string[]) { await dbPort.markTombstonesPublished!(ids); },

  async isFolderPurged(id: string): Promise<boolean> { return dbPort.isFolderPurged!(id); },
};
