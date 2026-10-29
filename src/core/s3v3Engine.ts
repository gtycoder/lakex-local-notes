import { sha256Hex } from "./syncUtils.js";
import {
  S3V3_POINTER_KEY,
  assetKey,
  declarationKey,
  indexKey,
  lakeBodyKey,
  quickNoteAssetKey,
  quickNoteBodyKey } from "./s3v3/protocol/s3v3Keys.js";
import {
  buildAssetDeclaration,
  declarationHashOf,
  indexHashOf,
  parseLakeIndexBytes,
  parseQuickNotesIndexBytes,
  pruneQuickPurgedIds,
  serializeDeclaration,
  serializeQuickNotesIndex,
  validateAssetDeclaration,
  type AssetDeclaration,
  type LakeIndex,
  type QuickNoteEntry,
  type QuickNotesIndex } from "./s3v3/protocol/s3v3Index.js";
import type { S3v3Pointer } from "./s3v3/protocol/s3v3Types.js";
import { validatePointer } from "./s3v3/protocol/s3v3Types.js";
import { runSyncRound } from "./s3v3/commit/runSyncRound.js";
import { initialRound } from "./s3v3/commit/initialRound.js";
import { pullRound, readRemoteIndexes } from "./s3v3/commit/pullRound.js";
import { finalizeRemotePurged, mergeRoundIntoState, planStateOf, planWorldOf } from "./s3v3/commit/engineBridge.js";
import { createRoundPorts } from "./s3v3/commit/roundPorts.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";
import type { SyncWarning } from "./sharedTypes.js";
import type { S3v3Remote } from "./s3v3Ports.js";
import { runPoolSettled } from "./s3v3Pool.js";
import { runTransferPipeline } from "./s3v3Transfer.js";

const DEFAULT_TRANSFER_CONCURRENCY = 12; // 上传并发（用户批准：8 → 12）
/** 下载流水线并发（正文/声明/资产统一调度；用户批准 16–24，实测七牛/真机带宽在此区间打满）。 */

const LOCK_KEY = "meta/lock.json";
const LOCK_TTL_MS = 120_000;
/** 锁重试：无 CAS 的 provider 下，靠「写后静置再读回」降低双持窗口。 */
const LOCK_DEADLINE_MS = 15_000;
const LOCK_SETTLE_MS = 40;
const MAX_PUBLISH_RETRIES = 6;
/** 「首轮并发首传」竞态重试上限（261027）：两端同时空桶首传时，后到者可能先读到 pointer=null、
 *  再 list 到对端已上传的对象 ⇒ pointer-corrupt。等对端发布完 pointer 再同步一次即可（若真是损坏，
 *  重试仍失败、错误码不变，不会掩盖问题）。 */
const MAX_CLOUD_RACE_RETRIES = 2;
/** 四相内核的发布锁等待（ms）：**只在锁被别人持有时才产生等待**，正常轮零成本。
 *  3s（commitPlan 默认）在 6~7 端同时发布时会把「锁忙」当失败（并发压测 42 次里 7 次），故提到 10s。 */
const PUBLISH_LOCK_WAIT_MS = 10_000;
/** 锁忙的外层总预算（含上面单次等待 + 退避）：超了才把 lock-busy 抛给 UI，避免无界空转。 */
const PUBLISH_LOCK_BUSY_BUDGET_MS = 20_000;
/** 单条推送的发布重试（pointer 被别的端改动时重来一次）。 */
const SINGLE_PUSH_MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 资产声明是**不可变内容寻址对象**（key = declHash）⇒ 进程内可安全跨轮/跨引擎复用。
 * 桌面每轮都会 new 一个引擎：没有这层缓存时，元数据漂移导致大量 applyRemote 的轮次会
 * 逐篇重复 GET 声明对象（崩溃追赶实测 4,070 次 meta GET 的一部分）。上限 4096 条 + **LRU**
 * （命中刷新队尾，避免热点声明被新条目挤掉；跨引擎共享是刻意的）。
 */
const DECL_CACHE_LIMIT = 4096;
const DECL_CACHE = new Map<string, AssetDeclaration>();

export class S3v3SyncError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "S3v3SyncError";
  }
}

/** 同步错误分类：UI/日志据此决定是否可自动重试，或必须人工处理（分叉/损坏）。 */
export type S3v3ErrorClass = "retryable" | "action-required" | "fatal";
export function classifyS3v3Error(error: unknown): S3v3ErrorClass {
  const code = error instanceof S3v3SyncError ? error.code : (error as { code?: string } | null)?.code;
  if (code === "lock-busy" || code === "publish-conflict" || code === "cloud-changed") return "retryable";
  if (code === "empty-cloud" || code === "epoch-mismatch" || code === "generation-rollback" || code === "fork") return "action-required";
  if (code === "pointer-corrupt") return "fatal";
  // 网络/未知错误按可重试处理（S3 SDK 自身有重试；上层每轮同步会再试）
  return "retryable";
}
class PublishRetry extends Error {}

export interface S3v3SyncOptions {
  /** 云端为空且本地有数据时的选择；未给则抛 empty-cloud，交给 UI 询问。 */
  onEmptyCloud?: "upload" | "stay";
  /** 按需资产（P0-4，261026）：首拉只拉 pointer/索引/正文，媒体字节延后到打开/预览时补拉。
   *  默认 false（保持全量语义）；移动端可由「按需下载附件」开关打开。 */
  deferAssets?: boolean;
}
export interface S3v3SyncReport {
  downloadedNotes: number;
  uploadedNotes: number;
  /** 细分（261028）：文档/小记/目录/字节；旧字段保留给兼容调用方。 */
  uploadedDocuments?: number;
  downloadedDocuments?: number;
  uploadedQuickNotes?: number;
  downloadedQuickNotes?: number;
  uploadedFolders?: number;
  downloadedFolders?: number;
  uploadedBytes?: number;
  downloadedBytes?: number;
  deletedObjects: number;
  published: boolean;
  generation: number | null;
  /** 兼容旧调用方/日志的一行式消息（与 warningDetails 一一对应子集）。 */
  warnings: string[];
  /** 结构化警告（UI 展示/点击定位；SyncWarningKind 见 src/core/sharedTypes.ts）。 */
  warningDetails: SyncWarning[];
  /** 本轮被远端覆盖、已强制写本地历史的文档（UI 冲突清单/角标；对齐旧协议 supersededNotes）。 */
  supersededNotes: Array<{ id: string; title: string }>;
}
/** 引擎级进度（P0-6）：阶段 + 已下/总数 + 字节；UI 据此显示进度条与预计剩余。 */
export interface S3v3Progress {
  phase: "connect" | "metadata" | "bodies" | "declarations" | "assets" | "apply" | "uploads" | "finalize" | "done";
  done?: number;
  total?: number;
  bytesDone?: number;
  bytesTotal?: number;
}

/** 深度清理选项（手动/周期；不进入日常同步）。 */
export interface S3v3DeepCleanupOptions {
  dryRun?: boolean;
  /** 额外保留的相对键（本机历史快照引用的 `assets/<noteId>/<filename>` 等）。 */
  extraKeep?: Iterable<string>;
  /** 保留窗口（天）：窗口内对象一律不删（默认 7；<=0 = 立即到期，只保留显式 keep）。 */
  retentionDays?: number;
  /** 时钟注入（测试用）。 */
  now?: () => Date;
}

export interface S3v3DeepCleanupResult {
  /** 实际删除（dryRun 时为「将删除」）的相对键。 */
  deleted: string[];
  /** 显式 keep 集大小。 */
  kept: number;
  dryRun: boolean;
  /** 已不可达但仍在保留窗口内、本轮跳过删除的对象数。 */
  skippedRecent: number;
  /** provider 未返回 lastModified（无法判龄）而保守保留的对象数。 */
  ageUnknown: number;
  /** 被额外保护的上一版索引 key（每空间至多 1 个）。 */
  previousIndexes: string[];
}

/** 单条小记推送结果（「保存并同步」）。full-sync = 调用方必须退回一次整轮同步（不静默降级）。 */
export type QuickNotePushResult =
  | { status: "pushed"; uploadedContent: boolean; uploadedAssets: number; unchanged: boolean; generation: number }
  | { status: "full-sync"; reason: "no-cloud" | "no-baseline" | "cloud-changed" | "remote-deleted" }
  | { status: "not-found" };

