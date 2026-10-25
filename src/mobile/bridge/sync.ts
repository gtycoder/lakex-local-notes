import { writeLocalStorage } from "../../lib/localStorageSafe";
import { saveAssetBytesFs, loadAssetBytesFs, removeAssetBytesFs, listAssetKeysFs } from "../native/assetFs";
import { syncNow as runSync, downloadNoteAssets, type SyncConfig, type SyncReport } from "../../core/syncEngine.js";
import { buildGcKeepSet } from "../../core/gcDecisions.js";
import { normalizeEndpoint, parseLakeManifest, objectKey, validateS3Settings } from "../../core/syncUtils.js";
import type { Manifest } from "../../core/manifestTypes.js";
import { maintenanceQueue } from "../sync/maintenanceLocks";
import type { QuickNotesSyncResult } from "../../core/quickNotesSyncEngine.js";
import { syncQuickNotesViaEngine } from "../../core/quickNotesSyncEngine.js";
import { createCapacitorS3Store } from "../native/s3Store";
import { canTouchNetwork, cloudStateHint, cloudStateOf, type CloudState } from "../../core/cloudState.js";
import type { S3Settings, SyncSettings } from "../../lib/types";
import { pushQuickNote, type QuickNotePushOutcome } from "../../core/quickNotePush.js";
import { createQuickNotesSyncDbPort } from "../data/quickNotesDbPort.js";
import { mobileSecretStore } from "../native/secretStore.js";
import { writeSyncStatus } from "../sync/syncStatusStore";
import * as gcRepository from "../data/gcRepository.js";
import * as historyRepository from "../data/historyRepository.js";
import * as diagnosticsRepository from "../data/diagnosticsRepository.js";
import { DEFAULT_S3_PREFIX, S3_STORAGE_KEY, SYNC_STORAGE_KEY, readSyncSettings, assets, ensureDb, dbPort, assertS3Credentials, createS3Client, runWrite, runMaintenance } from "./context";
import { reconcileIndex } from "../data/searchIndex.js";
import { isMobileV3Enabled, runMobileV3Sync } from "../v3/sync.js";

export interface MobileSyncResult {
  message: string;
  notes: SyncReport | null;
  quickNotes: QuickNotesSyncResult | { error: string } | null;
  /** 同步收尾对账搜索索引的耗时（ms）；移动端性能专项观测用。 */
  indexMs?: number;
}

/** 云端状态（单一判据，与桌面同源 src/core/cloudState）：没配置 或 关闭云同步 ⇒ 一律不出网。 */
export async function mobileCloudState(): Promise<CloudState> {
  const cfg = await syncDomain.getS3Settings();
  return cloudStateOf(Boolean(cfg), readSyncSettings());
}
/** 下载这些笔记的已声明资产（best-effort）；失败不阻断调用方（恢复/预览红线）。
 * @param onlyMissing true = 只补本地缺失的资源（预览用）；false = 强拉全量（恢复用） */
export async function downloadDeclaredAssetsFor(noteIds: string[], onlyMissing = false): Promise<void> {
  if (noteIds.length === 0) return;
  try {
    // 单一判据：没配置 或 关闭云同步 ⇒ **一个请求都不发**（用户 261006：关闭云同步 = 离线本地空间）
    const state = await mobileCloudState();
    if (!canTouchNetwork(state)) { console.info(`[asset] 跳过补拉（${state}）`); return; }
    const cfg = await syncDomain.getS3Settings();
    if (!cfg) return;
    const syncCfg: SyncConfig = {
      endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket,
      accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, prefix: cfg.prefix,
    };
    const s3Store = createCapacitorS3Store(syncCfg);
    const report: SyncReport = {
      pulled: false, appliedRemote: 0, uploaded: 0, published: false, message: "",
      warnings: [], supersededNotes: [], foldersUploaded: 0, foldersDownloaded: 0,
      trashedDown: 0, trashedUp: 0, uploadedBytes: 0, downloadedBytes: 0,
    };
    for (const noteId of noteIds) {
      let assets = typeof dbPort.listDeclaredAssets === "function" ? await dbPort.listDeclaredAssets(noteId) : [];
      if (onlyMissing && assets.length > 0) {
        const local = new Set((await dbPort.listLocalAssets(noteId)).map((a) => a.filename));
        assets = assets.filter((a) => !local.has(a.filename));
      }
      if (assets.length === 0) continue;
      await downloadNoteAssets(syncCfg, s3Store, dbPort, noteId, assets, report, false);
    }
  } catch (e) {
    console.warn("[asset] 资源下载失败（保留调用方，资源下次同步补拉）", e);
  }
}

