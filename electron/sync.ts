import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import crypto from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import type { Store } from "./store.js";
import { syncNowViaEngine } from "./syncEngineController.js";
import { createSilentLoggerScopes, type LoggerScopes } from "../src/core/logger.js";
import { ASSET_TRANSFER_CONCURRENCY, runPool } from "../src/core/asyncPool.js";
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
import { MAX_IMAGE_BYTES } from "../src/core/storeLimits.js";
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
  /** 同步统计（思源式 tooltip）：上传/下载的目录数与字节数（正文 + 资源 + manifest）。 */
  foldersUploaded?: number; foldersDownloaded?: number;
  uploadedBytes?: number; downloadedBytes?: number;
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

  /** HEAD 探测对象是否存在（附件存在性检查用；避免整对象 GET 只为判存在）。
   * 七牛 Kodo 对 HeadBucket 返回 404（AGENTS.md 踩坑 #4），HeadObject 是标准 S3 API，
   * 已在实测桶验证可用；异常（非 404）抛出由调用方处理。 */
  async headObject(key: string): Promise<boolean> {
    assertSafeKey(key);
    const t0 = Date.now();
    try {
      await this.send<Record<string, unknown>>(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(key) }));
      this.log.s3.info(`[perf] head ${key} ${Date.now()}ms HIT`);
      return true;
    } catch (error) {
      if (isNoSuchKey(error)) { this.log.s3.info(`[perf] head ${key} ${Date.now()}ms MISS`); return false; }
      this.log.s3.warn(`[perf] head ${key} FAIL ${Date.now()}ms: ${errorMessage(error)}`);
      throw new Error("S3 探测失败 (" + key + "): " + errorMessage(error));
    }
  }

  /** 流式上传（大附件用）：Body 直接给 Node Readable，显式 Content-Length（避免 aws-chunked，
   * 七牛 Kodo 兼容性已验证）。失败抛错，调用方重试/下轮同步重传（幂等对账语义）。 */
  async putStream(key: string, size: number, open: () => Promise<import("node:stream").Readable | null>): Promise<void> {
    assertSafeKey(key);
    const t0 = Date.now();
    const stream = await open();
    if (!stream) return; // 本地文件缺失（已删除）→ 视为无此资产
    try {
      await this.send<Record<string, unknown>>(new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(key),
        Body: stream,
        ContentLength: size,
        ContentType: "application/octet-stream",
        CacheControl: "no-cache",
      }));
      this.log.s3.info(`[perf] put-stream ${key} ${Date.now()}ms (${size}B)`);
    } catch (error) {
      this.log.s3.warn(`[perf] put-stream ${key} FAIL ${Date.now()}ms: ${errorMessage(error)}`);
      throw new Error("S3 上传失败 (" + key + "): " + errorMessage(error));
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
  private async send<T>(command: GetObjectCommand | PutObjectCommand | HeadObjectCommand | ListObjectsV2Command | DeleteObjectCommand | DeleteObjectsCommand): Promise<T> {
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
  // Step 5：桌面编排收敛到共享 syncEngine（syncNowViaEngine 委托）。
  // 旧编排代码保留在 git 历史（842 行前版本可回滚）；行为由 syncEquivalence/syncAdapterEquiv/syncDualAB 等价测试锁定。
  return syncNowViaEngine(store, onProgress, createRemote);
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
export async function pruneOldManifests(remote: ObjectStore, commitId: string, remoteManifest: Manifest | null, logScopes: LoggerScopes): Promise<void> {
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