export interface S3v3EngineOptions {
  remote: S3v3Remote;
  device: S3v3DeviceStore;
  deviceId: string;
  now?: () => Date;
  /** 发布锁最长等待（ms）；测试可调小。默认 LOCK_DEADLINE_MS。 */
  lockWaitMs?: number;
  /** 四相内核（本轮发布）的锁等待（ms）：只在锁被别的端持有时才等；默认 PUBLISH_LOCK_WAIT_MS。 */
  publishLockWaitMs?: number;
  /** 阶段耗时回调（诊断慢同步/卡顿）：phase + 距上一阶段毫秒数。 */
  onPhase?: (phase: string, ms: number) => void;
  /** 结构化进度回调（阶段 + 计数 + 字节；桥接层负责节流，引擎不节流）。 */
  onProgress?: (progress: S3v3Progress) => void;
  /** 上传并发（261025 用户批准从 8 提到 12；实测首同步约 1.5x）。 */
  transferConcurrency?: number;
  /** 下载流水线并发（正文/声明/资产共用；默认 20，clamp 1..32）。 */
  downloadConcurrency?: number;
  /** 大对象分片大小（字节；默认 8MB，<=0 关闭分片）。仅当 remote.getRange 存在且没有原生整对象流式时生效。 */
  largeAssetChunkBytes?: number;
}

const emptyState = (): DeviceState => ({
  lake: { v: 3, space: "lake", notes: [], folders: [] },
  quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
  folders: [],
  pendingAssets: [],
  intents: [],
  pending: [],
  remotePurged: [],
  restorePending: [] });

export class S3v3SyncEngine {
  private readonly remote: S3v3Remote;
  private readonly device: S3v3DeviceStore;
  private readonly deviceId: string;
  private readonly now: () => Date;
  private readonly lockWaitMs: number;
  private readonly publishLockWaitMs: number;
  private readonly onPhase?: (phase: string, ms: number) => void;
  private readonly onProgress?: (progress: S3v3Progress) => void;
  private readonly transferConcurrency: number;
  /** 大对象分片阈值（261027）：超过则按 Range 并发下载；0 = 关闭。 */
  private readonly largeAssetChunkBytes: number;
  private phaseStart = 0;
  private uploadOps: Array<{ space: "lake" | "quickNotes"; noteId: string; key: string; bytes?: Uint8Array; fromFile?: string; gzip?: boolean; /** 字节数（fromFile 也带上，供上传进度用） */ size?: number }> = [];
  /** 当前轮 report（细分统计累加；syncOnce 入口重置）。 */
  private report: S3v3SyncReport | null = null;
  private addUploadedBytes(n: number): void { if (this.report) this.report.uploadedBytes = (this.report.uploadedBytes ?? 0) + n; }
  /**
   * 云端正文缓存（仅 lake）：同一轮里「预取 → 应用」复用同一份字节，避免同一篇再 GET 一次。
   *
   * 生命周期（SD-02）——**只服务当前批/当前轮，绝不跨轮常驻**：
   *  · pullAll（首拉/全量重拉）：每下完 BODY_CHUNK 篇并落库后立即 clearBodyCache()，峰值 = 一批；
   *  · incrementalSync：预取的正文在 apply 写盘后逐篇 dropBody()（缓存随消费下降），应用环结束再整体清空；
   *  · restoreMissingBody：拉回并落盘后立即释放，不留「每条缺正文一份」；
   *  · sync() 每轮结束（含异常/发布重试）finally 兜底清空，引擎实例不会带着正文进下一轮；
   *  · 硬上限 = BODY_CACHE_MAX_ENTRIES / BODY_CACHE_MAX_BYTES（FIFO 淘汰）：任何漏清的调用点也只多占一批。
   */
  private readonly bodyCache = new Map<string, Uint8Array>();
  /** bodyCache 当前字节数（插入/删除同步记账，避免每次求和）。 */
  private bodyCacheBytes = 0;
  /** 诊断/护栏（SD-02）：引擎生命周期内的峰值条目/字节（测试断言「不随库大小线性增长」）。 */
  private bodyCachePeakEntries = 0;
  private bodyCachePeakBytes = 0;
  /** 本轮/本引擎实例里「发布锁被别人占着」的次数（诊断与并发回归用；正常轮恒 0）。 */
  publishLockBusyRetries = 0;
  private warnings: string[] = [];
  private warningDetails: SyncWarning[] = [];
  private supersededNotes: Array<{ id: string; title: string }> = [];

  constructor(opts: S3v3EngineOptions) {
    this.remote = opts.remote;
    this.device = opts.device;
    this.deviceId = opts.deviceId;
    this.now = opts.now ?? (() => new Date());
    this.lockWaitMs = opts.lockWaitMs ?? LOCK_DEADLINE_MS;
    this.publishLockWaitMs = Math.max(0, Math.floor(opts.publishLockWaitMs ?? PUBLISH_LOCK_WAIT_MS));
    this.onPhase = opts.onPhase;
    this.onProgress = opts.onProgress;
    this.transferConcurrency = Math.max(1, Math.min(32, opts.transferConcurrency ?? DEFAULT_TRANSFER_CONCURRENCY));
    this.largeAssetChunkBytes = Math.max(0, Math.floor(opts.largeAssetChunkBytes ?? 8 * 1024 * 1024));
  }

  /** 记录阶段耗时；回调异常不影响同步。 */
  private phase(name: string): void {
    const now = Date.now();
    const ms = now - this.phaseStart;
    this.phaseStart = now;
    try { this.onPhase?.(name, ms); } catch { /* 日志回调自行负责 */ }
  }

  private iso(): string { return this.now().toISOString(); }

  /** 进度上报（UI 回调异常绝不影响同步）。 */
  private emitProgress(progress: S3v3Progress): void {
    try { this.onProgress?.(progress); } catch { /* UI 回调自行负责 */ }
  }

  /** 记录一条结构化警告（同时保留一行式消息给日志/旧调用方）。 */
  private warn(message: string, extra: Omit<SyncWarning, "message"> = { kind: "remote_incomplete" }): void {
    this.warnings.push(message);
    this.warningDetails.push({ ...extra, message });
  }

  /** 正常同步（先拉后推 + 发布锁 + 待删门禁）。 */
  async sync(opts: S3v3SyncOptions = {}): Promise<S3v3SyncReport> {
    this.uploadOps = [];
    this.phaseStart = Date.now();
    let lastErr: unknown = null;
    let raceRetries = 0;
    for (let attempt = 0; attempt < MAX_PUBLISH_RETRIES; attempt++) {
      this.warnings = [];
      this.warningDetails = [];
      this.supersededNotes.length = 0;
      try {
        const result = await this.syncOnce(opts);
        this.phase("total");
        return result;
      } catch (e) {
        if (e instanceof PublishRetry) {
          lastErr = e;
          // 并发发布冲突：指数退避 + 抖动，避免 6 端同步碰撞后一起重试
          await sleep(120 + Math.floor(Math.random() * (attempt + 1) * 220));
          continue;
        }
        // 首轮并发现身（pointer 还没写、对象已在 Cloud）⇒ 等一拍重试；有基线时的 pointer 缺失是真损坏，照抛。
        if (e instanceof S3v3SyncError && e.code === "pointer-corrupt" && raceRetries < MAX_CLOUD_RACE_RETRIES) {
          const baseline = await this.device.loadBaseline().catch(() => null);
          if (!baseline) {
            raceRetries++;
            await sleep(150 + Math.floor(Math.random() * 250));
            continue;
          }
        }
        throw e;
      } finally {
        // SD-02：本轮结束（成功/异常/发布重试都算）立刻释放正文缓存，绝不带到下一轮。
        this.clearBodyCache();
      }
    }
    throw new S3v3SyncError("publish-conflict", "发布冲突重试超限: " + String(lastErr));
  }