/** 单条推送的一次尝试（高优先域与"推送后回核"共用；云状态判据在调用方）。 */
export async function pushSingleQuickNote(id: string): Promise<QuickNotePushOutcome> {
  const cfg = await syncDomain.getS3Settings();
  if (!cfg) throw new Error("未配置 S3");
  if (isMobileV3Enabled()) {
    const d = await ensureDb();
    await runMobileV3Sync(d, cfg);
    return { status: "pushed", uploadedContent: true, uploadedAssets: 0, unchanged: false, manifestId: null };
  }
  if (!cfg) throw new Error("未配置 S3");
  try { assertS3Credentials(cfg); } catch (e) { throw new Error((e as Error).message); }
  const d = await ensureDb();
  const syncCfg: SyncConfig = {
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    prefix: cfg.prefix,
  };
  return await pushQuickNote(syncCfg, createCapacitorS3Store(syncCfg), createQuickNotesSyncDbPort(d, {
    assetBytes: assets,
    saveAssetFile: saveAssetBytesFs,
    loadAssetFile: loadAssetBytesFs,
    removeAssetFile: removeAssetBytesFs,
  }), id);
}

/**
 * 推送后回核（幂等；排**维护域队尾** ⇒ 任何在途/排队的整轮同步跑完之后才轮到它）：
 * 整轮同步若在"读到本地清单快照"之后才被我们插进来写清单，它落地时会把这一条覆盖掉；
 * 回核就是把那一条补回来（`pushQuickNote` 在远端缺该条时会重传，不缺则只读一次清单）。
 * 失败静默：下轮整轮同步仍会自愈（远端缺条目 ⇒ decideUpload 走 upload）。
 */
