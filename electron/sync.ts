import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandInput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import type { Store } from "./store.js";
import { createSilentLoggerScopes, type LoggerScopes } from "../src/core/logger.js";
import { ASSET_TRANSFER_CONCURRENCY, runPool } from "./asyncPool.js";
import { mergeLockState } from "../src/core/syncDecision.js";
import { reconcileLakeNote } from "../src/core/lakeReconcile.js";
import { decideUpload } from "../src/core/decideUpload.js";
import type { Manifest, ManifestFolder, ManifestNote } from "../src/core/manifestTypes.js";
import {
  syncSnapshot, parseLakeManifest, isGzip, objectKey, collectManifestRefs,
  normalizeEndpoint, validateS3Settings, errorMessage, isNoSuchKey,
  mimeTypeFor, assertSafeKey, chunkArray, validateManifest,
  MANIFEST_VERSION, MAX_MANIFEST_BYTES, MAX_MANIFEST_NOTES, MAX_MANIFEST_FOLDERS,
  type S3Settings,
  sha256Hex as coreSha256Hex,
} from "../src/core/syncUtils.js";
import { MAX_IMAGE_BYTES } from "./storeLimits.js";
import { isSafePathSegment as isSafeSegment } from "../src/core/storeUtils.js";
import { decidePurge, decideLocalTombstone, decideTrashCross, decideMetaApply,
  decideTrashYield, decideTombstoneYield, buildUploadEntry, buildTombstoneEntry, computeBookkeeping,
  TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";

// ===== 类型 =====
// Manifest 系列类型已外移至 src/core/manifestTypes.ts（lake-core，V5 Phase 1）。

export interface QuickNotesSyncStatus {
  uploaded: number; downloaded: number; conflicts: number;
  completedAt: string;
  error?: string;
}

export interface SyncResult {
  uploaded: number; downloaded: number; conflicts: number;
  manifestId: string; completedAt: string;
  /** 小记是独立同步空间，失败不会否定 Lake 文档本身的同步结果。 */
  quickNotes?: QuickNotesSyncStatus;
  /** 本地修改被远端覆盖、已存入历史的文档（用于 UI 提醒） */
  supersededNotes: Array<{ id: string; title: string }>;
  /** V5 §5.5：远端对象缺失（B 方案——跳过受影响条目、不覆盖本地、其余继续；manifest 损坏仍中止） */
  warnings?: Array<{ kind: "remote_incomplete" | "asset_missing"; noteId?: string }>;
}

export type SyncWarning = NonNullable<SyncResult["warnings"]>[number];

/** V5 §5.5：资源缺失哨兵（runPool 回调内不能 continue 外层循环，用异常传递到外层捕获） */
class AssetMissingError extends Error {
  constructor(public filename: string) { super(`asset missing: ${filename}`); }
}

/** 同步进度事件（主进程 → 渲染进程） */
export interface SyncProgress {
  phase: "connect" | "download" | "upload" | "manifest" | "quick-notes" | "done";
  /** 主循环进度：笔记条目 */
  current?: number;
  total?: number;
  /** 资源（图片/附件）子进度 */
  assetCurrent?: number;
  assetTotal?: number;
  message: string;
  /** done 阶段附带：本地改动被远端覆盖、已存入历史的文档。 */
  supersededNotes?: Array<{ id: string; title: string }>;
  /** 同步失败时附带错误信息。 */
  error?: string;
}

/** 单次 S3 请求超时（连接/首字节/整体）。避免网络黑洞让同步无限挂起、
 *  进而把 before-quit 的“等同步完成再退出”变成无法退出。 */
const S3_REQUEST_TIMEOUT_MS = 30_000;
/** W-6：Get/Put 大对象（25MiB 图片/正文）传输超时放宽到 120s——
 *  <1MB/s 弱网下 30s 会误杀传输并触发无效重试（元数据小命令仍走 30s）。 */
const S3_TRANSFER_TIMEOUT_MS = 120_000;
/** 保留的 manifest commit 链长度（latest + 本 commit + 8 层 prev = 10 份）。
 * prune / runGcReconcile / runDeepCleanup 三者必须一致，否则深度清理会在 7 天后
 * 把「多留的容错份」删掉（用户验收 #3：留 10 份）。 */
const MANIFEST_CHAIN_KEEP = 8;
/**
 * 清单加载护栏（W-13）：manifest 是同步的第一个解析对象，且在零变更早退之前。
 * 异常/恶意清单（投毒、版本 bug、gzip 炸弹）不得打爆主进程：
 * - 字节上限：parseLakeManifest 在 JSON.parse 之前检查解压后体积，
 *   框死 gzip 炸弹与异常膨胀清单的内存占用；
 * - 条目数上限：validateManifest 内拒绝畸形数组，避免后续 O(n) 校验耗资源。
 * 上限取值依据：1 万条笔记清单约 3-5MB 未压缩；20 万条 ≈ 60MB，宽裕一个数量级。
 */
/** V5 §5.6：远端正文单对象上限（投毒防护；与 IPC 32MiB 不同，S3 侧放宽） */
const MAX_REMOTE_NOTE_BYTES = 64 * 1024 * 1024;


// ===== ObjectStore：S3 兼容客户端（七牛云等） =====
export class ObjectStore {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private log: LoggerScopes;

  constructor(settings: S3Settings, logScopes: LoggerScopes = createSilentLoggerScopes()) {
    this.log = logScopes;
    this.bucket = settings.bucket.trim();
    this.prefix = settings.prefix.trim().replace(/^\/+|\/+$/g, "");
    this.client = new S3Client({
      region: settings.region.trim() || "cn-east-1",
      // 参照思源 NormalizeEndpoint：规范化 endpoint（协议/斜杠/尾部）
      endpoint: normalizeEndpoint(settings.endpoint),
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId.trim(),
        secretAccessKey: settings.secretAccessKey.trim(),
      },
      maxAttempts: 3,
      requestHandler: undefined,
    });
  }

  private key(suffix: string): string {
    return this.prefix ? `${this.prefix}/${suffix}` : suffix;
  }

  async test(): Promise<void> {
    const t0 = Date.now();
    try {
      // 七牛 Kodo S3 兼容层不支持 HeadBucket（对存在的桶也会返回 404/UnknownError），
      // 改用 ListObjectsV2 探测连接与桶存在性。
      await this.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
      this.log.s3.info(`[perf] test ${Date.now() - t0}ms ok`);
    } catch (error) {
      this.log.s3.warn(`[perf] test FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 连接失败: ${errorMessage(error)}`);
    }
  }

  /** V5 §5.6：getOptional 支持按用途单对象上限（maxBytes 对解压后字节生效，防投毒 OOM） */
  async getOptional(key: string, opts?: { maxBytes?: number }): Promise<Buffer | null> {
    assertSafeKey(key);
    const t0 = Date.now();
    try {
      const output = await this.send<GetObjectCommandOutput>(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      const bytes = output.Body ? Buffer.from(await output.Body.transformToByteArray()) : Buffer.alloc(0);
      // manifest 等 gzip 对象透明解压（按魔数识别；ContentEncoding 自动解压与原始字节两种响应均兼容）
      const out = isGzip(bytes) ? zlib.gunzipSync(bytes) : bytes;
      if (opts?.maxBytes !== undefined && out.length > opts.maxBytes) {
        throw new Error(`S3 对象过大 (${key}): ${out.length}B > ${opts.maxBytes}B`);
      }
      this.log.s3.info(`[perf] get ${key} ${Date.now() - t0}ms (${bytes.length}B${out !== bytes ? ` -> ${out.length}B gzip` : ""})`);
      return out;
    } catch (error) {
      if (isNoSuchKey(error)) { this.log.s3.info(`[perf] get ${key} ${Date.now() - t0}ms MISS`); return null; }
      this.log.s3.warn(`[perf] get ${key} FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 读取失败 (${key}): ${errorMessage(error)}`);
    }
  }

  async put(key: string, bytes: Buffer, contentType: string, opts?: { cacheControl?: "no-cache" | "no-store"; gzip?: boolean }): Promise<void> {
    assertSafeKey(key);
    const t0 = Date.now();
    let body = bytes;
    const command: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: this.key(key),
      Body: body,
      ContentType: contentType,
      CacheControl: opts?.cacheControl ?? "no-cache",
    };
    if (opts?.gzip) {
      body = zlib.gzipSync(bytes, { level: 9 });
      command.Body = body;
      command.ContentEncoding = "gzip";
    }
    try {
      await this.send(new PutObjectCommand(command));
      this.log.s3.info(`[perf] put ${key} ${Date.now() - t0}ms (${body.length}B${opts?.gzip ? ` gzip of ${bytes.length}B` : ""})`);
    } catch (error) {
      this.log.s3.warn(`[perf] put ${key} FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 上传失败 (${key}): ${errorMessage(error)}`);
    }
  }

  /** ListObjectsV2 分页列出前缀下键（返回相对键 + LastModified）。 */
  async list(prefix: string): Promise<Array<{ key: string; lastModified: string }>> {
    const t0 = Date.now();
    const fullPrefix = this.key(prefix);
    const out: Array<{ key: string; lastModified: string }> = [];
    let continuationToken: string | undefined;
    let pages = 0;
    do {
      pages += 1;
      const output = await this.send<ListObjectsV2CommandOutput>(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
      }));
      for (const obj of output.Contents ?? []) {
        if (typeof obj.Key !== "string") continue;
        out.push({ key: this.unkey(obj.Key), lastModified: obj.LastModified?.toISOString() ?? "" });
      }
      continuationToken = output.NextContinuationToken;
    } while (continuationToken);
    this.log.s3.info(`[perf] list ${prefix} ${Date.now() - t0}ms (${out.length} keys, ${pages} pages)`);
    return out;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const t0 = Date.now();
    try {
      await this.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      this.log.s3.info(`[perf] delete ${key} ${Date.now() - t0}ms`);
    } catch (error) {
      if (isNoSuchKey(error)) return;
      this.log.s3.warn(`[perf] delete ${key} FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
      throw new Error(`S3 删除失败 (${key}): ${errorMessage(error)}`);
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const t0 = Date.now();
    for (const chunk of chunkArray(keys, 1000)) {
      for (const k of chunk) assertSafeKey(k);
      try {
        await this.send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((k) => ({ Key: this.key(k) })), Quiet: true },
        }));
      } catch (error) {
        this.log.s3.warn(`[perf] deleteMany ${chunk.length} keys FAIL ${Date.now() - t0}ms: ${errorMessage(error)}`);
        throw new Error(`S3 批量删除失败 (${chunk.length} 键): ${errorMessage(error)}`);
      }
    }
    this.log.s3.info(`[perf] deleteMany ${keys.length} keys ${Date.now() - t0}ms`);
  }

  /** 前缀删除：列出 + 分批删除（用于 purge）。404 与空列表均幂等。 */
  async deletePrefix(prefix: string): Promise<number> {
    const t0 = Date.now();
    const items = await this.list(prefix);
    const keys = items.map((i) => i.key);
    await this.deleteMany(keys);
    this.log.s3.info(`[perf] deletePrefix ${prefix} ${Date.now() - t0}ms (${keys.length} keys)`);
    return keys.length;
  }

  /** 统一带超时发送命令：超时通过 AbortSignal 中断底层请求（NodeHttpHandler 支持）。
   *  Get/Put 走大对象超时（W-6），其余元数据命令走短超时。 */
  private async send<T>(command: GetObjectCommand | PutObjectCommand | ListObjectsV2Command | DeleteObjectCommand | DeleteObjectsCommand): Promise<T> {
    const isTransfer = command instanceof GetObjectCommand || command instanceof PutObjectCommand;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), isTransfer ? S3_TRANSFER_TIMEOUT_MS : S3_REQUEST_TIMEOUT_MS);
    try {
      // AWS SDK client.send 不接受命令联合类型（已知 TS 痛点）：调用点类型已约束，这里集中一处断言。
      return await this.client.send(command as never, { abortSignal: controller.signal }) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private unkey(full: string): string {
    return this.prefix && full.startsWith(`${this.prefix}/`) ? full.slice(this.prefix.length + 1) : full;
  }
}

// ===== 对外 API =====

export async function testConnection(store: Store): Promise<string> {
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, store.logScopes);
  await remote.test();
  return "连接成功，Bucket 可访问";
}

export async function syncNow(
  store: Store,
  onProgress?: (p: SyncProgress) => void,
  createRemote: (settings: S3Settings, logScopes: LoggerScopes) => ObjectStore = (s, l) => new ObjectStore(s, l),
): Promise<SyncResult> {
  const syncStart = Date.now();
  store.logScopes.sync.info("[perf] syncNow start");
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = createRemote(settings, store.logScopes);
  const report = (p: SyncProgress) => { try { onProgress?.(p); } catch { /* 渲染层已关闭 */ } };
  report({ phase: "connect", message: "正在连接 S3..." });
  const connectStart = Date.now();
  await remote.test();
  store.logScopes.sync.info(`[perf] connect ${Date.now() - connectStart}ms`);

  // 1. 读取远程清单
  const manifestBytes = await remote.getOptional("manifests/latest.json", { maxBytes: MAX_MANIFEST_BYTES });
  const remoteManifest: Manifest | null = manifestBytes ? parseLakeManifest(manifestBytes) : null;

  // 零变更早退（性能）：远端 latest 的 commitId 与本设备上次成功读/写的相同，
  // 且本地无待上传变更（notes 全 synced + 无新增 purge 墓碑）→ 整轮跳过，
  // 不做 manifest 解析/逐条记账/重写上传（10k 条时从秒级降到 ~100ms，纯性能、语义等价）。
  if (remoteManifest
    && remoteManifest.commitId === store.getLastSeenCommitId()
    && !store.hasLocalPendingNotes()
    && store.tombstoneSignature() === store.getLastTombstoneSig()) {
    store.logScopes.sync.info(`[perf] zero-change sync skipped (commit=${remoteManifest.commitId.slice(0, 8)}, notes=${remoteManifest.notes.length})`);
    return {
      uploaded: 0, downloaded: 0, conflicts: 0,
      manifestId: remoteManifest.commitId,
      completedAt: new Date().toISOString(),
      supersededNotes: [],
    };
  }

  // 2. 下载阶段：远端有而本地缺失/不同的笔记
  let downloaded = 0;
  // conflicts 死账（V5 Phase 1 §6）：Lake 下载阶段从不自增（冲突语义由 supersededNotes 表达），
  // 改为 supersededNotes.length 别名；pushSuperseded 同时去重（trash-cross 与下载分支可能重复记同一笔记）。
  const supersededNotes: Array<{ id: string; title: string }> = [];
  const supersededIds = new Set<string>();
  const pushSuperseded = (id: string, title: string) => {
    if (supersededIds.has(id)) return;
    supersededIds.add(id);
    supersededNotes.push({ id, title });
  };
  const warnings: SyncWarning[] = [];
  if (remoteManifest) {
    // 本地已删除笔记的墓碑（下载阶段生效）：id -> deletedAt。
    // 删除 vs 远端恢复按时间 LWW（last-writer-wins）：远端 active 且 updatedAt 晚于
    // 本地墓碑删除时间 → 远端恢复较新，撤销本地墓碑并跟随恢复；否则本地删除优先。
    const tombstoned = new Map(store.listDeletedNotesForSync().map((d) => [d.id, d.deletedAt] as const));
    // 预建本地索引，避免循环内 N+1 查询
    const localNotesAll = store.listNotesForSync();
    const localById = new Map(localNotesAll.map((n) => [n.id, n]));
    // 批量读取同步基线（baseHash / lastSyncedMetaAt / lastUploadedHash / syncState），
    // 替代逐条 lastSyncedMetaAt 查询，并支撑 fast-path 记账去重（10k 条时省 ~4 万次写）。
    const baseInfo = store.allSyncBaseInfo();
    // 先导入目录树，再导入笔记，保证文档的父 notebook/group 已存在。
    const validParents = new Set<string>([store.defaultNotebookId(), TRASH_NOTEBOOK_ID]);
    for (const folder of remoteManifest.folders) {
      if (!isSafeSegment(folder.id)) throw new Error(`清单包含无效的目录 ID: ${folder.id}`);
      if (folder.parentId !== null && !isSafeSegment(folder.parentId)) throw new Error(`清单包含无效的目录 parentId: ${folder.parentId}`);
      store.importRemoteFolder(folder);
      validParents.add(folder.id);
    }
    const downloadStart = Date.now();
    const remoteTotal = remoteManifest.notes.length;
    let remoteIndex = 0;
    for (const rn of remoteManifest.notes) {
      const noteStart = Date.now();
      remoteIndex += 1;
      report({ phase: "download", current: remoteIndex, total: remoteTotal, message: rn.deleted ? "处理云端删除记录" : `检查远端笔记「${rn.title}」` });
      // 审计 #3：manifest 的 note.id / asset.filename 必须先做单路径段校验，
      // 拒绝 ../、绝对路径、反斜杠等（写盘前 fail fast，避免任何写半成品）
      if (!isSafeSegment(rn.id)) throw new Error(`清单包含无效的笔记 ID: ${rn.id}`);
      for (const asset of rn.assets || []) {
        if (!isSafeSegment(asset.filename)) throw new Error(`清单包含无效的资源文件名: ${rn.id}/${asset.filename}`);
      }
      // 目录树同步前的旧 manifest 可能没有 folders，父目录缺失时归到默认个人笔记本，避免文档"消失"。
      const effectiveParent = rn.parentId !== null && validParents.has(rn.parentId) ? rn.parentId : store.defaultNotebookId();
      // 云端 deleted = purge 墓碑（回收站笔记本重构后软删 = 移动，不再有软删墓碑，deleted:true 即 purge）。
      // purge 不广播强制删除（用户决策）：本地有副本 → 保留并移入本地回收站标 purged（可恢复、不上传）；
      // 本地无 → 留存墓碑（学到的删除，防离线设备把残留当新文档上传复活，审计 #2）。
      if (rn.deleted) {
        // Step B：判定下沉 core（decidePurge），执行留在本地
        const purgeAction = decidePurge(localById.get(rn.id) ?? null, store.isRestorePending(rn.id));
        if (purgeAction === "skip-restore-pending") {
          store.logScopes.sync.info(`[perf] download ${rn.id} purge-skip (restore pending) ${Date.now() - noteStart}ms`);
          continue;
        }
        if (purgeAction === "apply-purge") {
          store.applyRemotePurge(rn.id);
          store.logScopes.sync.info(`[perf] download ${rn.id} remote-purged → local kept in trash (purged) ${Date.now() - noteStart}ms`);
        } else {
          store.rememberDeleted(rn, rn.deletedAt ?? new Date().toISOString());
          store.logScopes.sync.info(`[perf] download ${rn.id} remote-purged → tombstone learned ${Date.now() - noteStart}ms`);
        }
        continue;
      }
      // 本地已删除而云端未标记：删除 vs 远端恢复按时间 LWW（见上）。
      const tombAt = tombstoned.get(rn.id);
      const tombDecision = decideLocalTombstone(rn.updatedAt, tombAt);
      if (tombDecision === "revoke") {
        // 远端恢复较新：撤销本地墓碑并跟随恢复（随后走正常下载/对账分支，按远端对齐 markSynced）。
        store.revokeLocalDeletion(rn.id);
        store.logScopes.sync.info(`[perf] download ${rn.id} remote-restored → local tombstone revoked ${Date.now() - noteStart}ms`);
        // 刷新本地索引：恢复后该笔记在本设备变为 active（软删场景行已保留，仅清 deleted_at）。
        const revived = store.listNotesForSync().find((n) => n.id === rn.id) ?? null;
        if (revived) {
          localById.set(rn.id, revived);
        }
      } else if (tombDecision === "keep-local-delete") {
        // 本地删除较新：本地删除优先，跳过下载（上传阶段会标记 deleted）。
        continue;
      }
      // TRASH-NOTEBOOK：回收站笔记本 vs 本地普通位置的交叉冲突
      // (a) 远端已移入回收站（删除传播）而本地仍 active：删除压编辑（墓碑权威）——
      //     本地编辑先强制留档再跟随移动；唯一例外是本地显式恢复（restore_pending_at）。
      // (b) 远端已恢复（active）而本地在回收站：恢复 vs 删除按 updatedAt LWW。
      const local0 = localById.get(rn.id) ?? null;
      // Step B：TRASH 交叉判定下沉 core（decideTrashCross），执行留在本地
      const cross = decideTrashCross(local0, rn, store.isRestorePending(rn.id));
      if (cross === "move-to-trash") {
        // 留档语义（与下载分支 reconcile 的 localIsOwnEdit 同构，协议 §4.2）：
        // 仅当"本机编辑成果"被删除覆盖才留档 + 报 superseded——本地相对基线有改动，
        // 或本机上传过当前版本（本机是作者）。B 从未编辑/从未上传（纯跟随删除传播）
        // → 只移入回收站，不留档不报（2026-08-22 修复：A 新建同步 → 删除 → B 无编辑
        //   跟随进回收站却误写快照）。
        const mCachedBase = local0 && local0.syncState === "synced" ? store.baseHash(local0.id) : null;
        const mLocalHash = local0 ? (mCachedBase ?? store.contentHash(local0.id)) : null;
        const mBase = store.baseHash(rn.id);
        const mLocalChanged = mLocalHash !== null && mLocalHash !== mBase;
        const mOwnEdit = mLocalChanged || (mLocalHash !== null && mLocalHash === store.lastUploadedHash(rn.id));
        if (mOwnEdit) {
          try { store.createHistorySnapshot(rn.id, undefined, false); } catch { /* 留档失败不阻断 */ }
          pushSuperseded(rn.id, rn.title);
        }
        store.applyRemoteMoveToTrash(rn.id, rn.trashedAt ?? rn.updatedAt, rn.deletedFromParentId ?? null);
        const moved = store.listNotesForSync().find((n) => n.id === rn.id) ?? null;
        if (moved) localById.set(rn.id, moved);
        store.logScopes.sync.info(`[perf] download ${rn.id} remote-trashed → local moved to trash ${mOwnEdit ? "(edit archived)" : "(follow)"} ${Date.now() - noteStart}ms`);
      } else if (cross === "restore") {
        store.applyRemoteRestore(rn.id, effectiveParent, rn.updatedAt);
        const revived = store.listNotesForSync().find((n) => n.id === rn.id) ?? null;
        if (revived) localById.set(rn.id, revived);
        store.logScopes.sync.info(`[perf] download ${rn.id} remote-restored → local trash revoked ${Date.now() - noteStart}ms`);
      } else if (cross === "keep-trash") {
        store.logScopes.sync.info(`[perf] download ${rn.id} local-trash newer → keep trash ${Date.now() - noteStart}ms`);
        continue;
      } else if (cross === "skip-restore-pending") {
        store.logScopes.sync.info(`[perf] download ${rn.id} trash-skip (restore pending) ${Date.now() - noteStart}ms`);
        continue;
      }
      const local = localById.get(rn.id) ?? null;
      // 增量扫描优化：synced 笔记信任"本地自上次同步后无写入"，直接用基线 hash 比对，
      // 跳过 .lake 文件读取；local/异常状态仍读文件核对（out-of-band 外部改文件不在本期覆盖）。
      const cachedBase = local && local.syncState === "synced" ? store.baseHash(local.id) : null;
      const localHash = local ? (cachedBase ?? store.contentHash(local.id)) : null;
      if (localHash === rn.contentHash) {
        // 正文相同：锁状态作为独立元数据按 LWW 合并（锁变更不改正文哈希，
        // 不能因哈希相等就跳过，否则远端锁状态永远下不来）
        let metaApplied = false;
        let lockApplied = false;
        if (local) {
          const localLocked = !!local.isLocked;
          const remoteLocked = !!rn.isLocked;
          if (localLocked !== remoteLocked) {
            const merged = mergeLockState(localLocked, local.lockedAt ?? null, remoteLocked, rn.lockedAt ?? null);
            store.applyRemoteLock(rn.id, merged.locked, merged.at);
            lockApplied = true;
          }
          // 标题/父目录/排序/图标也是元数据，正文未变时也要对账（否则文件夹调整不会同步）。
          // 统一冲突语义（先同步者胜，与正文 baseHash、小记 baseHash 同构）：
          // 以"本设备上次成功同步时该笔记的 updated_at"（lastSyncedMetaAt）为已确认版本——
          // - 远端 updatedAt 新于已确认版本 → 远端是未确认的新变更（其他设备先提交）→ 应用远端
          //   （A 先改先同步、B 后同步时，A 的图标胜出；本地 pending 的旧值不再覆盖云端新值）；
          // - 否则远端是本设备已确认版本 → 保留本地续编/改名（不被远端旧值回滚），上传阶段回写。
          const base = baseInfo.get(rn.id);
          const lastMeta = base?.lastSyncedMetaAt ?? null;
          if (decideMetaApply(rn.updatedAt, lastMeta)) {
            store.applyRemoteNoteMeta({ ...rn, parentId: effectiveParent });
            metaApplied = true;
          }
          // 记账去重：本地已 synced 且 base/meta 与远端一致、本次未应用任何远端变更 →
          // 跳过 setBaseHash/markSynced（10k 条零变更时省约 4 万次 DB 写；语义等价）。
          const alreadySynced = local.syncState === "synced" && base?.baseHash === rn.contentHash && base.lastSyncedMetaAt === local.updatedAt;
          if (!metaApplied && !lockApplied && alreadySynced) {
            store.logScopes.sync.info(`[perf] download ${rn.id} unchanged (skip writes) ${Date.now() - noteStart}ms`);
            continue;
          }
        }
        store.setBaseHash(rn.id, rn.contentHash);
        store.markSyncedIfUnchanged(rn.id, syncSnapshot(local!, localHash, rn, metaApplied, effectiveParent));
        store.logScopes.sync.info(`[perf] download ${rn.id} unchanged (meta LWW) ${Date.now() - noteStart}ms`);
        continue;
      }
      // 下载 .lake
      const lakeBytes = await remote.getOptional(objectKey(rn.id, rn.contentHash), { maxBytes: MAX_REMOTE_NOTE_BYTES });
      if (!lakeBytes) {
        // V5 §5.5 B 方案：正文对象缺失 → 跳过该条目 + warning，不覆盖本地，其余同步继续
        //（manifest 本身损坏/不可解析仍整轮中止——那是协议级问题，跳过无意义）
        warnings.push({ kind: "remote_incomplete", noteId: rn.id });
        store.logScopes.sync.warn(`[download] ${rn.id} 远端正文对象缺失，跳过（本地不覆盖）`);
        continue;
      }
      // 下载资源文件（manifest 里列出）；审计 #4：缺失对象必须中止导入，
      // 下载后校验 size 与 sha256（远端损坏/被替换不静默接受）
      const assetList = rn.assets || [];
      let assetDone = 0;
      let assets: { filename: string; bytes: Buffer }[];
      try {
        assets = await runPool(assetList, ASSET_TRANSFER_CONCURRENCY, async (asset) => {
        report({ phase: "download", current: remoteIndex, total: remoteTotal, assetCurrent: ++assetDone, assetTotal: assetList.length, message: rn.deleted ? "处理云端删除记录" : `检查远端笔记「${rn.title}」` });
        const bytes = await remote.getOptional(`assets/${rn.id}/${asset.filename}`, { maxBytes: MAX_IMAGE_BYTES });
        if (!bytes) throw new AssetMissingError(asset.filename);
        if (bytes.length !== asset.size) {
          throw new Error(`资源大小不符: ${rn.id}/${asset.filename}（声明 ${asset.size}，实际 ${bytes.length}）`);
        }
        if (sha256Hex(bytes) !== asset.hash) {
          throw new Error(`资源哈希不符: ${rn.id}/${asset.filename}（已损坏或被替换）`);
        }
        return { filename: asset.filename, bytes };
        });
      } catch (error) {
        if (error instanceof AssetMissingError) {
          // V5 §5.5 B 方案：资源对象缺失 → 跳过该条目 + warning（不导入、不覆盖本地）
          warnings.push({ kind: "asset_missing", noteId: rn.id });
          store.logScopes.sync.warn(`[download] ${rn.id} 远端资源缺失: ${error.filename}，跳过本条目`);
          continue;
        }
        throw error;
      }
      // 决策收敛到纯函数 reconcileLakeNote（lake-core，V5 Phase 1）。
      // P0-1（既定方案）：以 last_uploaded_hash 判定"远端是否本机最后一次上传的版本"。
      // - 远端 == 本机最后上传（本机传的）→ 本地为准（恢复版/新编辑），上传覆盖，不产生冲突副本；
      // - 远端 != 本机最后上传（其他设备改的）→ 接受远端最新，本地当前内容已在历史（恢复留档/编辑前）
      //   可找回，不产生冲突副本（历史已兜底）。
      // 注意：last_uploaded_hash 每次本机上传成功都会更新，因此能准确反映"远端是不是我传的"。
      // 前提：正文相同（localHash===remoteHash）在上层已走元数据 LWW 分支 continue，不会到达此处。
      const action = reconcileLakeNote({
        baseHash: store.baseHash(rn.id),
        localHash,
        remoteHash: rn.contentHash,
        lastUploadedHash: local !== null ? store.lastUploadedHash(rn.id) : null,
        // 时间维度（先同步者胜，与元数据 LWW 同构）：远端 updatedAt vs 本设备已确认版本
        // lastSyncedMetaAt——其他设备回滚/恢复历史会重新上传同 hash 但 updatedAt 更新的版本，
        // 仅凭 hash 会误判"本机传的"（2026-08-22 二修）。
        remoteUpdatedAt: rn.updatedAt,
        lastSyncedMetaAt: baseInfo.get(rn.id)?.lastSyncedMetaAt ?? null,
        localInTrash: local !== null && local.parentId === TRASH_NOTEBOOK_ID,
      });
      if (action.kind === "local-wins") {
        // 本地为准，上传覆盖（不产生冲突副本）：
        // - uploaded-by-us：远端是本机传的 + 本地有变化（恢复/新编辑）；
        // - continued-local：远端 == 本设备已确认基线 + 本地在其基础上续编
        //   （B 已同步过 A 的版本，B 的续编不再被远端旧值回滚）。
        // 排除回收站条目：A 删除、B 离线编辑时（删除压编辑），B 的编辑不得溜进回收站内容
        // （B 可能把 A 的版本原样回推过导致 lastUploadedHash==远端，但回收站内容应以 A 删除的那版为准；
        //   B 的编辑已由 trash-cross 分支强制留档进历史）。
        store.setBaseHash(rn.id, localHash!);
        store.markSyncedIfUnchanged(rn.id, syncSnapshot(local!, localHash!, rn, false, effectiveParent));
        continue;
      }
      // remote-wins：接受远端最新；本地有内容时立即留快照（默认 24h 同 hash 去重：刚被自动快照过的
      // 内容不重复写；表里没有则必写，确保不丢，即使未到 15 分钟周期）并记录 supersededNotes 供 UI 提醒。
      if (action.superseded) {
        try { store.createHistorySnapshot(rn.id, undefined, false); } catch { /* 留档失败不阻断同步 */ }
        pushSuperseded(rn.id, rn.title);
      }
      // 正文下载后锁按 LWW 合并：本地刚改的锁不被远端旧状态覆盖
      const merged = local
        ? mergeLockState(!!local.isLocked, local.lockedAt ?? null, !!rn.isLocked, rn.lockedAt ?? null)
        : { locked: !!rn.isLocked, at: rn.lockedAt ?? null };
      store.importRemoteNote(
        { id: rn.id, title: rn.title, parentId: effectiveParent, sortOrder: rn.sortOrder, updatedAt: rn.updatedAt, isConflict: action.isConflictFromRemote ? rn.isConflict : false,
          isLocked: merged.locked, lockedAt: merged.at, icon: rn.icon ?? null,
          // 2026-08-22 修复：remoteImportRepository 的 ON CONFLICT UPDATE 会无条件覆盖
          // trashed_at/deleted_from_parent_id 为 excluded（不传=null）——B 端 move-to-trash 刚写入的
          // 删除前父目录被抹掉，导致恢复时回退默认笔记本（A 编辑后删除 + B 编辑被删的场景）。
          trashedAt: rn.trashedAt ?? null,
          deletedFromParentId: rn.deletedFromParentId ?? null },
        lakeBytes, assets
      );
      store.setBaseHash(rn.id, rn.contentHash);
      downloaded += 1;
      store.logScopes.sync.info(`[perf] download ${rn.id} ${action.superseded ? "superseded-local→remote" : "new-content"} ${Date.now() - noteStart}ms (lake=${lakeBytes.length}B, assets=${assets.length})`);
    }
    store.logScopes.sync.info(`[perf] download phase ${Date.now() - downloadStart}ms (downloaded=${downloaded}, conflicts=${supersededNotes.length})`);
  }

  // 3. 上传阶段：本地有而远端缺失/不同的笔记（含资源，跳过孤儿）
  const localNotes = store.listNotesForSync();
  const remoteHashes = new Map<string, string>(
    (remoteManifest?.notes ?? []).map((n) => [n.id, n.contentHash])
  );
  // 远端清单已登记的资源 hash（filename 不可变 + 内容寻址，hash 一致即无需重传）
  const remoteAssetHashes = new Map<string, string>();
  for (const rn of remoteManifest?.notes ?? []) {
    for (const a of rn.assets || []) remoteAssetHashes.set(`${rn.id}/${a.filename}`, a.hash);
  }
  // 远端条目 map（上传跳过判定 + 墓碑 LWW 复用；命名避开外层 ObjectStore 的 remote）
  const remoteNotesById = new Map((remoteManifest?.notes ?? []).map((n) => [n.id, n]));
  let uploaded = 0;
  const manifestNotes: ManifestNote[] = [];
  /** 本机真正发布过内容的笔记 id（skip-fast 纯跟随/镜像的不计入——
   *  lastUploadedHash 语义 = 本机最后一次上传的 hash，只有本机发布过内容才更新，
   *  否则下载跟随的版本会被误判为"本机编辑成果"导致误留档）。 */
  const locallyUploadedIds = new Set<string>();

  const uploadStart = Date.now();
  const localTotal = localNotes.length;
  let localIndex = 0;
  for (const note of localNotes) {
    localIndex += 1;
    const noteUploadStart = Date.now();
    report({ phase: "upload", current: localIndex, total: localTotal, message: `上传笔记「${note.title}」` });
    // 增量扫描优化：synced 且远端条目 hash 与本地上次基线一致 → 本地无变更，
    // 直接复用缓存 hash + 远端 assets（正文未变 ⇒ 资源引用未变 ⇒ assets 一致），
    // 跳过 .lake 读取与资源扫描（9000+ 条笔记时每次同步省 ~2 万次文件 IO）。
    // purged = 收到他端 purge 后保留的本地回收站副本：不上传（恢复 = 清 purged 后再上传）
    if (note.syncState === "purged") {
      continue;
    }
    // TRASH-NOTEBOOK：本地回收站条目 vs 远端已恢复（active 且更新）→ 本端删除让位（跟随恢复）
    if (note.parentId === TRASH_NOTEBOOK_ID) {
      if (decideTrashYield(note, remoteNotesById.get(note.id))) {
        store.logScopes.sync.info(`[perf] upload ${note.id} trash-yield (remote restored newer)`);
        continue;
      }
    }
    const remoteEntry = remoteNotesById.get(note.id);
    const cachedHash = store.baseHash(note.id);
    if (decideUpload({
      // SyncNote.syncState 可选；undefined 等价于非 synced（快路径不成立）
      syncState: note.syncState ?? "local",
      baseHash: cachedHash,
      remoteContentHash: remoteEntry !== undefined && !remoteEntry.deleted ? remoteEntry.contentHash : null,
      remoteDeleted: remoteEntry?.deleted ?? false,
    }) === "skip-fast") {
      // skip-fast 保证远端条目存在且未删除、本地基线非空（decideUpload 输入映射等价于原条件）
      const entry = remoteEntry!;
      const base = cachedHash!;
      manifestNotes.push(buildUploadEntry({ note, contentHash: base, assets: entry.assets ?? [], trashedAt: entry.trashedAt ?? null, deletedFromParentId: entry.deletedFromParentId ?? null }));
      continue;
    }
    locallyUploadedIds.add(note.id);
    const hash = store.contentHash(note.id);
    // 审计 #1：资源清单必须**每次同步都重扫**（正文 hash 未变时也要保留 assets）。
    // §5.1：仅当前正文引用的资源有上传资格；历史引用资源不上传（本地保留，云端 B1 保留）。
    const currentRefs = store.getCurrentContentRefs(note.id);
    const assets: { filename: string; size: number; hash: string }[] = [];
    const pendingAssets: Array<{ filename: string; bytes: Buffer }> = [];
    const dir = store.noteAssetsPathFor(note.id);
    if (fs.existsSync(dir)) {
      for (const filename of fs.readdirSync(dir)) {
        if (!currentRefs.has(filename)) continue;
        const full = path.join(dir, filename);
        let stat: fs.Stats;
        try { stat = fs.statSync(full); } catch { continue; }
        if (!stat.isFile()) continue;
        let bytes: Buffer;
        try { bytes = fs.readFileSync(full); } catch { continue; }
        const assetHash = sha256Hex(bytes);
        assets.push({ filename, size: bytes.length, hash: assetHash });
        if (remoteAssetHashes.get(`${note.id}/${filename}`) !== assetHash) {
          pendingAssets.push({ filename, bytes });
        }
      }
    }
    // 上传资源（子进度，独立于笔记主进度）
    let uploadDone = 0;
    await runPool(pendingAssets, ASSET_TRANSFER_CONCURRENCY, async (pending) => {
      report({ phase: "upload", current: localIndex, total: localTotal, assetCurrent: ++uploadDone, assetTotal: pendingAssets.length, message: `上传笔记「${note.title}」` });
      await remote.put(`assets/${note.id}/${pending.filename}`, pending.bytes, mimeTypeFor(pending.filename));
    });
    let lakeUploaded = false;
    let lakeBytesLen = 0;
    if (remoteHashes.get(note.id) !== hash) {
      // 上传 .lake（正文变化时）
      const lakeBytes = fs.readFileSync(store.notePathFor(note.id));
      lakeBytesLen = lakeBytes.length;
      await remote.put(objectKey(note.id, hash), lakeBytes, "text/lake; charset=utf-8");
      uploaded += 1;
      lakeUploaded = true;
    }
    manifestNotes.push(buildUploadEntry({ note, contentHash: hash, assets, trashedAt: note.trashedAt ?? null, deletedFromParentId: note.deletedFromParentId ?? null }));
    store.logScopes.sync.info(`[perf] upload ${note.id} ${note.title} ${Date.now() - noteUploadStart}ms (lake=${lakeUploaded ? `${lakeBytesLen}B` : "skip"}, assets=${pendingAssets.length})`);
  }
  store.logScopes.sync.info(`[perf] upload phase ${Date.now() - uploadStart}ms (uploaded=${uploaded}, local=${localNotes.length})`);

  // 3.5 墓碑：本地已删除的笔记 → manifest 恒保留 deleted 标记（不重新上传对象）。
  // 审计 #2：墓碑不能写完一次就剪除——长期离线设备上线时若 manifest 已无 deleted
  // 标记，会把旧笔记当本地有效内容重新上传（删除复活）。墓碑/标记体积极小，
  // 按 id 永久保留直到本地重建同名笔记（此时 localIds 命中，不再标记 deleted）。
  const localIds = new Set(localNotes.map((n) => n.id));
  for (const deleted of store.listDeletedNotesForSync()) {
    if (localIds.has(deleted.id)) continue;
    // 墓碑 vs 远端恢复 LWW：远端已是 active 且 updatedAt 晚于本墓碑删除时间 →
    // 其他设备恢复较新，墓碑让位（不回写覆盖，避免恢复被撤销）。
    // 反向（本墓碑删除较新）仍回写，保证离线设备删除能传播（审计 #2）。
    const remoteNote = remoteNotesById.get(deleted.id);
    if (decideTombstoneYield(deleted.deletedAt, remoteNote)) {
      store.logScopes.sync.info(`[perf] upload ${deleted.id} tombstone-yield (remote restored newer)`);
      continue;
    }
    // 墓碑携带删除前内容：读本设备保留的 .lake（软删不删文件）算真实 hash 并上传，
    // 使其他设备能先拉到"删除前最新版"再应用墓碑（先内容、后标志）。读失败降级为占位符 id。
    let tombHash = deleted.id;
    try {
      const lakeBytes = fs.readFileSync(store.notePathFor(deleted.id));
      tombHash = sha256Hex(lakeBytes);
      // 内容寻址，PUT 幂等（对象可能已被其他设备上传，重复 PUT 无害）
      await remote.put(objectKey(deleted.id, tombHash), lakeBytes, "text/lake; charset=utf-8");
    } catch (error) {
      store.logScopes.sync.warn(`[perf] upload ${deleted.id} tombstone content unreadable, placeholder fallback`);
    }
    // 墓碑保持轻量：只带正文 contentHash，不携带资源列表（资源由 GC 按软删前缀保护 + B 端 list 补全）。
    manifestNotes.push(buildTombstoneEntry(deleted, tombHash));
  }

  // 4. 写新清单（commit + latest）
  report({ phase: "manifest", message: "写入同步清单..." });
  const manifestStart = Date.now();
  manifestNotes.sort((a, b) => a.sortOrder - b.sortOrder);
  // 目录树也要同步：否则文档会引用一个远端不存在的 notebook/group（设计完整性）。
  const manifestFolders: ManifestFolder[] = store.listFoldersForSync().map((f) => ({
    id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType,
    icon: f.icon, updatedAt: f.updatedAt,
    trashedAt: f.parentId === TRASH_NOTEBOOK_ID ? (f.trashedAt ?? null) : undefined,
    deletedFromParentId: f.parentId === TRASH_NOTEBOOK_ID ? (f.deletedFromParentId ?? null) : undefined,
  }));
  const commitId = crypto.randomUUID();
  const completedAt = new Date().toISOString();
  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    workspaceId: "default",
    commitId,
    prevCommitId: remoteManifest?.commitId ?? null,
    createdAt: completedAt,
    notes: manifestNotes,
    folders: manifestFolders,
  };
  const manifestOutput = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  await remote.put(`manifests/${commitId}.json`, manifestOutput, "application/json", { gzip: true });
  await remote.put("manifests/latest.json", manifestOutput, "application/json", { gzip: true });
  store.logScopes.sync.info(`[perf] manifest ${commitId} ${Date.now() - manifestStart}ms (notes=${manifestNotes.length}, folders=${manifestFolders.length}, bytes=${manifestOutput.length}, prev=${manifest.prevCommitId ?? "none"})`);
  // 验收 #3：每次同步后立即裁剪旧 manifest，只保留 latest + 3 份 commit 链（GC/清理引用上限），
  // 避免只靠 7 天 retention 的深度清理，测试一小时就累积 30+ 份 commit json。
  try {
    await pruneOldManifests(remote, commitId, remoteManifest, store.logScopes);
  } catch (error) {
    store.logScopes.sync.warn(`[perf] manifest prune failed (non-fatal): ${String(error)}`);
  }

  // P0-1 修正：lastUploadedHash 语义 = 已成功发布到 latest 的 hash，必须在 manifest 写成功后再更新。
  // 仅对"本机真正发布过内容"的笔记更新（locallyUploadedIds）；skip-fast 纯跟随/镜像的条目
  // （本机只是下载了他端的版本、从未上传过）绝不写入 lastUploadedHash——否则他端版本会被误判为
  // "本机编辑成果"，导致本机无编辑时被覆盖也误留档（2026-08-22 二修：A 上传 A1 后 B 恢复历史
  // 续编上传 B2，A 接受 B2 时应留档 A1，但 B 端此前 lastUploadedHash 被污染的同类场景会误留档）。
  // deleted 墓碑是占位 contentHash，绝不写入 sync_base/lastUploadedHash（Step B：computeBookkeeping）。
  for (const item of computeBookkeeping(manifestNotes)) {
    if (locallyUploadedIds.has(item.id)) {
      store.setLastUploadedHash(item.id, item.contentHash);
    }
    store.setBaseHash(item.id, item.contentHash);
    // V5 §5.2：快照 = 上传循环现算的 hash + manifest note 字段；同步期间编辑 → 不标，下轮重传
    store.markSyncedIfUnchanged(item.id, item.snapshot);
  }
  // V5 §5.1：folder 条件归位（latest 已发布成功后；用构建 manifest 时的 updatedAt 快照，
  // 同步期间本地再改 group 则 updated_at 变化 → 不归位，保持 local 下轮重传）。
  for (const f of manifestFolders) {
    store.markFolderSynced(f.id, f.updatedAt);
  }

  // 4.5 标记回收 + 撤销（v4 差集模型：只标记，不立即删）
  const newById = new Map(manifestNotes.map((n) => [n.id, n]));
  for (const prev of remoteManifest?.notes ?? []) {
    if (prev.deleted) continue;
    const next = newById.get(prev.id);
    if (!next || next.deleted) continue; // 软删/墓碑不在此标记；purge 见 M4
    if (next.contentHash !== prev.contentHash) {
      store.addS3GcPending(objectKey(prev.id, prev.contentHash));
    }
    const nextAssets = new Set((next.assets ?? []).map((a) => a.filename));
    for (const asset of prev.assets ?? []) {
      if (nextAssets.has(asset.filename)) continue;
      if (!store.getProtectedRefs(prev.id).has(asset.filename)) {
        store.addS3GcPending(`assets/${prev.id}/${asset.filename}`);
      }
    }
  }
  // 撤销：被新 manifest 重新引用的键立即解除待回收（P0-1 双保险第一层）
  const referencedNow = new Set<string>();
  for (const note of manifestNotes) {
    if (note.deleted) continue;
    referencedNow.add(objectKey(note.id, note.contentHash));
    for (const asset of note.assets ?? []) referencedNow.add(`assets/${note.id}/${asset.filename}`);
  }
  store.removeS3GcPending([...referencedNow]);

  // 4.6 purge 前缀立即删（M4）：先写 manifest（上面已完成）→ 再删 objects/assets 前缀。
  const purgedNotes = store.listPurgedNotesForSync();
  for (const note of purgedNotes) {
    const purgeStart = Date.now();
    const objs = await remote.deletePrefix(`objects/${note.id}-`);
    const assets = await remote.deletePrefix(`assets/${note.id}/`);
    // 删除成功后清除 purged_at（保留墓碑），避免后续每次同步重复删前缀。
    store.markPurgeSynced(note.id);
    store.logScopes.sync.info(`[perf] purge ${note.id} ${Date.now() - purgeStart}ms (objects=${objs}, assets=${assets})`);
  }

  const result: SyncResult = { uploaded, downloaded, conflicts: supersededNotes.length, manifestId: commitId, completedAt, supersededNotes, warnings: warnings.length > 0 ? warnings : undefined };
  store.markSyncComplete(completedAt);
  store.recordSyncResult(JSON.stringify(result));

  report({ phase: "done", message: "同步完成", supersededNotes });
  // 零变更早退的基线：记录本次成功读/写的 commitId 与墓碑签名
  store.setLastSeenCommitId(commitId);
  store.setLastTombstoneSig(store.tombstoneSignature());
  store.logScopes.sync.info(`[perf] syncNow done ${Date.now() - syncStart}ms (uploaded=${uploaded}, downloaded=${downloaded}, conflicts=${supersededNotes.length}, superseded=${supersededNotes.length})`);
  return result;
}

// ===== S3 GC：差集对账执行器（M5） =====
export interface GcReconcileResult {
  deleted: number;
  kept: number;
}

export async function runGcReconcile(store: Store): Promise<GcReconcileResult> {
  const gcStart = Date.now();
  store.logScopes.gc.info("[perf] gc-reconcile start");
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, store.logScopes);

  const latestBytes = await remote.getOptional("manifests/latest.json", { maxBytes: MAX_MANIFEST_BYTES });
  if (!latestBytes) { store.logScopes.gc.info(`[perf] gc-reconcile done ${Date.now() - gcStart}ms (no manifest)`); return { deleted: 0, kept: 0 }; }
  const latest = parseLakeManifest(latestBytes);


  const keep = new Set<string>();
  collectManifestRefs(latest, keep);

  // prevCommitId 链（与 prune / deep-cleanup 同一保留窗口）的引用一并保留
  let prev = latest.prevCommitId;
  let chain = 0;
  while (prev && chain < MANIFEST_CHAIN_KEEP) {
    const bytes = await remote.getOptional(`manifests/${prev}.json`, { maxBytes: MAX_MANIFEST_BYTES });
    if (!bytes) break;
    const m = parseLakeManifest(bytes);

    collectManifestRefs(m, keep);
    prev = m.prevCommitId;
    chain += 1;
  }

  // 本设备历史引用保护（B1：最佳努力）
  for (const noteId of store.listNoteIdsWithHistory()) {
    for (const filename of store.getProtectedRefs(noteId)) {
      keep.add(`assets/${noteId}/${filename}`);
    }
  }

  const cfg = store.getS3GcSettings();
  const cutoff = Date.now() - cfg.gcRetentionDays * 24 * 3600 * 1000;
  const pending = store.listS3GcPending().filter((p) => Date.parse(p.markedAt) <= cutoff);
  const toDelete = pending.filter((p) => !keep.has(p.key)).map((p) => p.key);
  if (toDelete.length > 0) {
    await remote.deleteMany(toDelete);
    store.removeS3GcPending(toDelete);
    for (const key of toDelete) store.recordS3GcLog("delete", key, "retention", latest.commitId, "local", true);
  }
  store.logScopes.gc.info(`[perf] gc-reconcile done ${Date.now() - gcStart}ms (deleted=${toDelete.length}, kept=${pending.length - toDelete.length}, pending=${pending.length})`);
  return { deleted: toDelete.length, kept: pending.length - toDelete.length };
}

// ===== S3 GC：深度清理（M7，Lake 侧；小记 keep 由调用方额外提供） =====
export interface DeepCleanupResult {
  dryRun: boolean;
  candidateCount: number;
  deletedCount: number;
  keys: string[];
}

export async function runDeepCleanup(store: Store, opts?: { dryRun?: boolean; extraKeep?: Set<string> }): Promise<DeepCleanupResult> {
  const deepStart = Date.now();
  store.logScopes.gc.info(`[perf] deep-cleanup start (dryRun=${opts?.dryRun ?? false})`);
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, store.logScopes);
  const dryRun = opts?.dryRun ?? false;
  const extraKeep = opts?.extraKeep ?? new Set<string>();

  const latestBytes = await remote.getOptional("manifests/latest.json", { maxBytes: MAX_MANIFEST_BYTES });
  if (!latestBytes) { store.logScopes.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (no manifest)`); return { dryRun, candidateCount: 0, deletedCount: 0, keys: [] }; }
  const latest = parseLakeManifest(latestBytes);


  const keep = new Set<string>(extraKeep);
  // 元数据 keep：manifest 文件本身
  keep.add("manifests/latest.json");
  collectManifestRefs(latest, keep);

  // commit 链（与 prune 同一保留窗口：latest + 本 commit + 8 层 prev = 10 份）
  let prev = latest.prevCommitId;
  let chain = 0;
  while (prev && chain < MANIFEST_CHAIN_KEEP) {
    keep.add(`manifests/${prev}.json`);
    const bytes = await remote.getOptional(`manifests/${prev}.json`, { maxBytes: MAX_MANIFEST_BYTES });
    if (!bytes) break;
    const m = parseLakeManifest(bytes);

    collectManifestRefs(m, keep);
    prev = m.prevCommitId;
    chain += 1;
  }

  // 历史引用保护
  for (const noteId of store.listNoteIdsWithHistory()) {
    for (const filename of store.getProtectedRefs(noteId)) {
      keep.add(`assets/${noteId}/${filename}`);
    }
  }

  const cfg = store.getS3GcSettings();
  const cutoff = Date.now() - cfg.gcRetentionDays * 24 * 3600 * 1000;
  // 空间隔离：只枚举 Lake 自己的三个子空间；quick-notes/ 由 runQuickNotesDeepCleanup 单独处理。
  const all = [
    ...(await remote.list("objects/")),
    ...(await remote.list("assets/")),
    ...(await remote.list("manifests/")),
  ];
  // TRASH-NOTEBOOK：回收站条目是 active 条目（assets 在 manifest keep 集），不再需要前缀保护 hack；
  // deleted 墓碑仅剩 purge 场景（其对象已由 M4 deletePrefix 删除）。
  const candidates = all
    .filter((item) => !keep.has(item.key))
    .filter((item) => Date.parse(item.lastModified) < cutoff)
    .map((item) => item.key);

  if (dryRun || candidates.length === 0) {
    store.logScopes.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=0)`);
    return { dryRun, candidateCount: candidates.length, deletedCount: 0, keys: candidates };
  }
  await remote.deleteMany(candidates);
  for (const key of candidates) store.recordS3GcLog("delete", key, "deep-clean", latest.commitId, "local", true);
  store.logScopes.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (dryRun=${dryRun}, candidates=${candidates.length}, deleted=${candidates.length})`);
  return { dryRun, candidateCount: candidates.length, deletedCount: candidates.length, keys: candidates };
}

