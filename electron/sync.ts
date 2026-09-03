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
import { gcCutoffMs, isPastWindow, parseIsoMs } from "../src/core/gcPolicy.js";
import { isSafePathSegment as isSafeSegment } from "../src/core/storeUtils.js";
import { decidePurge, decideLocalTombstone, decideMetaApply,
  decideTombstoneYield, buildUploadEntry, buildTombstoneEntry, computeBookkeeping,
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
  /** 本次同步总耗时（毫秒，含小记同步与 GC 标记）。 */
  durationMs?: number;
  /** 本次同步移入回收站的文档数（下载应用墓碑 + 本端软删发布，不含已在回收站的重复应用）。 */
  trashed?: number;
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
/** 保留的 manifest commit 链长度（回归设计 S3-GC-DESIGN D4/§85「最近 3 份 commit，沿链 O(3) 遍历」）。
 * 实现曾一度提到 8（"多留提高容错"），但 prune 在每次有变更的发布里都沿链回捞 = N 次串行 GET，
 * 是稳态同步的纯浪费（实测单张 89B 图片的首传同步被拖到 4.4s，其中约 1.3s 就是回捞 8 份历史 manifest）。
 * 浅链不影响数据安全：活动对象恒在 latest 全量快照内，被降级出 latest 的旧键另有
 * 「本地历史 refs 保护 + 7 天年龄保护 + 重新引用即撤销 s3_gc_pending」三重兜底；prevCommitId 链只是
 * 更保守的容错回溯窗口。prune / runGcReconcile / runDeepCleanup 三者共用此常量，必须一致，
 * 否则深度清理会把「多留的份」在窗口后删掉。 */
const MANIFEST_CHAIN_KEEP = 3;
/** 滞后裁剪水位（份）：prune 不再每次发布都做链遍历，累计超过 (2 + KEEP + SLACK) 才裁回 (2 + KEEP)。
 *  把「list + 沿链 GET」的 housekeeping 摊薄到约每 SLACK 次发布一次；期间 manifests/ 目录略多占几个小文件，无正确性影响。 */
const MANIFEST_PRUNE_SLACK = 6;
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
  /** ListObjectsV2 分页列出前缀下键（相对键 + LastModified + Size；Size 供 GC 诊断/清理统计体积用，云端缺失记 0）。 */
  async list(prefix: string): Promise<Array<{ key: string; lastModified: string; size: number }>> {
    const t0 = Date.now();
    const fullPrefix = this.key(prefix);
    const out: Array<{ key: string; lastModified: string; size: number }> = [];
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
        out.push({ key: this.unkey(obj.Key), lastModified: obj.LastModified?.toISOString() ?? "", size: typeof obj.Size === "number" ? obj.Size : 0 });
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
  // Step 5：桌面编排收敛到共享 syncEngine（syncNowViaEngine 委托）。
  // 旧编排代码保留在 git 历史（842 行前版本可回滚）；行为由 syncEquivalence/syncAdapterEquiv/syncDualAB 等价测试锁定。
  return syncNowViaEngine(store, onProgress, createRemote);
}

// ===== S3 GC：权威引用集与执行器（M5/M7，keep 集单一来源） =====
/**
 * Lake 侧「云端仍被权威引用」的键全集：
 *   latest.json 本身 + latest 清单引用（正文/资源/文件夹） + prevCommitId 链上 KEEP(3) 份 commit
 *   + 本设备任意历史快照引用的资源（B1：本设备最佳努力，非跨设备承诺）。
 * 对账与深度清理必须共用本函数——否则两处各按一份 keep 判断，会出现口径漂移
 * （2026-09-03 排查：UI「待回收 23」与「对账/深度清理 0」看似矛盾即源于多入口语义不清）。
 */
export async function buildLakeGcKeepSet(store: Store, remote: ObjectStore, latest: Manifest | null): Promise<Set<string>> {
  const keep = new Set<string>(["manifests/latest.json"]);
  if (latest) {
    collectManifestRefs(latest, keep);
    let prev = latest.prevCommitId;
    let chain = 0;
    while (prev && chain < MANIFEST_CHAIN_KEEP) {
      const key = `manifests/${prev}.json`;
      keep.add(key);
      const bytes = await remote.getOptional(key, { maxBytes: MAX_MANIFEST_BYTES });
      if (!bytes) break;
      const m = parseLakeManifest(bytes);
      collectManifestRefs(m, keep);
      prev = m.prevCommitId;
      chain += 1;
    }
  }
  // 本设备历史引用保护（B1：最佳努力）
  for (const noteId of store.listNoteIdsWithHistory()) {
    for (const filename of store.getProtectedRefs(noteId)) {
      keep.add(`assets/${noteId}/${filename}`);
    }
  }
  return keep;
}

export interface GcReconcileResult {
  /** 本次实际删除的对象数（已过窗口 ∧ 不再被权威引用）。 */
  deleted: number;
  /** 仍在保留窗口内、暂不可删的待回收行数（表内继续保留）。 */
  kept: number;
  /** 已过窗口但仍被权威引用 → 从待回收表清除（不是冗余，不再展示为待回收），对象不动。 */
  clearedReferenced: number;
  /** 标记时间缺失/非法、无法判定窗口的行数（保守保留）。 */
  ageUnknown: number;
}

/**
 * 差集对账（M5）：逐行审视本机 s3_gc_pending，按「窗口 + 权威引用集 keep」三分：
 *   · 已过窗口 ∧ 不在 keep → 云端删除 + 清表（deleted）
 *   · 已过窗口 ∧ 在 keep   → 已被再次引用（本设备发布 / 他端发布），清表不动对象（clearedReferenced）
 *   · 窗口内 / 时间戳非法  → 保留等窗口（kept / ageUnknown）
 * 说明：旧实现只删「已过窗口 ∧ 不在 keep」，把「已过窗口但仍被引用」的行永久留在表里，
 * 造成 UI「待回收」数字只增不清、与实际可回收量脱节（2026-09-03 用户排查现象的一部分）。
 */
export async function runGcReconcile(store: Store, opts?: { ignoreRetention?: boolean }): Promise<GcReconcileResult> {
  const gcStart = Date.now();
  store.logScopes.gc.info("[perf] gc-reconcile start");
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, store.logScopes);

  const latestBytes = await remote.getOptional("manifests/latest.json", { maxBytes: MAX_MANIFEST_BYTES });
  if (!latestBytes) { store.logScopes.gc.info(`[perf] gc-reconcile done ${Date.now() - gcStart}ms (no manifest)`); return { deleted: 0, kept: 0, clearedReferenced: 0, ageUnknown: 0 }; }
  const latest = parseLakeManifest(latestBytes);
  const keep = await buildLakeGcKeepSet(store, remote, latest);

  const cfg = store.getS3GcSettings();
  // 手动对账（UI 按钮）= 显式清理云端 → 无视保留窗口（边界推到未来，所有可解析标记都视为到期）；
  // 自动/定时对账仍按窗口走（opts.ignoreRetention 缺省 false）。
  const cutoff = opts?.ignoreRetention ? Number.MAX_SAFE_INTEGER : gcCutoffMs(Date.now(), cfg.gcRetentionDays);
  const toDelete: string[] = [];
  const toClear: string[] = [];
  let kept = 0;
  let ageUnknown = 0;
  for (const p of store.listS3GcPending()) {
    const ms = parseIsoMs(p.markedAt);
    if (ms === null) { ageUnknown += 1; continue; }     // 判不出就不删（保守）
    if (ms <= cutoff) {
      if (keep.has(p.key)) toClear.push(p.key);         // 仍被引用 → 撤销表内冗余项
      else toDelete.push(p.key);                        // 真冗余且已过窗口 → 删除
    } else {
      kept += 1;                                        // 窗口内暂不可删
    }
  }
  if (toDelete.length > 0) {
    await remote.deleteMany(toDelete);
    store.removeS3GcPending(toDelete);
    for (const key of toDelete) store.recordS3GcLog("delete", key, "retention", latest.commitId, "local", true);
  }
  if (toClear.length > 0) store.removeS3GcPending(toClear);
  store.logScopes.gc.info(`[perf] gc-reconcile done ${Date.now() - gcStart}ms (deleted=${toDelete.length}, kept=${kept}, cleared=${toClear.length}, ageUnknown=${ageUnknown})`);
  return { deleted: toDelete.length, kept, clearedReferenced: toClear.length, ageUnknown };
}