export function scheduleQuickNoteVerify(id: string): void {
  void maintenanceQueue.run("maintenance", async () => {
    try {
      if ((await mobileCloudState()) === "offline") return;
      await pushSingleQuickNote(id);
    } catch { /* 安全网失败：交给下轮整轮同步自愈 */ }
  });
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
    // 关闭云同步 = 纯离线本地空间：直接说明原因，**零请求**（与桌面 runSync 同一判据）
    if ((await mobileCloudState()) === "offline") {
      return { message: cloudStateHint("offline") ?? "云同步已关闭", notes: null, quickNotes: null };
    }
    try {
      const result = await runMaintenance("syncNow", async () => {
      const cfg = await syncDomain.getS3Settings();
      if (!cfg) return { message: "未配置 S3", notes: null, quickNotes: null };
      // 同步也走同一条"密钥缺失"提示（别让用户以为"同步失败"却看不出该重填密钥）。
      try { assertS3Credentials(cfg); } catch (e) { return { message: (e as Error).message, notes: null, quickNotes: null }; }
      const d = await ensureDb();
      // 转正默认：v3；`syncProtocol=legacy` 回滚旧路径。
      if (isMobileV3Enabled()) {
        const v3 = await runMobileV3Sync(d, { endpoint: cfg.endpoint, region: cfg.region, bucket: cfg.bucket, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, prefix: cfg.prefix });
        try { await reconcileIndex(d); } catch { /* 派生索引失败不影响同步结果 */ }
        const message = `v3 同步完成：↑${v3.uploadedNotes} ↓${v3.downloadedNotes}`;
        writeSyncStatus({ at: new Date().toISOString(), ok: true, message });
        return { message, notes: null, quickNotes: null };
      }
      const syncCfg: SyncConfig = {
        endpoint: cfg.endpoint,
        region: cfg.region,
        bucket: cfg.bucket,
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        prefix: cfg.prefix,
      };
      const s3Store = createCapacitorS3Store(syncCfg);
      const mobileDb = d;
      const report = await runSync(syncCfg, s3Store, dbPort, {
          onPublished: async (next, prev) => {
            // GC 差集标记（对齐桌面 syncEngineController.onPublished）：新 manifest 不再引用的旧正文/资源 → 待回收。用 full key（含 prefix）与 gcDeepCleanup 一致。
            try {
              const newById = new Map(next.notes.map((n) => [n.id, n]));
              for (const p of prev?.notes ?? []) {
                if (p.deleted) continue;
                const nx = newById.get(p.id);
                if (!nx || nx.deleted) continue;
                if (nx.contentHash !== p.contentHash) await gcRepository.addS3GcPending(mobileDb, `${syncCfg.prefix}/${objectKey(p.id, p.contentHash)}`);
                const nextAssets = new Set((nx.assets ?? []).map((a) => a.filename));
                for (const asset of p.assets ?? []) {
                  if (nextAssets.has(asset.filename)) continue;
                  await gcRepository.addS3GcPending(mobileDb, `${syncCfg.prefix}/assets/${p.id}/${asset.filename}`);
                }
              }
              const referencedNow = new Set<string>();
              for (const note of next.notes) {
                if (note.deleted) continue;
                referencedNow.add(`${syncCfg.prefix}/${objectKey(note.id, note.contentHash)}`);
                for (const asset of note.assets ?? []) referencedNow.add(`${syncCfg.prefix}/assets/${note.id}/${asset.filename}`);
              }
              await gcRepository.removeS3GcPending(mobileDb, [...referencedNow]);
            } catch { /* 不影响同步 */ }
          },
        });
        // 小记独立子空间同步（quick-notes/ 前缀，同一 S3 配置；墓碑/恢复/冲突语义与桌面一致）。
        // 失败不拖垮笔记同步（对齐桌面 main.ts：quickNotes 错误单独上报）。
        let quickNotes: QuickNotesSyncResult | { error: string };
        let quickMsg = "；小记已同步";
        try {
          quickNotes = await syncQuickNotesViaEngine(syncCfg, s3Store, createQuickNotesSyncDbPort(d, {
            assetBytes: assets,
            saveAssetFile: saveAssetBytesFs,
            loadAssetFile: loadAssetBytesFs,
            removeAssetFile: removeAssetBytesFs,
          }));
          if (quickNotes.uploaded + quickNotes.downloaded > 0) {
            quickMsg = `；小记 ↓${quickNotes.downloaded} ↑${quickNotes.uploaded}`;
          }
        } catch (reason) {
          quickNotes = { error: (reason as Error).message };
          quickMsg = `；小记同步失败：${quickNotes.error}`;
        }
        // 清理可能部分成功；失败不拖垮同步，下一次同步继续按策略清理。
        try {
          const mobileDb = d;
          await historyRepository.cleanupHistory(mobileDb, await historyRepository.getHistorySettings(mobileDb));
        } catch {
          // 清理失败不拖垮同步；下一次同步会继续按策略清理。
        }
      // 同步可能增删改文档：对账搜索索引（本地派生数据，随同步刷新）。
      let indexMs = 0;
      try {
        const indexStart = Date.now();
        await reconcileIndex(d);
        indexMs = Date.now() - indexStart;
        console.log(`[sync] reconcileIndex ms=${indexMs}`);
      } catch { /* 索引对账失败不影响同步结果 */ }
      return { message: report.message + quickMsg, notes: report, quickNotes, indexMs };
      });
      // 可观测性（用户 261013）：**每次尝试只写一处**，成功与否按"**真的跑了引擎**"判（notes 非 null）——
      // 「未配置 S3」「密钥缺失」是正常返回（不抛错）但**没跑成**，必须记成失败，否则状态行会显示"同步成功：未配置 S3"（探针实测踩到）。
      writeSyncStatus({ at: new Date().toISOString(), ok: result.notes !== null, message: result.message });
      return result;
    } catch (error) {
      // 引擎抛错（网络/协议）：记失败原因，错误照旧抛给调用方（它决定要不要 toast）
      writeSyncStatus({ at: new Date().toISOString(), ok: false, message: (error as Error)?.message ?? String(error) });
      throw error;
    }
  },

  async listDeletedNotesForSync() { return dbPort.listDeletedNotesForSync!(); },

  readDeletedContent(id: string) { return dbPort.readDeletedContent!(id); },

  async markTombstonesPublished(ids: string[]) { await dbPort.markTombstonesPublished!(ids); },

  async isFolderPurged(id: string): Promise<boolean> { return dbPort.isFolderPurged!(id); },
};