/**
 * 验收 #3：裁剪 manifests/ 目录。保留 latest.json + 本设备刚写入的 commit + 沿 prevCommitId
 * 链再向上 8 份（共 10 个文件；超出 GC/对账 3 份引用上限的旧 commit 仅作容错保留）。
 * 只沿 latest 可达链裁剪：任何不在链上的 manifest 对 GC/对账均不可达，删除安全。
 * 删除失败不阻断同步（下次同步再试）。
 */
async function pruneOldManifests(remote: ObjectStore, commitId: string, remoteManifest: Manifest | null, logScopes: LoggerScopes): Promise<void> {
  const all = (await remote.list("manifests/")).map((item) => item.key);
  // 稳态 = latest + 本 commit + 沿 latest 链 8 层 prev，共 10 份（用户验收 #3：多留一些提高容错）；
  // 无需裁剪时跳过链遍历（省 2 次 GET）。
  if (all.length <= 10) return;
  const keep = new Set<string>(["manifests/latest.json", `manifests/${commitId}.json`]);
  let prev = remoteManifest?.commitId ?? null;
  let chain = 0;
  while (prev && chain < MANIFEST_CHAIN_KEEP) {
    const key = `manifests/${prev}.json`;
    keep.add(key);
    try {
      const bytes = await remote.getOptional(key);
      if (!bytes) break;
      const m = parseLakeManifest(bytes);

      prev = m.prevCommitId;
    } catch { break; }
    chain += 1;
  }
  const toDelete = all.filter((key) => !keep.has(key));
  if (toDelete.length === 0) return;
  await remote.deleteMany(toDelete);
  logScopes.sync.info(`[perf] manifest prune ${toDelete.length} old (kept=${keep.size})`);
}


// ===== Step A re-export（自 src/core/syncUtils.js，行为等价；外部调用方不感知拆分） =====
export type { S3Settings } from "../src/core/syncUtils.js";
export { parseLakeManifest, validateS3Settings, mimeTypeFor } from "../src/core/syncUtils.js";
/** 桌面 Buffer 版 sha256（原 node:crypto 同步实现 → core 纯 JS 同步，输出一致；Buffer 是 Uint8Array 子类） */
export const sha256Hex = (bytes: Buffer): string => coreSha256Hex(bytes);
export { isSafePathSegment as isSafeSegment } from "../src/core/storeUtils.js";