  /**
   * 单条小记推送（「保存并同步」，对齐旧 quickNotePush 语义；v3 parity E2）。
   *
   * 铁律：**只 upsert 这一条** —— 其余小记条目、标签目录、purged 墓碑逐字段保持云端原样。
   * 流程：读 pointer/quick 索引 → 上传本条正文/图片 → 生成新 quick 索引（内容寻址）→
   *       取发布锁 → 复核 pointer 未变（CAS）→ 写索引 → 写 pointer（generation+1，lake 不动）→ 读回校验
   *       → 本地记账（markQuickNoteSynced + baseline 跟进，I2「未变才标」由适配器保证）。
   *
   * 两条退回整轮的路径（不静默降级，由调用方执行整轮）：
   *  1) 云端没有 pointer / 没有 baseline / baseline 与 pointer 不同代（云已变）；
   *  2) 远端 quick 索引里该条是 purged 墓碑且本机没有显式恢复标记（墓碑权威，不许复活）。
   */
  async pushQuickNote(id: string): Promise<QuickNotePushResult> {
    this.uploadOps = [];
    this.warnings = [];
    this.warningDetails = [];
    this.supersededNotes.length = 0;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < SINGLE_PUSH_MAX_RETRIES; attempt++) {
      try { return await this.pushQuickNoteOnce(id); }
      catch (e) {
        if (e instanceof PublishRetry) {
          lastErr = e;
          await sleep(80 + Math.floor(Math.random() * (attempt + 1) * 160));
          continue;
        }
        throw e;
      }
    }
    throw new S3v3SyncError("publish-conflict", "单条推送发布冲突重试超限: " + String(lastErr));
  }

  private async pushQuickNoteOnce(id: string): Promise<QuickNotePushResult> {
    const pointer = await this.readPointer();
    if (!pointer) return { status: "full-sync", reason: "no-cloud" };
    const baseline = await this.device.loadBaseline();
    if (!baseline) return { status: "full-sync", reason: "no-baseline" };
    // baseline 与 pointer 不同代 ⇒ 云端已有本机未合并的变更；单条推送不得在旧世界上发布（退回整轮）。
    if (baseline.epoch !== pointer.epoch || baseline.generation !== pointer.generation || baseline.lakeCommit !== pointer.lake.commit) {
      return { status: "full-sync", reason: "cloud-changed" };
    }
    const state = (await this.device.loadState()) ?? emptyState();
    const local = state.quickNotes.items.find((q) => q.id === id);
    if (!local) return { status: "not-found" };
    const restore = new Set(state.restorePending ?? []);
    const remoteIndexBytes = await this.remote.get(indexKey("quickNotes", pointer.quickNotes.commit));
    if (!remoteIndexBytes) throw new S3v3SyncError("index-missing", "小记索引缺失: " + pointer.quickNotes.commit);
    const remoteIndex = parseQuickNotesIndexBytes(remoteIndexBytes).index;
    const remoteEntry = remoteIndex.items.find((q) => q.id === id) ?? null;
    const remoteTombs = remoteIndex.purged ?? [];
    // 墓碑权威：远端已彻底删除且本机无显式恢复标记 → 交给整轮语义处理（不静默复活）。
    if (remoteTombs.includes(id) && !restore.has(id)) return { status: "full-sync", reason: "remote-deleted" };

    const body = await this.device.readQuickBody(id);
    if (!body) throw new S3v3SyncError("quick-body-missing", "本地小记正文缺失: " + id);
    const contentHash = sha256Hex(body);
    const opsBefore = this.uploadOps.length;
    const remoteDecl = remoteEntry?.assetsHash ? await this.getDeclaration("quickNotes", id, remoteEntry.assetsHash) : null;
    const decl = await this.uploadQuickAssets(id, remoteDecl);
    const uploadedAssets = this.uploadOps.length - opsBefore;
    if (decl) {
      this.uploadOps.push({ space: "quickNotes", noteId: id, key: declarationKey("quickNotes", id, decl.declHash), bytes: new TextEncoder().encode(serializeDeclaration(decl.declaration)), gzip: true });
    }
    this.uploadOps.push({ space: "quickNotes", noteId: id, key: quickNoteBodyKey(contentHash), bytes: body });
    const failures = await this.flushUploadOps();
    const failure = failures.get("quickNotes:" + id);
    if (failure) throw new S3v3SyncError("upload-failed", "小记上传失败: " + failure);

    // 只替换本条；tags/purged/其余条目保持远端原样（恢复标记命中时才从 purged 移除）。
    const entry: QuickNoteEntry = {
      ...local,
      contentHash,
      ...(decl ? { assetsHash: decl.declHash } : {}) };
    if (!decl) delete (entry as { assetsHash?: string }).assetsHash;
    const items = [...remoteIndex.items.filter((q) => q.id !== id), entry].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // SD-09：单条推送也是一次发布，同样按保留窗口裁剪（否则这条路径会把旧墓碑重新带回云端）。
    const purged = pruneQuickPurgedIds(remoteTombs.filter((x) => x !== id), state.quickPurgeTimes, this.now());
    const nextIndex: QuickNotesIndex = {
      v: 3, space: "quickNotes", items,
      ...(remoteIndex.tags !== undefined ? { tags: remoteIndex.tags } : {}),
      ...(purged.length ? { purged: [...purged].sort() } : {}) };
    const serialized = serializeQuickNotesIndex(nextIndex);
    const commit = indexHashOf(serialized);
    const uploadedContent = remoteEntry?.contentHash !== contentHash;
    const unchanged = !uploadedContent && uploadedAssets === 0 && commit === pointer.quickNotes.commit && !restore.has(id);
    let generation = pointer.generation;
    if (!unchanged) {
      if (!(await this.acquireLock())) throw new S3v3SyncError("lock-busy", "另一台设备正在发布同步，请稍后重试");
      try {
        const now = await this.readPointer();
        if (!now || now.epoch !== pointer.epoch || now.generation !== pointer.generation ||
          now.lake.commit !== pointer.lake.commit || now.quickNotes.commit !== pointer.quickNotes.commit) throw new PublishRetry();
        await this.writeIndex("quickNotes", commit, serialized);
        generation = pointer.generation + 1;
        const nextPointer: S3v3Pointer = {
          v: 3, epoch: pointer.epoch, generation,
          lake: { commit: pointer.lake.commit }, quickNotes: { commit },
          createdAt: this.iso(), deviceId: this.deviceId };
        await this.assertLockOwned();
        await this.remote.put(S3V3_POINTER_KEY, new TextEncoder().encode(JSON.stringify(nextPointer)));
        const check = await this.readPointer();
        if (!check || check.generation !== generation || check.quickNotes.commit !== commit || check.lake.commit !== pointer.lake.commit) throw new PublishRetry();
      } finally {
        await this.releaseLock();
      }
    }
    // 记账：只标这一条（I2：适配器按内容 hash 未变才标），baseline 跟到新代。
    if (this.device.markQuickNoteSynced) await this.device.markQuickNoteSynced(id, contentHash);
    await this.device.saveBaseline({
      epoch: pointer.epoch, generation,
      lakeCommit: pointer.lake.commit, quickNotesCommit: commit,
      lake: baseline.lake, quickNotes: nextIndex });
    // 单条推送不走整轮 saveState：如果该条此前是「云端已删除·仅本地」副本（remotePurged）
    // 或正处于显式恢复（restorePending），必须把清除后的标记单独落盘；否则 sidecar/DB 残留旧标记，
    // 回收站徽标不消失、下轮还可能把它重新压回「仅本地」。
    const markerPurged = (state.remotePurged ?? []).filter((x) => x !== id);
    const markerRestore = (state.restorePending ?? []).filter((x) => x !== id);
    const markersStale = markerPurged.length !== (state.remotePurged ?? []).length || markerRestore.length !== (state.restorePending ?? []).length;
    if (markersStale && this.device.persistSyncMarkers) {
      try { await this.device.persistSyncMarkers({ remotePurged: markerPurged, restorePending: markerRestore }); }
      catch (e) { this.warn("同步标记落盘失败（下轮整轮同步会清理）: " + (e as Error).message, { kind: "remote_incomplete", noteId: id }); }
    }
    return { status: "pushed", uploadedContent, uploadedAssets, unchanged, generation };
  }

  private async readPointer(): Promise<S3v3Pointer | null> {
    const bytes = await this.remote.get(S3V3_POINTER_KEY);
    if (!bytes) return null;
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new S3v3SyncError("pointer-corrupt", "pointer 不是合法 JSON"); }
    const parsed = validatePointer(raw);
    if (!parsed.ok) throw new S3v3SyncError("pointer-corrupt", parsed.reason);
    return parsed.pointer;
  }

  private async readIndex(space: "lake" | "quickNotes", commit: string): Promise<LakeIndex | QuickNotesIndex> {
    const bytes = await this.remote.get(indexKey(space, commit));
    if (!bytes) throw new S3v3SyncError("index-missing", "索引对象缺失: " + commit);
    const parsed = space === "lake" ? parseLakeIndexBytes(bytes) : parseQuickNotesIndexBytes(bytes);
    if (parsed.commit !== commit) throw new S3v3SyncError("index-hash-mismatch", "索引 hash 与 pointer 不符: " + commit);
    return parsed.index;
  }

  private async writeIndex(space: "lake" | "quickNotes", hash: string, serialized: string): Promise<void> {
    await this.remote.put(indexKey(space, hash), new TextEncoder().encode(serialized), { gzip: true });
  }

  private async getDeclaration(space: "lake" | "quickNotes", id: string, declHash: string): Promise<AssetDeclaration | null> {
    const cacheKey = space + "/" + id + "/" + declHash;
    const cached = DECL_CACHE.get(cacheKey);
    if (cached) {
      // LRU：命中刷新到队尾，避免热点声明被新条目挤掉。
      DECL_CACHE.delete(cacheKey);
      DECL_CACHE.set(cacheKey, cached);
      return cached;
    }
    const bytes = await this.remote.get(declarationKey(space, id, declHash));
    if (!bytes) return null;
    const decl = validateAssetDeclaration(JSON.parse(new TextDecoder().decode(bytes)));
    if (declarationHashOf(decl) !== declHash) throw new S3v3SyncError("declaration-hash-mismatch", "声明 hash 不符: " + id);
    if (DECL_CACHE.size >= DECL_CACHE_LIMIT) DECL_CACHE.delete(DECL_CACHE.keys().next().value as string);
    DECL_CACHE.set(cacheKey, decl);
    return decl;
  }

  /** SD-02：正文缓存的诊断口径（条目/字节 + 引擎生命周期内峰值），供测试与日志使用。 */
  bodyCacheStats(): { entries: number; bytes: number; peakEntries: number; peakBytes: number } {
    return { entries: this.bodyCache.size, bytes: this.bodyCacheBytes, peakEntries: this.bodyCachePeakEntries, peakBytes: this.bodyCachePeakBytes };
  }

  /** 整批/整轮释放：pullAll 每批落库后、sync 每轮 finally 都走这里。 */
  private clearBodyCache(): void {
    this.bodyCache.clear();
    this.bodyCacheBytes = 0;
  }

  private async syncOnce(opts: S3v3SyncOptions): Promise<S3v3SyncReport> {
    const report: S3v3SyncReport = { downloadedNotes: 0, uploadedNotes: 0, deletedObjects: 0, published: false, generation: null, warnings: this.warnings, warningDetails: this.warningDetails, supersededNotes: this.supersededNotes };
    this.report = report;
    const state = (await this.device.loadState()) ?? emptyState();
    // 待补资产账本（261027）：与 state 同一引用；适配器持久化，失败记账、成功销账。
    state.pendingAssets ??= [];
    const baseline = await this.device.loadBaseline();
    const pointer = await this.readPointer();
    // v4 四相内核是唯一实现（旧 v3 增量/首拉/重拉路径已删除）。四条分支覆盖全部入口。
    if (pointer && baseline) {
      // 云端状态分类（原判据不变）：epoch 不一致 / 代际回滚 / 同代不同 commit（分叉）都必须显式失败，
      // 不能带着错基线继续跑（会把两端都"修"成同一份错误数据）。
      if (pointer.epoch !== baseline.epoch) throw new S3v3SyncError("epoch-mismatch", "云端是另一套数据（epoch 不一致）");
      if (pointer.generation < baseline.generation) throw new S3v3SyncError("generation-rollback", "云端回滚到旧备份");
      if (pointer.generation === baseline.generation && (pointer.lake.commit !== baseline.lakeCommit || pointer.quickNotes.commit !== baseline.quickNotesCommit)) {
        throw new S3v3SyncError("fork", "同 generation 不同 commit：分叉/迟到覆盖");
      }
      return await this.syncOnceRound(state, baseline, pointer, report, opts);
    }
    if (!baseline) {
      if (pointer) return await this.syncPullAllRound(pointer, state, report, opts);
      // 首轮并发现身竞态（两个新设备同时首传）：pointer 还没写、对象已在云上 ⇒ 短暂重试再判。
      // 只做**一次**前缀列举判空（旧实现 objects/ + meta/index/ 各列一次 = 空桶也 2~4 次 RTT）。
      for (let i = 0; i < 3; i++) {
        if ((await this.remote.list("")).length === 0) break;
        await sleep(150 + Math.floor(Math.random() * 250));
        const again = await this.readPointer();
        if (again) return await this.syncPullAllRound(again, state, report, opts);
      }
      if ((await this.remote.list("")).length > 0) throw new S3v3SyncError("pointer-corrupt", "pointer 缺失但云端已有对象");
      return await this.syncFirstRound(state, report, opts);
    }
    // 有基线却没有 pointer：被清空或换桶 ⇒ 必须显式失败（走「从云端恢复」）。
    throw new S3v3SyncError("pointer-corrupt", "本机有基线但云端 pointer 缺失（被清空或换桶），请走「从云端恢复」");
  }

  /** 新设备/全量重拉：只拉不推，建立基线。 */
  /**
   * v4 四相内核的一轮（E2-3）：外层只负责读 pointer/索引、写 state/基线、上报；
   * 「决策 + IO」整段交给 runSyncRound（plan → apply → assets → publishIndex → commit → 清理 → 意图）。
   * 首拉/无基线/无 pointer 不在本路径（会抛错，由调用方回退既有路径）。
   */
  private async syncOnceRound(state: DeviceState, baseline: DeviceBaseline | null, pointer: S3v3Pointer | null, report: S3v3SyncReport, opts: S3v3SyncOptions): Promise<S3v3SyncReport> {
    if (!pointer) throw new S3v3SyncError("pointer-corrupt", "四相内核需要云端 pointer（首拉/空桶请走既有路径）");
    let forcePublish = false;
    // 本轮因超窗被裁掉的墓碑 id：远端索引里还留着它们（还没来得及发布）——回填时必须跳过，否则永远裁不掉。
    const prunedThisRound = new Set<string>();
    // 小记墓碑保留窗口（事件驱动：只有存在墓碑时才裁剪）：判不出年龄的保守保留。
    if ((state.quickPurges ?? []).length > 0) {
      const pruned = pruneQuickPurgedIds(state.quickPurges ?? [], state.quickPurgeTimes, this.now());
      if (pruned.length !== (state.quickPurges ?? []).length) {
        const keep = new Set(pruned);
        for (const id of state.quickPurges ?? []) if (!pruned.includes(id)) prunedThisRound.add(id);
        state.quickPurges = pruned;
        forcePublish = true;
        if (state.quickPurgeTimes) for (const id of Object.keys(state.quickPurgeTimes)) if (!keep.has(id)) delete state.quickPurgeTimes[id];
      }
    }
    if (!baseline) throw new S3v3SyncError("no-baseline", "四相内核需要设备基线（首拉/换机请走既有路径）");
    // 他端显式恢复让位（事件驱动，极低频）：本地有 purge 墓碑且「远端同 id 条目的 updatedAt 晚于本地 purgedAt」
    // ⇒ 判定为对端恢复，删除意图放弃（否则本端下一轮会把它再删一次）。只有存在墓碑且远端已变化时才多读一次索引。
    if (state.intents.some((i) => !!i.purgedAt) && (pointer.lake.commit !== baseline.lakeCommit || pointer.quickNotes.commit !== baseline.quickNotesCommit)) {
      try {
        const remoteNow = (await this.readIndex("lake", pointer.lake.commit)) as LakeIndex;
        const byId = new Map(remoteNow.notes.map((n) => [n.id, n] as const));
        state.intents = state.intents.filter((i) => {
          const e = byId.get(i.noteId);
          if (!e || !i.purgedAt) return true;
          return !(e.updatedAt > i.purgedAt);
        });
      } catch { /* 读失败保持原状，下一轮再判 */ }
    }
    // 待补资产重试（事件驱动）：账本只有下载失败时才非空；正常轮这里是空数组、零成本。
    if ((state.pendingAssets ?? []).length > 0) {
      const keep: NonNullable<DeviceState["pendingAssets"]> = [];
      for (const e of state.pendingAssets ?? []) {
        const key = e.space === "lake" ? assetKey(e.id, e.filename) : quickNoteAssetKey(e.id, e.filename);
        try {
          const bytes = await this.remote.get(key);
          if (bytes && sha256Hex(bytes) === e.hash) {
            if (e.space === "lake") await this.device.writeAsset(e.id, e.filename, bytes);
            else await this.device.writeQuickAsset(e.id, e.filename, bytes);
            continue;
          }
        } catch { /* 下一轮再试 */ }
        if (e.attempts + 1 < 3) keep.push({ ...e, attempts: e.attempts + 1 });
      }
      state.pendingAssets = keep;
    }

    // 缺正文自愈（先于决策）：**事件驱动**。队列只在真的观察到缺失时才有内容（打开文档/资源页体检/读失败），
    // 正常增量同步这里是空数组 ⇒ 零扫描、零额外 IO。命中项按云端同 contentHash 拉回并 sha256 校验。
    const missingIds = [...(state.bodyRecoveryPending ?? [])];
    if (missingIds.length > 0) state.bodyRecoveryPending = [];
    if (missingIds.length > 0) {
      const remoteLakeNow = (await this.readIndex("lake", pointer.lake.commit)) as LakeIndex;
      const keepPending: string[] = [];
      for (const id of missingIds) {
        const entry = remoteLakeNow.notes.find((n) => n.id === id);
        if (!entry) { keepPending.push(id); this.warn("缺正文且云端索引已无该条目: " + id, { kind: "local_body_missing", noteId: id }); continue; }
        let healed = false;
        try {
          const bytes = await this.remote.get(lakeBodyKey(id, entry.contentHash));
          if (!bytes || sha256Hex(bytes) !== entry.contentHash) { healed = false; }
          else { await this.device.writeBody(id, bytes); healed = true; this.warn("本地缺正文，已从云端拉回: " + id, { kind: "local_body_restored", noteId: id, title: entry.title }); }
        } catch { /* 自愈失败：保持现状，下一轮再试 */ }
        // 云端也没有 / 校验不过 ⇒ 明确报缺正文（UI 可见），并留在队列里下轮再试（不上传空正文）。
        if (!healed) {
          this.warn("缺正文且云端无可用副本: " + id, { kind: "local_body_missing", noteId: id, ...(entry.title ? { title: entry.title } : {}) });
          keepPending.push(id);
        }
      }
      if (keepPending.length > 0) state.bodyRecoveryPending = keepPending;
    }
    this.phase("round-plan");
    // 并发发布重试（与既有路径 PublishRetry 等价）：内核自己返回 retry，这里做退避重试，
    // 否则 12 端同时发布会把「pointer 被抢先」当成失败。
    let lastRound: Awaited<ReturnType<typeof runSyncRound>> | null = null;
    let lastRemoteLake: LakeIndex | null = null;
    let lastRemoteQuick: QuickNotesIndex | null = null;
    // 锁忙预算：只在真的遇到锁忙/发布冲突时消耗；零变更/正常增量轮一分钱不花。
    const lockBusyDeadline = Date.now() + PUBLISH_LOCK_BUSY_BUDGET_MS;
    for (let attempt = 0; attempt < 3; attempt++) {
      const currentPointer = attempt === 0 ? pointer : await this.readPointer();
      if (!currentPointer) break;
      // 零变更快路径（与旧路径同等下行预算）：pointer 与基线完全一致 ⇒ 远端没变，直接用基线世界，**不读索引**。
      const sameAsBaseline = currentPointer.lake.commit === baseline.lakeCommit && currentPointer.quickNotes.commit === baseline.quickNotesCommit;
      const remoteLake = (sameAsBaseline ? baseline.lake : await this.readIndex("lake", currentPointer.lake.commit)) as LakeIndex;
      const remoteQuick = (sameAsBaseline ? baseline.quickNotes : await this.readIndex("quickNotes", currentPointer.quickNotes.commit)) as QuickNotesIndex;
      // 他端墓碑（不可恢复删除）：本端不留副本（小记不备份语义），只记 purged 墓碑继续传播。
      if ((remoteQuick.purged ?? []).length > 0) {
        const have = new Set(state.quickPurges ?? []);
        const times = { ...(state.quickPurgeTimes ?? {}) };
        let changed = false;
        for (const id of remoteQuick.purged ?? []) {
          if (prunedThisRound.has(id)) continue; // 本轮刚裁掉：不要从远端旧索引回填
          if (!have.has(id)) { have.add(id); changed = true; }
          if (!times[id]) { times[id] = this.iso(); changed = true; }
        }
        if (changed) { state.quickPurges = [...have]; state.quickPurgeTimes = times; forcePublish = true; }
      }
      // 他端显式恢复小记（远端重新出现该 id）⇒ 本地 purged 墓碑/软删标记让位，跟随远端拉回。
      // 只有「远端条目比墓碑更新」才算他端显式恢复（条目早于 purge 时间出现 ⇒ 是旧副本，不是恢复）。
      const purgeTimes = state.quickPurgeTimes ?? {};
      if ((state.quickPurges ?? []).some((id) => remoteQuick.items.some((q) => q.id === id && q.updatedAt > (purgeTimes[id] ?? "9999-12-31")))) {
        const revived = new Set(remoteQuick.items.map((q) => q.id));
        state.quickPurges = (state.quickPurges ?? []).filter((id) => !revived.has(id));
        if (state.quickPurgeTimes) for (const id of [...Object.keys(state.quickPurgeTimes)]) if (revived.has(id)) delete state.quickPurgeTimes[id];
        state.quickDeletes = (state.quickDeletes ?? []).filter((id) => !revived.has(id));
        forcePublish = true;
      }
      lastRemoteLake = remoteLake;
      lastRemoteQuick = remoteQuick;
      lastRound = await this.runRoundOnce(state, baseline, currentPointer, remoteLake, remoteQuick, opts, forcePublish);
      if (lastRound.commit.status === "retry" && lastRound.commit.reason === "lock-busy") this.publishLockBusyRetries += 1;
      if (lastRound.commit.status !== "retry") break;
      // 并发发布：commitPlan 已在 publishLockWaitMs 内退避等锁（只有锁被别人持有时才等）。
      // 外层再给一次有界退避（合计不超过 lockBusyDeadline），真等不到才把 lock-busy 抛给 UI。
      const budgetLeft = lockBusyDeadline - Date.now();
      if (lastRound.commit.reason === "lock-busy" && budgetLeft < 600) break;
      await sleep(lastRound.commit.reason === "lock-busy"
        ? 300 + Math.floor(Math.random() * 500)
        : 120 + Math.floor(Math.random() * (attempt + 1) * 220));
    }
    if (!lastRound) throw new S3v3SyncError("pointer-corrupt", "四相内核重试期间 pointer 丢失");
    // 三次退避仍拿不到锁 ⇒ 明确报 lock-busy（与旧路径同文案；并发同步不应变成静默无结果）。
    if (lastRound.commit.status === "retry") {
      if (lastRound.commit.reason === "lock-busy") throw new S3v3SyncError("lock-busy", "另一台设备正在发布同步，请稍后重试");
      // 其它并发冲突（pointer 被抢先/读回被覆盖）走外层 PublishRetry 重试环（与旧路径同语义）。
      throw new PublishRetry();
    }
    const round = lastRound;
    // 上传失败（PUT 抛错）⇒ 结构化警告 + 保持 local 下轮重试（已由 applyPlan 记入 failedUploads 并回退索引）。
    // 注意：绝不在这里「从云端拉回正文」——那是「本地缺正文」的语义，用错会把用户的本地编辑覆盖掉。
    for (const e of round.apply.errors) {
      if (e.op !== "upload") continue;
      const id = e.detail?.split(":")[1];
      this.warn("上传失败，保持 local 下轮重试: " + (id ?? "") + " " + (e.error instanceof Error ? e.error.message : String(e.error)), { kind: "remote_incomplete", ...(id ? { noteId: id } : {}) });
    }
    // 资产下载失败落账（下一轮开头事件驱动重试；正常轮不产生任何账本）。
    if (round.assets.failedDownloads.length > 0) {
      const ledger = state.pendingAssets ?? (state.pendingAssets = []);
      for (const f of round.assets.failedDownloads) {
        const found = ledger.find((e) => e.space === f.space && e.id === f.id && e.filename === f.filename);
        if (found) found.attempts += 1;
        else ledger.push({ space: f.space, id: f.id, filename: f.filename, size: f.size, hash: f.hash, attempts: 1 });
      }
    }
    this.phase("round-apply");
    // 与既有路径一致：即使本轮没发布，也要把「当前云端代际」报给上层（否则日志/状态栏显示 gen=null）。
    report.generation = round.nextPointer.generation;
    const bodyFailed = new Set(round.apply.entries.filter((e) => e.status !== "applied").map((e) => e.space + ":" + e.id));
    const merged = mergeRoundIntoState(state, round, { bodyFailed });
    // 标记结算要用**本轮发布后的**远端视图：恢复轮自己的发布内容也必须计入（否则恢复成功的副本仍挂着"云端已删除"标）。
    const effectiveLake = round.publish?.lake ?? lastRemoteLake;
    const effectiveQuick = round.publish?.quickNotes ?? lastRemoteQuick;
    let nextState = effectiveLake && effectiveQuick
      ? finalizeRemotePurged(merged, { remoteIds: [...effectiveLake.notes.map((n) => n.id), ...effectiveQuick.items.map((q) => q.id)], restorePending: state.restorePending ?? [] })
      : merged;
    // 本地把「仅本地」副本也彻底删掉（有删除意图、副本已不在索引里）⇒ 标记没有对象可指，一并作废。
    const intentIds = new Set(state.intents.map((i) => i.noteId));
    if ((nextState.remotePurged ?? []).some((id) => intentIds.has(id))) {
      const localIds = new Set([...nextState.lake.notes.map((n) => n.id), ...nextState.quickNotes.items.map((q) => q.id)]);
      nextState = { ...nextState, remotePurged: (nextState.remotePurged ?? []).filter((id) => localIds.has(id)) };
    }
    await this.device.saveState(nextState);
    if (round.commit.status === "published" && round.publish) {
      await this.device.saveBaseline({
        epoch: round.nextPointer.epoch,
        generation: round.nextPointer.generation,
        lakeCommit: round.commit.lakeCommit,
        quickNotesCommit: round.commit.quickNotesCommit,
        lake: round.publish.lake,
        quickNotes: round.publish.quickNotes });
      report.published = true;
      report.generation = round.commit.generation;
      // 旧正文对象清理（与旧引擎同语义）：已发布的新索引不再引用旧 hash ⇒ 删除旧对象；
      // 失败只降级为 warning（发布已成功，清理失败由 deepCleanup 兜底）。
      if (lastRemoteLake && lastRemoteQuick) {
        try {
          const nextLakeById = new Map(round.publish.lake.notes.map((n) => [n.id, n] as const));
          const nextQuickById = new Map(round.publish.quickNotes.items.map((q) => [q.id, q] as const));
          const stale: string[] = [];
          for (const n of lastRemoteLake.notes) {
            const nx = nextLakeById.get(n.id);
            if (!nx || nx.contentHash !== n.contentHash) stale.push(lakeBodyKey(n.id, n.contentHash));
          }
          for (const q of lastRemoteQuick.items) {
            const nx = nextQuickById.get(q.id);
            if (!nx || nx.contentHash !== q.contentHash) stale.push(quickNoteBodyKey(q.contentHash));
          }
          if (stale.length > 0) await this.remote.deleteMany(stale);
        } catch (e) {
          this.warn("旧正文对象清理失败（已发布，下一轮重试）: " + (e instanceof Error ? e.message : String(e)), { kind: "remote_incomplete" });
        }
      }
    }
    // 纯拉取轮也要把基线推进到云端 pointer（否则下一轮拿旧基线判三方冲突/重复发布）。
    if (round.commit.status !== "published" && lastRemoteLake && lastRemoteQuick
      && (round.nextPointer.lake.commit !== baseline.lakeCommit || round.nextPointer.quickNotes.commit !== baseline.quickNotesCommit)) {
      await this.device.saveBaseline({
        epoch: round.nextPointer.epoch,
        generation: round.nextPointer.generation,
        lakeCommit: round.nextPointer.lake.commit,
        quickNotesCommit: round.nextPointer.quickNotes.commit,
        lake: lastRemoteLake,
        quickNotes: lastRemoteQuick });
    }

    // 计数：正文段来自 apply，资产段只影响文件级计数（不混入文档数）。
    report.downloadedDocuments = round.apply.downloaded.documents;
    report.downloadedQuickNotes = round.apply.downloaded.quickNotes;
    report.uploadedDocuments = round.apply.uploaded.documents;
    report.uploadedQuickNotes = round.apply.uploaded.quickNotes;
    report.downloadedBytes = round.apply.downloaded.bytes + round.assets.downloaded.bytes;
    report.uploadedBytes = round.apply.uploaded.bytes + round.assets.uploaded.bytes;
    report.downloadedNotes = round.apply.downloaded.documents + round.apply.downloaded.quickNotes;
    report.uploadedNotes = round.apply.uploaded.documents + round.apply.uploaded.quickNotes;
    report.deletedObjects = round.deleted;
    report.warnings = this.warnings;
    for (const w of round.warnings) {
      const assetKept = w.code === "asset_missing" && (w.detail ?? "").includes("保留云端声明");
      const kind = assetKept ? "asset_kept_remote" : w.code === "hash_mismatch" || w.code === "conflict_kept_history" || w.code === "cleanup_failed" ? "remote_incomplete" : w.code;
      this.warn(w.code + (w.detail ? " " + w.detail : "") + (w.id ? " [" + w.id + "]" : ""), { kind, ...(w.id ? { noteId: w.id } : {}), ...(w.filename ? { filename: w.filename } : {}) });
    }
    // 冲突留档清单：既有路径在 pull 循环里 push，内核用 plan 的 conflict_kept_history 回填（UI 冲突清单/角标依赖）。
    for (const w of round.warnings) {
      if (w.code === "conflict_kept_history" && w.id && !this.supersededNotes.some((n) => n.id === w.id)) {
        this.supersededNotes.push({ id: w.id, title: w.title ?? (w.space === "quickNotes" ? "小记" : w.id) });
      }
    }
    this.phase("round-finalize");
    return report;
  }

  /** v4 全量重拉（换机/坏库）：云端是真相，本地收敛 + 本地独有进回收站（不发布 pointer）。 */
  private async syncPullAllRound(pointer: S3v3Pointer, state: DeviceState, report: S3v3SyncReport, opts: S3v3SyncOptions): Promise<S3v3SyncReport> {
    this.phase("round-pull");
    const ports = createRoundPorts({
      remote: this.remote,
      device: this.device,
      largeAssetChunkBytes: this.largeAssetChunkBytes,
      loadIntentLog: async () => ({ intents: state.intents, restorePending: state.restorePending ?? [] }),
      saveIntentLog: async (log) => { state.intents = log.intents; state.restorePending = log.restorePending; },
      loadPending: async () => state.pending,
      savePending: async (pending) => { state.pending = pending; } });
    const remote = await readRemoteIndexes(pointer, ports);
    const out = await pullRound({
      state: { lake: state.lake, quickNotes: state.quickNotes, folders: state.folders, remotePurged: state.remotePurged ?? [] },
      remote,
      now: () => this.iso(),
      deferAssets: opts.deferAssets === true,
      archiveLocal: true,
      progress: (p: { phase: string; done: number; total: number; bytesDone: number }) => {
        const phase = p.phase === "reads" || p.phase === "asset-get" ? "bodies" : p.phase === "uploads" || p.phase === "asset-put" ? "uploads" : "apply";
        this.emitProgress({ phase, done: p.done, total: p.total, bytesDone: p.bytesDone });
      } }, ports);
    const nextState: DeviceState = {
      ...emptyState(),
      lake: out.state.lake,
      quickNotes: out.state.quickNotes,
      folders: out.state.folders,
      intents: state.intents,
      pending: state.pending,
      remotePurged: out.state.remotePurged,
      restorePending: [],
      pendingAssets: state.pendingAssets ?? [] };
    // 拉取轮失败的资产同样落账（下一轮开头事件驱动重试）。
    if (out.assets.failedDownloads.length > 0) {
      const ledger = nextState.pendingAssets ?? (nextState.pendingAssets = []);
      for (const f of out.assets.failedDownloads) {
        const found = ledger.find((e) => e.space === f.space && e.id === f.id && e.filename === f.filename);
        if (found) found.attempts += 1; else ledger.push({ space: f.space, id: f.id, filename: f.filename, size: f.size, hash: f.hash, attempts: 1 });
      }
    }
    // 全量重拉的「仅本地」标记结算：远端仍有该 id ⇒ 副本跟随（标记失效）；显式恢复 ⇒ 标记失效。
    nextState.remotePurged = finalizeRemotePurged(nextState, {
      remoteIds: [...remote.lake.notes.map((n) => n.id), ...remote.quickNotes.items.map((q) => q.id)],
      restorePending: state.restorePending ?? [] }).remotePurged ?? [];
    await this.device.saveState(nextState);
    await this.device.saveBaseline({
      epoch: pointer.epoch, generation: pointer.generation,
      lakeCommit: pointer.lake.commit, quickNotesCommit: pointer.quickNotes.commit,
      lake: remote.lake, quickNotes: remote.quickNotes });
    report.downloadedDocuments = out.apply.downloaded.documents;
    report.downloadedQuickNotes = out.apply.downloaded.quickNotes;
    report.downloadedBytes = out.apply.downloaded.bytes + out.assets.downloaded.bytes;
    report.downloadedNotes = out.apply.downloaded.documents + out.apply.downloaded.quickNotes;
    report.downloadedFolders = remote.lake.folders.length;
    for (const w of out.warnings) {
      const assetKept = w.code === "asset_missing" && (w.detail ?? "").includes("保留云端声明");
      const kind = assetKept ? "asset_kept_remote" : w.code === "hash_mismatch" || w.code === "cleanup_failed" || w.code === "conflict_kept_history" ? "remote_incomplete" : w.code;
      this.warn(w.code + (w.detail ? " " + w.detail : "") + (w.id ? " [" + w.id + "]" : ""), { kind, ...(w.id ? { noteId: w.id } : {}), ...(w.filename ? { filename: w.filename } : {}) });
    }
    report.warnings = this.warnings;
    this.phase("round-pull-done");
    return report;
  }

  /** v4 首传（空桶/无 pointer）：本地就是真相，全部上传后发布 generation 1。 */
  private async syncFirstRound(state: DeviceState, report: S3v3SyncReport, opts: S3v3SyncOptions): Promise<S3v3SyncReport> {
    const hasLocal = state.lake.notes.length > 0 || state.quickNotes.items.length > 0 || state.folders.length > 0;
    if (!hasLocal) return report;
    if (opts.onEmptyCloud === "stay") return report;
    if (opts.onEmptyCloud !== "upload") throw new S3v3SyncError("empty-cloud", "云端为空，需要选择上传本地或保持为空");
    this.phase("round-initial");
    const ports = createRoundPorts({
      remote: this.remote,
      device: this.device,
      largeAssetChunkBytes: this.largeAssetChunkBytes,
      loadIntentLog: async () => ({ intents: state.intents, restorePending: state.restorePending ?? [] }),
      saveIntentLog: async (log) => { state.intents = log.intents; state.restorePending = log.restorePending; },
      loadPending: async () => state.pending,
      savePending: async (pending) => { state.pending = pending; } });
    const round = await initialRound({
      local: planWorldOf(state), deviceId: this.deviceId, deferAssets: opts.deferAssets === true,
      progress: (p: { phase: string; done: number; total: number; bytesDone: number }) => {
        const phase = p.phase === "reads" || p.phase === "asset-get" ? "bodies" : p.phase === "uploads" || p.phase === "asset-put" ? "uploads" : "apply";
        this.emitProgress({ phase, done: p.done, total: p.total, bytesDone: p.bytesDone });
      } }, ports, { lockWaitMs: this.publishLockWaitMs });
    if (round.commit.status !== "published" || !round.publish) return report;
    const nextState = mergeRoundIntoState(state, { ...round, nextPointer: round.commit.pointer, deleted: 0, remainingPending: state.pending, intents: { intents: state.intents, restorePending: state.restorePending ?? [] } } as never);
    await this.device.saveState(nextState);
    await this.device.saveBaseline({
      epoch: round.commit.pointer.epoch, generation: round.commit.pointer.generation,
      lakeCommit: round.commit.lakeCommit, quickNotesCommit: round.commit.quickNotesCommit,
      lake: round.publish.lake, quickNotes: round.publish.quickNotes });
    report.published = true;
    report.generation = round.commit.generation;
    report.uploadedDocuments = round.apply.uploaded.documents;
    report.uploadedQuickNotes = round.apply.uploaded.quickNotes;
    report.uploadedBytes = round.apply.uploaded.bytes + round.assets.uploaded.bytes;
    report.uploadedNotes = round.apply.uploaded.documents + round.apply.uploaded.quickNotes;
    this.phase("round-initial-done");
    return report;
  }

  /** 单次四相执行（不含重试/回写；供 syncOnceRound 的重试环调用）。 */
  private async runRoundOnce(state: DeviceState, baseline: DeviceBaseline, pointer: S3v3Pointer, remoteLake: LakeIndex, remoteQuick: QuickNotesIndex, opts: S3v3SyncOptions, forcePublish = false): Promise<Awaited<ReturnType<typeof runSyncRound>>> {
    // 发布锁等待交给 commitPlan：只有在别的端持锁时才等（正常轮不产生任何额外往返）。
    const ports = createRoundPorts({
      remote: this.remote,
      device: this.device,
      largeAssetChunkBytes: this.largeAssetChunkBytes,
      loadIntentLog: async () => ({ intents: state.intents, restorePending: state.restorePending ?? [] }),
      saveIntentLog: async (log) => { state.intents = log.intents; state.restorePending = log.restorePending; },
      loadPending: async () => state.pending,
      savePending: async (pending) => { state.pending = pending; } });
    // 字段级变更（is_locked/locked_at/icon/title/parentId/sortOrder）不 bump updatedAt，
    // 内容级合并判据看不见它们 ⇒ 用「本地 vs 基线」的字段 diff 显式喂给 plan。
    const baseById = new Map(baseline.lake.notes.map((n) => [n.id, n] as const));
    const fieldChangedIds = state.lake.notes.filter((n) => {
      const b = baseById.get(n.id);
      if (!b || b.contentHash !== n.contentHash) return false;
      return b.isLocked !== n.isLocked
        || (b.lockedAt ?? "") !== (n.lockedAt ?? "")
        || b.title !== n.title
        || (b.icon ?? "") !== (n.icon ?? "")
        || b.parentId !== n.parentId
        || b.sortOrder !== n.sortOrder;
    }).map((n) => n.id);
    return runSyncRound({
      local: planWorldOf(state),
      base: { lake: baseline.lake, quickNotes: baseline.quickNotes, folders: baseline.lake.folders },
      remote: { lake: remoteLake, quickNotes: remoteQuick, folders: remoteLake.folders },
      basePointer: pointer,
      deviceId: this.deviceId,
      state: { ...planStateOf(state), fieldChangedIds, ...(forcePublish ? { forcePublish: true } : {}) },
      progress: (p: { phase: string; done: number; total: number; bytesDone: number }) => {
        const phase = p.phase === "reads" || p.phase === "asset-get" ? "bodies" : p.phase === "uploads" || p.phase === "asset-put" ? "uploads" : "apply";
        this.emitProgress({ phase, done: p.done, total: p.total, bytesDone: p.bytesDone });
      },
      deferAssets: opts.deferAssets === true,
      commitOptions: { lockWaitMs: this.publishLockWaitMs } }, ports);
  }

  private async lockOwner(): Promise<string | null> {
    const raw = await this.remote.get(LOCK_KEY);
    if (!raw) return null;
    try { return (JSON.parse(new TextDecoder().decode(raw)) as { deviceId: string }).deviceId; } catch { return null; }
  }

  /**
   * 无 CAS provider 的发布锁：写锁 → 静置 LOCK_SETTLE_MS → 读回确认仍是自己。
   * 静置是必要的：两端交错「写 + 立刻读回」时都可能读到自己的写，静置后后写者胜出、先写者会看到别人的锁。
   * 拿不到锁不再立刻抛错，而是在 LOCK_DEADLINE_MS 内带抖动重试（并发同步不应变成用户可见失败）。
   */
  private async acquireLock(): Promise<boolean> {
    const deadline = Date.now() + this.lockWaitMs;
    for (;;) {
      const owner = await this.lockOwner();
      if (owner && owner !== this.deviceId) {
        const raw = await this.remote.get(LOCK_KEY);
        let fresh = false;
        if (raw) { try { const l = JSON.parse(new TextDecoder().decode(raw)) as { time: number; ttl: number }; fresh = Date.now() - l.time < (l.ttl ?? LOCK_TTL_MS); } catch { fresh = false; } }
        if (fresh) {
          if (Date.now() > deadline) return false;
          await sleep(60 + Math.floor(Math.random() * 240));
          continue;
        }
      }
      const lock = { deviceId: this.deviceId, time: Date.now(), ttl: LOCK_TTL_MS };
      await this.remote.put(LOCK_KEY, new TextEncoder().encode(JSON.stringify(lock)));
      await sleep(LOCK_SETTLE_MS);
      if (await this.lockOwner() === this.deviceId) return true;
      if (Date.now() > deadline) return false;
      await sleep(60 + Math.floor(Math.random() * 240));
    }
  }

  /** 发布 pointer 前再确认锁仍属于自己（防止静置后又被别的端抢走）。 */
  private async assertLockOwned(): Promise<void> {
    if (await this.lockOwner() !== this.deviceId) throw new PublishRetry();
  }
  private async releaseLock(): Promise<void> {
    const raw = await this.remote.get(LOCK_KEY);
    if (!raw) return;
    try {
      if ((JSON.parse(new TextDecoder().decode(raw)) as { deviceId: string }).deviceId === this.deviceId) await this.remote.deleteMany([LOCK_KEY]);
    } catch { /* ignore */ }
  }

  /** 原生资产路径（261027）：lake/quickNotes 都走原生流式上传；无能力时返回 null ⇒ 回退字节路径。 */
  private async nativeAssetPathOf(space: "lake" | "quickNotes", id: string, filename: string): Promise<string | null> {
    if (!this.remote.putFromFile) return null;
    try {
      if (this.device.assetNativePathFor) {
        const p = await this.device.assetNativePathFor(space, id, filename);
        if (p) return p;
      }
      if (space === "lake" && this.device.assetNativePath) return await this.device.assetNativePath(id, filename);
    } catch { /* 回退字节路径 */ }
    return null;
  }

  private async uploadAssets(space: "lake" | "quickNotes", id: string, remoteDecl: AssetDeclaration | null): Promise<ReturnType<typeof buildAssetDeclaration> | null> {
    // 261027 Phase1：原生「filename→size/sha256」清单优先 —— 上传声明完全不读字节（旧 APK 自动回退）。
    // 否则每张新增附件都要 readAsset（base64 过桥）+ 纯 JS SHA-256，大附件在真机上是主要上传成本与 OOM 风险。
    const statsFn = space === "lake" ? this.device.listAssetStats : this.device.listQuickAssetStats;
    let stats: Map<string, { size: number; hash: string }> | null = null;
    if (statsFn) {
      try {
        const list = await statsFn.call(this.device, id);
        stats = new Map(list.map((s) => [s.filename, { size: s.size, hash: s.hash }] as const));
      } catch { stats = null; }
    }
    const filenames = stats
      ? [...stats.keys()].sort()
      : (space === "lake" ? await this.device.listAssets(id) : await this.device.listQuickAssets(id));
    if (filenames.length === 0) return null;
    // 附件按 filename 内容寻址（同名 = 同内容）：远端声明已有的文件直接复用 size/hash，
    // 不读本地字节；只有新增/改名的附件才需要 size/hash（优先原生清单，其次 readAsset）。
    const remoteByName = new Map((remoteDecl?.assets ?? []).map((a) => [a.filename, a] as const));
    const entries: AssetDeclaration["assets"] = [];
    for (const filename of filenames) {
      const known = remoteByName.get(filename);
      if (known) { entries.push(known); continue; }
      const stat = stats?.get(filename);
      const nativePath = await this.nativeAssetPathOf(space, id, filename);
      let bytes: Uint8Array | null = null;
      if (!nativePath || !stat) {
        bytes = space === "lake" ? await this.device.readAsset(id, filename) : await this.device.readQuickAsset(id, filename);
        if (!bytes) continue;
      }
      const size = stat && stat.size >= 0 ? stat.size : bytes!.length;
      const hash = stat && stat.hash ? stat.hash : sha256Hex(bytes!);
      entries.push({ filename, size, hash });
      const key = space === "lake" ? assetKey(id, filename) : quickNoteAssetKey(id, filename);
      if (nativePath) this.uploadOps.push({ space, noteId: id, key, fromFile: nativePath, size });
      else this.uploadOps.push({ space, noteId: id, key, bytes: bytes!, size });
    }
    return buildAssetDeclaration(entries);
  }

  /** 把本轮积累的全部写操作按全局并发 8 执行；返回失败分组（space:noteId → 错误）。 */
  private async flushUploadOps(): Promise<Map<string, string>> {
    const ops = this.uploadOps;
    this.uploadOps = [];
    // 261027：上传也报进度（文件粒度；大附件单文件时 UI 至少能看到「上传中」而不是静止）。
    const total = ops.length;
    const bytesTotal = ops.reduce((sum, op) => sum + (op.size ?? op.bytes?.length ?? 0), 0);
    let done = 0;
    let bytesDone = 0;
    if (total > 0) this.emitProgress({ phase: "uploads", done: 0, total, bytesDone: 0, bytesTotal });
    const { errors } = await runPoolSettled(ops, this.transferConcurrency, async (op) => {
      try {
        // P0-4：有原生流式上传能力时只传 key + 本地相对路径（字节不过 JS 桥）；否则回退字节路径。
        if (op.fromFile && this.remote.putFromFile) {
          try {
            if (await this.remote.putFromFile(op.key, op.fromFile, op.gzip ? { gzip: true } : undefined)) return;
          } catch { /* 回退字节路径 */ }
        }
        if (!op.bytes) throw new Error("上传任务缺少字节/原生文件路径: " + op.key);
        await this.remote.put(op.key, op.bytes, op.gzip ? { gzip: true } : undefined);
      } finally {
        done += 1;
        bytesDone += op.size ?? op.bytes?.length ?? 0;
        this.emitProgress({ phase: "uploads", done, total, bytesDone, bytesTotal });
      }
    });
    this.addUploadedBytes(bytesDone);
    const failed = new Map<string, string>();
    for (const err of errors) {
      const op = ops[err.index];
      failed.set(op.space + ":" + op.noteId, (err.error as Error).message);
    }
    return failed;
  }

  private async uploadQuickAssets(id: string, remoteDecl: AssetDeclaration | null) {
    return this.uploadAssets("quickNotes", id, remoteDecl);
  }

  /**
   * 深度清理（手动/周期）：列举对象并用「当前指针+索引+声明」算 keep 集，删除不可达对象。
   * 用于崩溃/半途失败留下的孤儿（如「声明已写、pointer 未切」）。不进入日常同步。
   *
   * 护栏（对齐旧协议 s3Maintenance 的 keep 集 / 窗口口径，补齐 v3 parity F3/F4）：
   * 1) `extraKeep`：本机历史快照引用的资产（桌面 `store.getProtectedRefs`）必须保留——
   *    否则清理会删掉历史面板仍在引用的图片/附件；
   * 2) 上一版索引：每空间额外保留「未被当前 pointer 引用、lastModified 最新」的 1 个 index，
   *    给「他端还在读旧索引」留出容错（索引是内容寻址对象，保留不会污染当前世界）；
   * 3) 保留窗口：默认 7 天（可传 retentionDays；<=0 表示立即到期=手动显式清理）；
   *    窗口内对象一律不删；provider 不返回 lastModified（无法判龄）时保守保留；
   * 4) dryRun：只返回候选，不删对象、不动本地 pending。
   */
  async deepCleanup(opts: S3v3DeepCleanupOptions = {}): Promise<S3v3DeepCleanupResult> {
    const pointer = await this.readPointer();
    if (!pointer) throw new S3v3SyncError("pointer-corrupt", "云端没有 pointer，无法深度清理");
    const lake = (await this.readIndex("lake", pointer.lake.commit)) as LakeIndex;
    const quick = (await this.readIndex("quickNotes", pointer.quickNotes.commit)) as QuickNotesIndex;
    const keep = new Set<string>();
    keep.add(S3V3_POINTER_KEY);
    keep.add(LOCK_KEY);
    keep.add(indexKey("lake", pointer.lake.commit));
    keep.add(indexKey("quickNotes", pointer.quickNotes.commit));
    // 声明并发取（261026）：深度清理要遍历全库声明，逐条串行在大库上很慢；keep 集写入是同步的，安全。
    const cleanupDeclTasks: Array<{ space: "lake" | "quickNotes"; id: string; declHash: string }> = [];
    for (const n of lake.notes) {
      keep.add(lakeBodyKey(n.id, n.contentHash));
      if (!n.assetsHash) continue;
      keep.add(declarationKey("lake", n.id, n.assetsHash));
      cleanupDeclTasks.push({ space: "lake", id: n.id, declHash: n.assetsHash });
    }
    for (const q of quick.items) {
      keep.add(quickNoteBodyKey(q.contentHash));
      if (!q.assetsHash) continue;
      keep.add(declarationKey("quickNotes", q.id, q.assetsHash));
      cleanupDeclTasks.push({ space: "quickNotes", id: q.id, declHash: q.assetsHash });
    }
    if (cleanupDeclTasks.length > 0) {
      await runTransferPipeline(cleanupDeclTasks, Math.min(8, this.transferConcurrency), async (t) => {
        const d = await this.getDeclaration(t.space, t.id, t.declHash);
        for (const a of d?.assets ?? []) keep.add(t.space === "lake" ? assetKey(t.id, a.filename) : quickNoteAssetKey(t.id, a.filename));
        return 0;
      });
    }
    // 本机历史快照引用（平台注入；调用方负责只读收集，引擎不碰设备 API）。
    for (const k of opts.extraKeep ?? []) keep.add(k);

    const prefixes = ["objects/", "assets/", "meta/index/", "meta/assets/", "quick-notes/objects/", "quick-notes/assets/", "quick-notes/meta/"];
    const all = new Map<string, { key: string; lastModified?: number }>();
    for (const prefix of prefixes) for (const item of await this.remote.list(prefix)) all.set(item.key, item);

    // 上一版索引保护：每空间保留最近一个未引用的 index（当前 pointer 的索引已在 keep 里）。
    const previousIndexes: string[] = [];
    const indexPrefixes: Array<["lake" | "quickNotes", string]> = [["lake", "meta/index/"], ["quickNotes", "quick-notes/meta/index/"]];
    for (const [space, prefix] of indexPrefixes) {
      const commit = space === "lake" ? pointer.lake.commit : pointer.quickNotes.commit;
      let best: { key: string; lastModified: number } | null = null;
      for (const item of all.values()) {
        if (!item.key.startsWith(prefix) || item.key === indexKey(space, commit)) continue;
        const at = item.lastModified ?? 0;
        if (!best || at > best.lastModified) best = { key: item.key, lastModified: at };
      }
      if (best) { keep.add(best.key); previousIndexes.push(best.key); }
    }

    const nowMs = (opts.now ?? this.now)().getTime();
    const retentionDays = opts.retentionDays ?? 7;
    const cutoff = retentionDays > 0 ? nowMs - retentionDays * 86_400_000 : Number.POSITIVE_INFINITY;
    const toDelete: string[] = [];
    let skippedRecent = 0;
    let ageUnknown = 0;
    for (const item of all.values()) {
      if (keep.has(item.key)) continue;
      if (item.lastModified === undefined) { ageUnknown += 1; continue; } // 判不出年龄 ⇒ 保守保留
      if (item.lastModified > cutoff) { skippedRecent += 1; continue; }   // 窗口内 ⇒ 保留
      toDelete.push(item.key);
    }
    toDelete.sort();
    if (!opts.dryRun && toDelete.length > 0) {
      const CHUNK = 1000;
      for (let i = 0; i < toDelete.length; i += CHUNK) await this.remote.deleteMany(toDelete.slice(i, i + CHUNK));
      const deletedSet = new Set(toDelete);
      const state = await this.device.loadState();
      if (state) {
        // 只摘掉「本轮真的删掉了目标」的待删项；前缀删除/未命中项保持原样等门禁重判。
        state.pending = state.pending.filter((p) => !deletedSet.has(p.key));
        await this.device.saveState(state);
      }
    }
    return { deleted: toDelete, kept: keep.size, dryRun: !!opts.dryRun, skippedRecent, ageUnknown, previousIndexes };
  }

  /** 全量重拉（epoch/回滚/换桶后由 UI 调用）：云端赢，本地多出的归档（v4 四相）。 */
  async resetFromCloud(): Promise<S3v3SyncReport> {
    const pointer = await this.readPointer();
    if (!pointer) throw new S3v3SyncError("pointer-corrupt", "云端没有 pointer，无法全量重拉");
    const state = (await this.device.loadState()) ?? emptyState();
    const report: S3v3SyncReport = { downloadedNotes: 0, uploadedNotes: 0, deletedObjects: 0, published: false, generation: null, warnings: this.warnings, warningDetails: this.warningDetails, supersededNotes: this.supersededNotes };
    this.report = report;
    return this.syncPullAllRound(pointer, { ...state, pending: [] }, report, {});
  }
}