// ===== S3 GC：深度清理（M7，Lake 侧；小记清理在 quickNotesSync） =====
export interface DeepCleanupResult {
  dryRun: boolean;
  candidateCount: number;
  deletedCount: number;
  keys: string[];
}

/**
 * 深度清理（M7）：云端实扫 objects/assets/manifests，删除「不在权威引用集 ∧ 已过保留窗口」的键。
 * 窗口判定用「对象创建时间（lastModified）+ 本机待回收表」双锚：
 *   若该键在本机 s3_gc_pending 中 → 还须待回收标记也过窗口（即 max(created, removed)+窗口 语义，
 *   避免「刚被移除、还处在撤销/恢复窗口内」的对象被创建年龄提前清掉，与对账 M5 同口径）；
 *   无待回收标记（他端移除/历史孤儿）→ 仅看创建年龄。
 * dryRun=true 只列出不删；删除写 s3_gc_log。只枚举 Lake 子空间；quick-notes/ 由 runQuickNotesDeepCleanup 单独处理。
 * opts.ignoreRetention=true（手动 UI 触发）= 显式清理云端：删除当前全部未引用键、无视 7 天窗口（自动/定时仍默认窗口）。
 */
export async function runDeepCleanup(store: Store, opts?: { dryRun?: boolean; extraKeep?: Set<string>; ignoreRetention?: boolean }): Promise<DeepCleanupResult> {
  const deepStart = Date.now();
  store.logScopes.gc.info(`[perf] deep-cleanup start (dryRun=${opts?.dryRun ?? false}, ignoreRetention=${opts?.ignoreRetention ?? false})`);
  const settings = store.getS3Settings();
  if (!settings) throw new Error("请先保存 S3 配置");
  validateS3Settings(settings);
  const remote = new ObjectStore(settings, store.logScopes);
  const dryRun = opts?.dryRun ?? false;
  const extraKeep = opts?.extraKeep ?? new Set<string>();
  const ignoreRetention = opts?.ignoreRetention ?? false;

  const latestBytes = await remote.getOptional("manifests/latest.json", { maxBytes: MAX_MANIFEST_BYTES });
  if (!latestBytes) { store.logScopes.gc.info(`[perf] deep-cleanup done ${Date.now() - deepStart}ms (no manifest)`); return { dryRun, candidateCount: 0, deletedCount: 0, keys: [] }; }
  const latest = parseLakeManifest(latestBytes);

  const keep = await buildLakeGcKeepSet(store, remote, latest);
  for (const k of extraKeep) keep.add(k);

  const cfg = store.getS3GcSettings();
  const cutoff = gcCutoffMs(Date.now(), cfg.gcRetentionDays);
  // 本机待回收表（键 → 标记时刻）：供「移除时间」锚定（见函数注释）。
  const pendingByKey = new Map(store.listS3GcPending().map((p) => [p.key, p.markedAt] as const));

  // TRASH-NOTEBOOK：回收站条目是 active 条目（assets 在 manifest keep 集），不再需要前缀保护 hack；
  // deleted 墓碑仅剩 purge 场景（其对象已由 M4 deletePrefix 删除）。
  const all = [
    ...(await remote.list("objects/")),
    ...(await remote.list("assets/")),
    ...(await remote.list("manifests/")),
  ];
  const candidates = all
    .filter((item) => !keep.has(item.key))
    .filter((item) => {
      if (ignoreRetention) return true;                       // 手动深度清理：显式清云端 → 全部未引用（含窗口内/年龄未知）
      if (!isPastWindow(item.lastModified, cutoff)) return false;   // 自动：创建不足窗口 → 保护
      const marked = pendingByKey.get(item.key);
      return marked === undefined || isPastWindow(marked, cutoff);  // 自动：本机已标记但窗口未过 → 保护
    })
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

 * 验收 #3（修订）：裁剪 manifests/ 目录，保留 latest.json + 刚写入 commit + 沿 prevCommitId 链 KEEP(3) 份
 * （稳态 targetFiles = 2 + KEEP = 5 个文件）。为把「list + 沿链 GET」的 housekeeping 摊薄出同步热路径，
 * 采用滞后裁剪：目录内文件数未超过 targetFiles + SLACK 时直接返回（仅一次 list，不做链遍历 GET），
 * 仅当超水位才沿链算出 keep 集并把多余的旧 commit 删回 target。只沿 latest 可达链裁剪：任何不在链上
 * 的 manifest 对 GC/对账均不可达，删除安全；删除失败不阻断同步（下次同步再试）。
 */
export async function pruneOldManifests(remote: ObjectStore, commitId: string, remoteManifest: Manifest | null, logScopes: LoggerScopes): Promise<void> {
  const targetFiles = 2 + MANIFEST_CHAIN_KEEP;          // latest.json + 刚写入 commit + 链 prev（KEEP 份）
  const all = (await remote.list("manifests/")).map((item) => item.key);
  // 滞后水位：未到阈值只花一次 list，跳过链遍历（省 KEEP 次串行 GET）；这是本次性能优化的主菜。
  if (all.length <= targetFiles + MANIFEST_PRUNE_SLACK) return;
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