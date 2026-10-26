import { sha256Hex } from "./syncUtils.js";
import {
  S3V3_POINTER_KEY,
  assetKey,
  declarationKey,
  indexKey,
  lakeBodyKey,
  quickNoteAssetKey,
  quickNoteBodyKey,
} from "./s3v3Keys.js";
import {
  buildAssetDeclaration,
  declarationHashOf,
  indexHashOf,
  parseLakeIndexBytes,
  parseQuickNotesIndexBytes,
  serializeDeclaration,
  serializeLakeIndex,
  serializeQuickNotesIndex,
  validateAssetDeclaration,
  type AssetDeclaration,
  type LakeIndex,
  type QuickNoteEntry,
  type QuickNotesIndex,
} from "./s3v3Index.js";
import { classifyCloudState } from "./s3v3Pointer.js";
import type { S3v3Pointer } from "./s3v3Types.js";
import { validatePointer } from "./s3v3Types.js";
import { planLakeMerge, planQuickNotesMerge } from "./s3v3Merge.js";
import { planLakeDeletes, planQuickNotesDeletes, type PlannedDelete } from "./s3v3Gc.js";
import { gatePendingDelete, type CurrentWorld, type PendingDelete } from "./s3v3Gate.js";
import { shouldClearDeletionIntent, type DeletionIntent } from "./s3v3Intent.js";
import { TRASH_NOTEBOOK_ID } from "./syncDecisions.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";
import type { SyncWarning } from "../lib/types.js";
import type { S3v3Remote } from "./s3v3Ports.js";
import { runPoolSettled } from "./s3v3Pool.js";
import { runTransferPipeline } from "./s3v3Transfer.js";
import { mergeQuickNoteTags, type QuickNoteTag } from "./quickNoteTags.js";

const DEFAULT_TRANSFER_CONCURRENCY = 12; // 上传并发（用户批准：8 → 12）
/** 下载流水线并发（正文/声明/资产统一调度；用户批准 16–24，实测七牛/真机带宽在此区间打满）。 */
const DEFAULT_DOWNLOAD_CONCURRENCY = 20;

const LOCK_KEY = "meta/lock.json";
const LOCK_TTL_MS = 120_000;
/** 锁重试：无 CAS 的 provider 下，靠「写后静置再读回」降低双持窗口。 */
const LOCK_DEADLINE_MS = 15_000;
const LOCK_SETTLE_MS = 40; // 单用户场景下减少固定发布延迟；多端冲突仍由锁重试/归属复核兜底
/** 回收站父节点 id 与 Store/移动端一致（曾误写 "trash"，会把回收站条目挂到不存在的父节点）。 */
const TRASH_ID = TRASH_NOTEBOOK_ID;
const MAX_PUBLISH_RETRIES = 6;
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
  deletedObjects: number;
  published: boolean;
  generation: number | null;
  /** 兼容旧调用方/日志的一行式消息（与 warningDetails 一一对应子集）。 */
  warnings: string[];
  /** 结构化警告（UI 展示/点击定位；SyncWarningKind 见 src/lib/types.ts）。 */
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
  /** 阶段耗时回调（诊断慢同步/卡顿）：phase + 距上一阶段毫秒数。 */
  onPhase?: (phase: string, ms: number) => void;
  /** 结构化进度回调（阶段 + 计数 + 字节；桥接层负责节流，引擎不节流）。 */
  onProgress?: (progress: S3v3Progress) => void;
  /** 上传并发（261025 用户批准从 8 提到 12；实测首同步约 1.5x）。 */
  transferConcurrency?: number;
  /** 下载流水线并发（正文/声明/资产共用；默认 20，clamp 1..32）。 */
  downloadConcurrency?: number;
}

function tagEntryToTag(e: { id: string; name: string; sortOrder?: number; order?: number; pinned?: boolean; createdAt: string; updatedAt: string; deletedAt?: string | null }): QuickNoteTag {
  return { id: e.id, name: e.name, sortOrder: e.sortOrder ?? e.order ?? 0, pinned: !!e.pinned, createdAt: e.createdAt, updatedAt: e.updatedAt, deletedAt: e.deletedAt ?? null };
}
function tagToEntry(t: QuickNoteTag) {
  return { id: t.id, name: t.name, sortOrder: t.sortOrder, pinned: t.pinned, createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.deletedAt ? { deletedAt: t.deletedAt } : {}) };
}
function sortTagEntries<T extends { id: string }>(tags: readonly T[]): T[] {
  return [...tags].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const emptyState = (): DeviceState => ({
  lake: { v: 3, space: "lake", notes: [], folders: [] },
  quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
  folders: [],
  intents: [],
  pending: [],
  remotePurged: [],
  restorePending: [],
});

/** 单轮同步的工作集：本地状态与「待发布索引」由同一 API 维护，避免 B14 式漏同步。 */
class WorkingSet<T extends { id: string }> {
  private readonly local = new Map<string, T>();
  private readonly index = new Map<string, T>();
  constructor(entries: Iterable<T>) {
    for (const entry of entries) { this.local.set(entry.id, entry); this.index.set(entry.id, entry); }
  }
  get(id: string): T | undefined { return this.local.get(id); }
  localValues(): T[] { return [...this.local.values()]; }
  indexValues(): T[] { return [...this.index.values()]; }
  /** 下载应用/上传成功/新建：本地与索引同时更新。 */
  set(id: string, entry: T): void { this.local.set(id, entry); this.index.set(id, entry); }
  delete(id: string): void { this.local.delete(id); this.index.delete(id); }
  /** 上传失败：仅索引回退到远端/移出；本地保留重试意图。 */
  failUpload(id: string, remote: T | null): void { if (remote) this.index.set(id, remote); else this.index.delete(id); }
}

export class S3v3SyncEngine {
  private readonly remote: S3v3Remote;
  private readonly device: S3v3DeviceStore;
  private readonly deviceId: string;
  private readonly now: () => Date;
  private readonly lockWaitMs: number;
  private readonly onPhase?: (phase: string, ms: number) => void;
  private readonly onProgress?: (progress: S3v3Progress) => void;
  private readonly transferConcurrency: number;
  private readonly downloadConcurrency: number;
  private phaseStart = 0;
  private uploadOps: Array<{ space: "lake" | "quickNotes"; noteId: string; key: string; bytes?: Uint8Array; fromFile?: string; gzip?: boolean }> = [];
  private readonly bodyCache = new Map<string, Uint8Array>();
  private warnings: string[] = [];
  private warningDetails: SyncWarning[] = [];
  private supersededNotes: Array<{ id: string; title: string }> = [];

  constructor(opts: S3v3EngineOptions) {
    this.remote = opts.remote;
    this.device = opts.device;
    this.deviceId = opts.deviceId;
    this.now = opts.now ?? (() => new Date());
    this.lockWaitMs = opts.lockWaitMs ?? LOCK_DEADLINE_MS;
    this.onPhase = opts.onPhase;
    this.onProgress = opts.onProgress;
    this.transferConcurrency = Math.max(1, Math.min(32, opts.transferConcurrency ?? DEFAULT_TRANSFER_CONCURRENCY));
    this.downloadConcurrency = Math.max(1, Math.min(32, opts.downloadConcurrency ?? DEFAULT_DOWNLOAD_CONCURRENCY));
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

  /**
   * 资产下载任务队列（P0-1）：不再按篇 runPool（有效并发 ≈ 每篇池 + 逐篇 barrier），
   * 而是全部登记后由 flushAssetTasks 用**全局有界流水线**统一跑。
   */
  private assetTasks: Array<{ space: "lake" | "quickNotes"; noteId: string; filename: string; key: string; size: number; hash: string }> = [];

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
        throw e;
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
      ...(decl ? { assetsHash: decl.declHash } : {}),
    };
    if (!decl) delete (entry as { assetsHash?: string }).assetsHash;
    const items = [...remoteIndex.items.filter((q) => q.id !== id), entry].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const purged = remoteTombs.filter((x) => x !== id);
    const nextIndex: QuickNotesIndex = {
      v: 3, space: "quickNotes", items,
      ...(remoteIndex.tags !== undefined ? { tags: remoteIndex.tags } : {}),
      ...(purged.length ? { purged: [...purged].sort() } : {}),
    };
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
          createdAt: this.iso(), deviceId: this.deviceId,
        };
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
      lake: baseline.lake, quickNotes: nextIndex,
    });
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

  private async getBody(space: "lake", noteId: string, hash: string): Promise<Uint8Array | null> {
    const cacheKey = space + "/" + noteId + "/" + hash;
    if (this.bodyCache.has(cacheKey)) return this.bodyCache.get(cacheKey)!;
    const key = lakeBodyKey(noteId, hash);
    const bytes = await this.remote.get(key);
    if (!bytes) return null;
    if (sha256Hex(bytes) !== hash) throw new S3v3SyncError("body-hash-mismatch", "正文 hash 不符: " + noteId);
    this.bodyCache.set(cacheKey, bytes);
    return bytes;
  }

  private async getQuickBody(hash: string): Promise<Uint8Array | null> {
    const bytes = await this.remote.get(quickNoteBodyKey(hash));
    if (!bytes) return null;
    if (sha256Hex(bytes) !== hash) throw new S3v3SyncError("quick-body-hash-mismatch", "小记正文 hash 不符: " + hash);
    return bytes;
  }

  private async syncOnce(opts: S3v3SyncOptions): Promise<S3v3SyncReport> {
    const report: S3v3SyncReport = { downloadedNotes: 0, uploadedNotes: 0, deletedObjects: 0, published: false, generation: null, warnings: this.warnings, warningDetails: this.warningDetails, supersededNotes: this.supersededNotes };
    const state = (await this.device.loadState()) ?? emptyState();
    const baseline = await this.device.loadBaseline();
    const pointer = await this.readPointer();
    const cloudHasObjects = pointer ? true : (await this.remote.list("objects/")).length > 0 || (await this.remote.list("meta/index/")).length > 0;
    const cloudState = classifyCloudState({ pointer, baseline, cloudHasObjects });
    this.phase("load-state");

    if (!baseline) {
      if (pointer) return await this.pullAll(pointer, state, report, true, opts.deferAssets === true);
      if (cloudHasObjects) throw new S3v3SyncError("pointer-corrupt", "pointer 缺失但云端已有对象");
      const hasLocal = state.lake.notes.length > 0 || state.quickNotes.items.length > 0;
      if (!hasLocal) return report;
      if (opts.onEmptyCloud === "upload") return await this.initialUpload(state, report);
      if (opts.onEmptyCloud === "stay") return report;
      throw new S3v3SyncError("empty-cloud", "云端为空，需要选择上传本地或保持为空");
    }

    if (cloudState === "empty-cloud") {
      const hasLocal = state.lake.notes.length > 0 || state.quickNotes.items.length > 0;
      if (!hasLocal) return report;
      if (opts.onEmptyCloud === "upload") return await this.initialUpload(state, report);
      if (opts.onEmptyCloud === "stay") return report;
      throw new S3v3SyncError("empty-cloud", "云端为空，需要选择上传本地或保持为空");
    }
    if (cloudState === "pointer-corrupt") throw new S3v3SyncError("pointer-corrupt", "pointer 缺失但云端已有对象");
    if (cloudState === "epoch-mismatch") throw new S3v3SyncError("epoch-mismatch", "云端是另一套数据（epoch 不一致）");
    if (cloudState === "generation-rollback") throw new S3v3SyncError("generation-rollback", "云端回滚到旧备份");
    if (cloudState === "fork") throw new S3v3SyncError("fork", "同 generation 不同 commit：分叉/迟到覆盖");
    if (!pointer) throw new S3v3SyncError("pointer-corrupt", "基线存在但 pointer 缺失");

    return await this.incrementalSync(pointer, baseline, state, report);
  }

  /** 新设备/全量重拉：只拉不推，建立基线。 */
  private async pullAll(pointer: S3v3Pointer, state: DeviceState, report: S3v3SyncReport, archiveLocal: boolean, deferAssets = false): Promise<S3v3SyncReport> {
    // 两份索引互不依赖：并行取，省一个 RTT（首拉时索引可能是几 MB/条 gzip 对象）。
    const [lake, quick] = await Promise.all([
      this.readIndex("lake", pointer.lake.commit) as Promise<LakeIndex>,
      this.readIndex("quickNotes", pointer.quickNotes.commit) as Promise<QuickNotesIndex>,
    ]);
    this.phase("read-index");
    this.emitProgress({ phase: "metadata", done: 1, total: 1 });
    if (archiveLocal) {
      // 断点续传（261026）：本地状态里的 contentHash 与云端一致的条目**不是被覆盖**，
      // 不用读正文、更不用写历史（否则一次「首拉中途退出再进入」要把几百 MB 正文过一遍桥/读盘）。
      // 只有 hash 不一致（会被远端覆盖/已从远端消失）的条目才读正文留档。
      const remoteById = new Map(lake.notes.map((n) => [n.id, n] as const));
      for (const n of state.lake.notes) {
        const remote = remoteById.get(n.id);
        if (remote && remote.contentHash === n.contentHash) continue;
        const bytes = await this.readLocalBody("lake", n.id);
        if (!bytes) continue;
        await this.device.archiveBody(n.id, bytes);
      }
      const remoteQuickById = new Map(quick.items.map((q) => [q.id, q] as const));
      for (const q of state.quickNotes.items) {
        const remote = remoteQuickById.get(q.id);
        if (remote && remote.contentHash === q.contentHash) continue;
        const bytes = await this.readLocalBody("quickNotes", q.id);
        if (!bytes) continue;
        await this.device.writeHistory("quick-" + q.id, bytes);
      }
    }
    const newState: DeviceState = {
      ...emptyState(),
      lake,
      quickNotes: quick,
      folders: lake.folders,
      intents: state.intents,
      pending: state.pending,
      remotePurged: [],
      restorePending: [],
    };
    // 全量重拉 = 元数据对账 + 本地内容复用（S3-REDESIGN §15）：本地正文/附件已持同内容就不重下字节。
    const hadLake = new Set(state.lake.notes.map((n) => n.id));
    const hadQuick = new Set(state.quickNotes.items.map((q) => q.id));
    // 快速复用（261026）：状态里的 contentHash 与远端一致 + 文件 stat 存在 ⇒ 直接算复用，**不读正文**。
    // 依据：device.loadState 的 contentHash 来自 DB content_hash（每次保存/导入都会更新），代表本地正文 hash；
    // 外部手工改文件不在支持范围内（改了会因 hash 失配在后续读取/保存路径暴露）。文件被删（stat=false）时回退下载。
    // 没有 stat 端口（桌面）或 stat 缺失时回退「批量读 + 逐条 sha256」，保证不会把坏文件当复用。
    const stateLakeById = new Map(state.lake.notes.map((n) => [n.id, n] as const));
    const stateQuickById = new Map(state.quickNotes.items.map((q) => [q.id, q] as const));
    const hashMatchedLake = lake.notes.filter((n) => hadLake.has(n.id) && stateLakeById.get(n.id)?.contentHash === n.contentHash).map((n) => n.id);
    const hashMatchedQuick = quick.items.filter((q) => hadQuick.has(q.id) && stateQuickById.get(q.id)?.contentHash === q.contentHash).map((q) => q.id);
    const fastLake = await this.statLocalBodies("lake", hashMatchedLake);
    const fastQuick = await this.statLocalBodies("quickNotes", hashMatchedQuick);
    const reusableLakeIds = new Set<string>();
    for (const id of hashMatchedLake) {
      const st = fastLake?.get(id);
      if (st && st.exists && st.size > 0) reusableLakeIds.add(id);
    }
    const reusableQuickIds = new Set<string>();
    for (const id of hashMatchedQuick) {
      const st = fastQuick?.get(id);
      if (st && st.exists && st.size > 0) reusableQuickIds.add(id);
    }
    const fallbackLakeIds = [...hadLake].filter((id) => !reusableLakeIds.has(id));
    const reusableLakeBodies = await this.readLocalBodies("lake", fallbackLakeIds);
    const lakeNeed: LakeIndex["notes"] = [];
    for (const n of lake.notes) {
      if (reusableLakeIds.has(n.id)) continue;
      const local = reusableLakeBodies.get(n.id);
      const reusable = hadLake.has(n.id) && !!local && sha256Hex(local) === n.contentHash;
      if (!reusable) lakeNeed.push(n);
    }
    const fallbackQuickIds = [...hadQuick].filter((id) => !reusableQuickIds.has(id));
    const reusableQuickBodies = await this.readLocalBodies("quickNotes", fallbackQuickIds);
    const quickNeed: QuickNotesIndex["items"] = [];
    for (const q of quick.items) {
      if (reusableQuickIds.has(q.id)) continue;
      const local = reusableQuickBodies.get(q.id);
      const reusableQuick = hadQuick.has(q.id) && !!local && sha256Hex(local) === q.contentHash;
      if (!reusableQuick) quickNeed.push(q);
    }
    // 首拉 P0-2：**正文先下、分块应用**（文档先出来）——每 CHUNK 篇落一次库，已下正文的文档/目录
    // 立刻可打开阅读；资产与后续批次的正文继续在后台流水线里跑。内存峰值也被 CHUNK 限住。
    const BODY_CHUNK = 100;
    const totalBodies = lakeNeed.length + quickNeed.length;
    let applied = 0;
    const downloadBodies = async (items: Array<LakeIndex["notes"][number] | QuickNotesIndex["items"][number]>, space: "lake" | "quickNotes", apply: boolean) => {
      await runTransferPipeline(items, this.downloadConcurrency, async (item) => {
        const bytes = space === "lake"
          ? await this.getBody("lake", (item as LakeIndex["notes"][number]).id, item.contentHash)
          : await this.getQuickBody(item.contentHash);
        if (!bytes) {
          this.warn((space === "lake" ? "缺正文: " : "缺小记正文: ") + item.id, { kind: "remote_incomplete", noteId: item.id, title: (item as { title?: string }).title });
          return 0;
        }
        if (space === "lake") await this.device.writeBody(item.id, bytes);
        else await this.device.writeQuickBody(item.id, bytes);
        report.downloadedNotes++;
        return bytes.length;
      }, {
        phase: "bodies",
        totalOverride: totalBodies,
        offsetDone: applied,
        onProgress: (p) => this.emitProgress(p),
      });
      applied += items.length;
      if (apply) {
        await this.device.saveState(newState); // 分块应用：正文已就绪的条目立即落库（可打开）
        this.emitProgress({ phase: "apply", done: applied, total: totalBodies });
      }
    };
    for (let i = 0; i < lakeNeed.length; i += BODY_CHUNK) await downloadBodies(lakeNeed.slice(i, i + BODY_CHUNK), "lake", true);
    if (lakeNeed.length === 0) await this.device.saveState(newState); // 没有 lake 需要下载也要先把目录/行落下
    // 小记：正文先下、但**等小记图片声明/资源就绪后再落库**（importRemoteQuickNote 会校验图片完整性）。
    if (quickNeed.length > 0) await downloadBodies(quickNeed, "quickNotes", false);
    this.phase("apply");
    // 按需资产（P0-4）：首拉只拉 pointer/索引/正文/声明元数据，媒体字节延后到打开/预览时
    // 由 assetBackfill 补拉（声明与索引仍完整，删除/清理语义不受影响）。
    if (!deferAssets && quick.items.some((q) => q.assetsHash)) {
      await runTransferPipeline(
        quick.items.filter((q) => q.assetsHash).map((q) => ({ space: "quickNotes" as const, id: q.id, declHash: q.assetsHash! })),
        this.downloadConcurrency,
        async (t) => { await this.getDeclaration(t.space, t.id, t.declHash); return 0; },
        { phase: "declarations", onProgress: (p) => this.emitProgress(p) });
      for (const q of quick.items) await this.scheduleAssets("quickNotes", q.id, q.assetsHash);
      await this.flushAssetTasks();
    }
    await this.device.saveState(newState);
    await this.device.saveBaseline({ epoch: pointer.epoch, generation: pointer.generation, lakeCommit: pointer.lake.commit, quickNotesCommit: pointer.quickNotes.commit, lake, quickNotes: quick });
    this.phase("save");
    // Lake 资产：先并发取「声明」（小对象），再按全局流水线只补本地缺失/损坏的字节。
    // deferAssets=true（按需资产）：以上全部跳过，首拉不搬媒体字节。
    if (!deferAssets) {
      const lakeDecls = lake.notes.filter((n) => n.assetsHash);
      // P0：这里把声明取回的同时按 id 留一份，下面 scheduleAssets 直接复用——
      // 否则 2k 篇会再串行 GET 一遍声明（声明 LRU 有上限，必然大部分 miss）。
      const fetchedDecls = new Map<string, AssetDeclaration | null>();
      await runTransferPipeline(
        lakeDecls.map((n) => ({ space: "lake" as const, id: n.id, declHash: n.assetsHash! })),
        this.downloadConcurrency,
        async (t) => { const d = await this.getDeclaration(t.space, t.id, t.declHash); fetchedDecls.set(t.space + "/" + t.id, d); return 0; },
        { phase: "declarations", onProgress: (p) => this.emitProgress(p) });
      for (const n of lake.notes) await this.scheduleAssets("lake", n.id, n.assetsHash, fetchedDecls.get("lake/" + n.id));
      await this.flushAssetTasks();
    }
    this.phase("downloads");
    await this.device.saveState(newState);
    this.emitProgress({ phase: "finalize", done: 1, total: 1 });
    return { ...report, generation: pointer.generation };
  }

  /** 云端为空 + 用户选择上传本地：初始化 epoch。 */
  private async initialUpload(state: DeviceState, report: S3v3SyncReport): Promise<S3v3SyncReport> {
    const pointer = await this.readPointer();
    if (pointer) throw new S3v3SyncError("cloud-changed", "初始化时云端已有数据");
    const { lake, quickNotes } = await this.buildAndUploadAll(state, report);
    this.phase("upload");
    if (!(await this.acquireLock())) throw new S3v3SyncError("lock-busy", "另一台设备正在发布同步");
    try {
      const again = await this.readPointer();
      if (again) throw new PublishRetry();
      const epoch = globalThis.crypto.randomUUID();
      const lakeSerialized = serializeLakeIndex(lake);
      const quickSerialized = serializeQuickNotesIndex(quickNotes);
      const lakeCommit = indexHashOf(lakeSerialized);
      const quickCommit = indexHashOf(quickSerialized);
      await this.writeIndex("lake", lakeCommit, lakeSerialized);
      await this.writeIndex("quickNotes", quickCommit, quickSerialized);
      const p: S3v3Pointer = { v: 3, epoch, generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: this.iso(), deviceId: this.deviceId };
      await this.assertLockOwned();
      await this.remote.put(S3V3_POINTER_KEY, new TextEncoder().encode(JSON.stringify(p)));
      const check = await this.readPointer();
      if (!check || check.generation !== 1 || check.lake.commit !== lakeCommit) throw new PublishRetry();
      this.phase("publish");
      const newState = { ...state, lake, quickNotes, folders: lake.folders };
      await this.device.saveState(newState);
      await this.device.saveBaseline({ epoch, generation: 1, lakeCommit, quickNotesCommit: quickCommit, lake, quickNotes });
      return { ...report, published: true, generation: 1 };
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * 「云端已彻底删除·仅本地」标记（state.remotePurged）的本轮视图：
   * 标记语义 = 「该 id 在远端索引里已不存在，本地保留的副本仅作回收站用途」。
   * 因此只要前提不成立，标记就必须失效——
   *   · restorePending（本地显式恢复，唯一提前例外）：标记清除，恢复走正常上传；
   *   · 远端重新出现同 id 条目（他端恢复/重建）：标记清除，本地陈旧副本作废（revived），跟随远端下载，
   *     否则会被状态保留的旧副本盖回索引，等于把别人的恢复又删掉。
   * 其余情况保持标记：本地副本不参与合并 → 不上传、不复活（用户定稿 261026）。
   */
  private resolveRemotePurged(
    state: DeviceState,
    remoteLake: LakeIndex,
    remoteQuick: QuickNotesIndex,
    restore: ReadonlySet<string>,
  ): { purged: Set<string>; revived: Set<string> } {
    const purged = new Set(state.remotePurged ?? []);
    const revived = new Set<string>();
    for (const id of restore) purged.delete(id);
    const remoteIds = new Set<string>();
    for (const n of remoteLake.notes) remoteIds.add(n.id);
    for (const q of remoteQuick.items) remoteIds.add(q.id);
    for (const id of [...purged]) {
      if (!remoteIds.has(id)) continue;
      purged.delete(id);
      revived.add(id);
    }
    // 本地已把「仅本地」副本也彻底删除（有删除意图、副本已不在状态里）→ 标记无对象可指，一并作废，
    // 避免 sidecar 无限累积。小记侧有墓碑证据时不作废：quick 回收站副本可能本就不在 items 里
    //（适配器按契约保留时），标记是它「云端已删除」的依据。
    const localIds = new Set<string>([...state.lake.notes.map((n) => n.id), ...state.quickNotes.items.map((q) => q.id)]);
    const quickSideEvidence = new Set<string>([...(state.quickPurges ?? []), ...(state.quickDeletes ?? [])]);
    for (const id of [...purged]) {
      if (localIds.has(id) || quickSideEvidence.has(id)) continue;
      if (state.intents.some((it) => it.noteId === id)) purged.delete(id);
    }
    return { purged, revived };
  }

  private async incrementalSync(pointer: S3v3Pointer, baseline: DeviceBaseline, state: DeviceState, report: S3v3SyncReport): Promise<S3v3SyncReport> {
    const remoteLake = pointer.lake.commit === baseline.lakeCommit ? baseline.lake : ((await this.readIndex("lake", pointer.lake.commit)) as LakeIndex);
    const remoteQuick = pointer.quickNotes.commit === baseline.quickNotesCommit ? baseline.quickNotes : ((await this.readIndex("quickNotes", pointer.quickNotes.commit)) as QuickNotesIndex);
    this.phase("read-index");
    this.emitProgress({ phase: "metadata", done: 1, total: 1 });
    const baselineLake = baseline.lake;
    const baselineQuick = baseline.quickNotes;

    const restore = new Set(state.restorePending ?? []);
    // 「恢复是唯一显式例外」：远端条目 updatedAt 晚于本地 purgedAt → 视为他端显式恢复，删除意图让位。
    const yieldedIntents = new Set<string>();
    for (const it of state.intents) {
      const remote = remoteLake.notes.find((n) => n.id === it.noteId);
      if (remote && it.purgedAt && remote.updatedAt > it.purgedAt) yieldedIntents.add(it.noteId);
    }
    const intentIds = new Set(state.intents.filter((i) => !yieldedIntents.has(i.noteId)).map((i) => i.noteId));
    // 目录删除意图让位（D4 的配套）：远端同 id 目录重新出现且更新时间不早于本机 purge 时间
    // ⇒ 他端已显式恢复。否则「A purge 目录 → B 恢复 → A 下一轮又把它删掉」（删除意图永不让位）。
    const yieldedFolderIntents = new Set<string>();
    for (const it of state.intents) {
      const rf = remoteLake.folders.find((x) => x.id === it.noteId);
      if (rf && (!it.purgedAt || rf.updatedAt > it.purgedAt)) yieldedFolderIntents.add(it.noteId);
    }
    const folderIntentIds = new Set([...intentIds].filter((id) => !yieldedFolderIntents.has(id)));
    // 「云端已彻底删除·仅本地」标记的本轮视图（见 resolveRemotePurged）：
    // · 显式恢复 → 标记失效，恢复走正常上传（用户定稿：远端删除不限制恢复）；
    // · 远端同 id 条目回来了（他端恢复）→ 标记不再成立，本轮跟随远端下载（revived 的陈旧本地副本不得再进索引）。
    const { purged, revived } = this.resolveRemotePurged(state, remoteLake, remoteQuick, restore);
    // 他端恢复小记：远端索引重新出现该 id，而本地仍有 purged 墓碑 ⇒ 删除意图让位（用户定稿 261026：
    // 别的端恢复后就是正常小记，删除方也跟随恢复）。不需要时间戳比较：v3 里 active 条目出现即
    // 表示它被显式恢复/重建；本地 purged 副本必须作废，跟随远端内容下载。
    // 只有「远端恢复时间晚于本地 purge 时间」才算他端恢复；否则会把本端尚未发布的 purge 直接让位掉。
    const quickRestoredIds = new Set(
      (state.quickPurges ?? []).filter((id) => {
        const purgedAt = state.quickPurgeTimes?.[id];
        const remote = remoteQuick.items.find((q) => q.id === id);
        return !!purgedAt && !!remote && remote.updatedAt > purgedAt;
      }),
    );
    for (const id of quickRestoredIds) purged.delete(id);
    const lakeLocal: LakeIndex = { v: 3, space: "lake", notes: state.lake.notes.filter((n) => !purged.has(n.id) && !revived.has(n.id)), folders: state.folders };
    // 乐观合法父集合（C5）：回收站 + 本地/远端/基线的目录与文档 id。
    // 用途：① 环检测（C4）只在远端父可解释时成立；② 给适配器一个"远端父是否本机可解析"的参考口径
    // （真正落库兜底在适配器：非法 parent 回落兜底笔记本，不得直接写库）。
    const validParents = new Set<string>([TRASH_ID]);
    for (const f of remoteLake.folders) validParents.add(f.id);
    for (const f of state.folders) validParents.add(f.id);
    for (const f of baselineLake.folders) validParents.add(f.id);
    for (const n of remoteLake.notes) validParents.add(n.id);
    for (const n of state.lake.notes) validParents.add(n.id);
    const lakePlan = planLakeMerge(baselineLake, lakeLocal, remoteLake, { restorePending: restore, purgeIntents: intentIds, folderPurgeIntents: folderIntentIds, validParents });
    // 显式恢复/他端恢复优先：恢复的 id 从 quick 墓碑集合剔除，否则本端会再次发布 purge、把恢复弹回回收站。
    const mergedQuickPurges = [...new Set([...(state.quickPurges ?? []), ...(remoteQuick.purged ?? [])])]
      .filter((id) => !restore.has(id) && !quickRestoredIds.has(id)).sort();
    const purgedQuickIds = new Set(mergedQuickPurges);
    const quickPurgeTimes = Object.fromEntries(Object.entries(state.quickPurgeTimes ?? {}).filter(([id]) => purgedQuickIds.has(id)));
    // 小记同理：标记内的条目（若适配器按契约保留了回收站只读副本）不参与三方合并 → 不上传、不复活。
    const quickLocal: QuickNotesIndex = {
      ...state.quickNotes,
      items: state.quickNotes.items.filter((q) => !purged.has(q.id) && !revived.has(q.id) && !quickRestoredIds.has(q.id)),
    };
    const quickPlan = planQuickNotesMerge(baselineQuick, quickLocal, remoteQuick, restore, intentIds, new Set(state.quickDeletes ?? []), purgedQuickIds);
    // 标签目录单独做 id LWW（含墓碑）；条目标签关系仍走 quickPlan。
    const mergedQuickTags = mergeQuickNoteTags(
      (state.quickNotes.tags ?? []).map(tagEntryToTag),
      (remoteQuick.tags ?? []).map(tagEntryToTag),
    ).map(tagToEntry);
    const tagsChanged = JSON.stringify(sortTagEntries(mergedQuickTags)) !== JSON.stringify(sortTagEntries(state.quickNotes.tags ?? []));
    this.phase("merge");

    const lakeWS = new WorkingSet(state.lake.notes);
    const quickWS = new WorkingSet(state.quickNotes.items);
    const newLakeDecls = new Map<string, { declHash: string; filenames: string[] }>();
    const prevDecls = new Map<string, { declHash: string; filenames: string[] }>();
    const newQuickDecls = new Map<string, { declHash: string; filenames: string[] }>();
    const prevQuickDecls = new Map<string, { declHash: string; filenames: string[] }>();

    // ---- P0-1 全局有界流水线：先把本轮要应用的正文/声明并发取回（进缓存），再逐条应用 ----
    // 旧实现逐篇 await 正文 GET（2k 篇 = 2k 个串行 RTT）；资产又是按篇 runPool（per-note barrier）。
    const bodyTasks: Array<{ space: "lake" | "quickNotes"; id: string; hash: string; title?: string }> = [];
    for (const plan of lakePlan.notes) {
      if (!plan.applyRemote || !plan.remote) continue;
      const localEntry = lakeWS.get(plan.id);
      const needBody = !localEntry || localEntry.contentHash !== plan.remote.contentHash || plan.kind === "download" || plan.kind === "remote-wins-history";
      if (needBody) bodyTasks.push({ space: "lake", id: plan.remote.id, hash: plan.remote.contentHash, title: plan.remote.title });
    }
    for (const plan of quickPlan.items) {
      if (!plan.applyRemote || !plan.remote) continue;
      const localEntry = quickWS.get(plan.id);
      const needBody = !localEntry || localEntry.contentHash !== plan.remote.contentHash || plan.kind === "download" || plan.kind === "remote-wins-history";
      if (needBody) bodyTasks.push({ space: "quickNotes", id: plan.remote.id, hash: plan.remote.contentHash });
    }
    if (bodyTasks.length > 0) {
      this.phase("bodies");
      await runTransferPipeline(bodyTasks, this.downloadConcurrency, async (t) => {
        const bytes = t.space === "lake" ? await this.getBody("lake", t.id, t.hash) : await this.getQuickBody(t.hash);
        if (!bytes) {
          this.warn((t.space === "lake" ? "缺正文: " : "缺小记正文: ") + t.id, { kind: "remote_incomplete", noteId: t.id, title: t.title });
          return 0;
        }
        return bytes.length;
      }, { phase: "bodies", totalOverride: bodyTasks.length, onProgress: (p) => this.emitProgress(p) });
    }
    // 声明：上传/应用都可能需要（内容寻址、按 declHash 缓存），先并发取回，避免应用环里串行 GET。
    const declTasks: Array<{ space: "lake" | "quickNotes"; id: string; declHash: string }> = [];
    const seenDecl = new Set<string>();
    for (const plan of lakePlan.notes) {
      const dh = plan.remote?.assetsHash;
      // 上传分支（本地元数据变更）也要用声明：本地附件未落地时按远端声明自愈，
      // 不在上传环里串行 GET（2k 篇 = 2k 个 RTT，真机上几分钟的静默卡顿）。
      const need = plan.applyRemote || plan.uploadLocal;
      if (dh && need && !seenDecl.has("lake:" + plan.id + ":" + dh)) {
        seenDecl.add("lake:" + plan.id + ":" + dh);
        declTasks.push({ space: "lake", id: plan.id, declHash: dh });
      }
    }
    for (const plan of quickPlan.items) {
      const dh = plan.remote?.assetsHash;
      const need = plan.applyRemote || plan.uploadLocal;
      if (dh && need && !seenDecl.has("quickNotes:" + plan.id + ":" + dh)) {
        seenDecl.add("quickNotes:" + plan.id + ":" + dh);
        declTasks.push({ space: "quickNotes", id: plan.id, declHash: dh });
      }
    }
    if (declTasks.length > 0) {
      this.phase("declarations");
      await runTransferPipeline(declTasks, this.downloadConcurrency, async (t) => {
        await this.getDeclaration(t.space, t.id, t.declHash);
        return 0;
      }, { phase: "declarations", totalOverride: declTasks.length, onProgress: (p) => this.emitProgress(p) });
    }

    // ---- 拉取/应用远端 ----
    for (const plan of lakePlan.notes) {
      const remote = plan.remote;
      if (plan.kind === "remote-purged-trash") {
        const local = lakeWS.get(plan.id);
        if (local) {
          if (plan.archiveLocal) await this.device.archiveBody(plan.id, await this.device.readBody(plan.id));
          local.trashedAt = this.iso();
          local.deletedFromParentId = local.parentId;
          local.parentId = TRASH_ID;
          purged.add(plan.id);
        }
        continue;
      }
      if (!remote || !plan.applyRemote) continue;
      if (plan.kind === "remote-wins-history") this.supersededNotes.push({ id: plan.id, title: remote.title });
      const local = lakeWS.get(plan.id);
      if (plan.applyRemote && remote) {
        if (plan.archiveLocal && local) await this.device.archiveBody(plan.id, await this.device.readBody(plan.id));
        const needBody = !local || local.contentHash !== remote.contentHash || plan.kind === "download" || plan.kind === "remote-wins-history";
        if (needBody) {
          const bytes = await this.getBody("lake", remote.id, remote.contentHash);
          if (!bytes) {
            // 本地正文也缺失 ⇒ 两边都没有内容：绝不能把条目发布成"有正文"。
            const localBody = await this.readLocalBody("lake", remote.id);
            if (!localBody) this.warn("本地与云端都缺正文，跳过: " + remote.id, { kind: "local_body_missing", noteId: remote.id, title: remote.title });
            else this.warn("远端缺正文，跳过: " + remote.id, { kind: "remote_incomplete", noteId: remote.id, title: remote.title });
            // 正文对象暂时缺失不得把条目从云端索引删掉（否则一次半失败就成了永久删除）：
            // 保留远端条目（索引 = 远端），下轮对象恢复后自然对齐。
            lakeWS.set(remote.id, { ...remote });
            continue;
          }
          if (!local && baseline.lake.notes.some((n) => n.id === remote.id)) {
            // 基线里有、本地行/正文却没了（如 .lake 被手动删除）⇒ 已从云端拉回。
            this.warn("本地缺正文，已从云端拉回: " + remote.id, { kind: "local_body_restored", noteId: remote.id, title: remote.title });
          }
          await this.device.writeBody(remote.id, bytes);
          report.downloadedNotes++;
        }
        const oldDecl = local?.assetsHash;
        if (oldDecl && oldDecl !== remote.assetsHash) {
          const d = await this.getDeclaration("lake", remote.id, oldDecl);
          if (d) prevDecls.set(remote.id, { declHash: oldDecl, filenames: d.assets.map((a) => a.filename) });
        }
        const decl = await this.scheduleAssets("lake", remote.id, remote.assetsHash);
        if (decl) newLakeDecls.set(remote.id, { declHash: remote.assetsHash!, filenames: decl.assets.map((a) => a.filename) });
        lakeWS.set(remote.id, { ...remote });
      }
    }
    for (const plan of lakePlan.notes) {
      if (plan.kind === "local-purge") {
        lakeWS.delete(plan.id);
        // 本地彻底删除：标记随之作废（副本已不存在，「仅本地」不再有意义），避免标记无限累积。
        purged.delete(plan.id);
        await this.device.deleteBody(plan.id);
        await this.device.deleteAssetsDir(plan.id);
      }
    }
    for (const f of lakePlan.folders) {
      if (f.kind === "download" && f.remote) {
        const idx = state.folders.findIndex((x) => x.id === f.id);
        if (idx >= 0) state.folders[idx] = { ...f.remote };
        else state.folders.push({ ...f.remote });
      } else if (f.kind === "remote-purged-trash") {
        state.folders = state.folders.filter((x) => x.id !== f.id);
      } else if (f.kind === "local-purge") {
        state.folders = state.folders.filter((x) => x.id !== f.id);
      }
    }

    // 小记拉取/删除
    for (const plan of quickPlan.items) {
      const remote = plan.remote;
      const local = quickWS.get(plan.id);
      if (plan.kind === "local-delete") {
        // 删除语义交给设备端：桌面小记要进回收站（保留正文/附件），不能在这里物理删。
        quickWS.delete(plan.id);
        continue;
      }
      if (plan.kind === "local-purge") { quickWS.delete(plan.id); purged.delete(plan.id); continue; }
      if (!remote || !plan.applyRemote) continue;
      if (plan.kind === "remote-wins-history") this.supersededNotes.push({ id: plan.id, title: "小记" });
      if (plan.archiveLocal && local) {
        // 冲突副本（parity C8）：优先由设备端把本地版本归档进小记回收站（旧协议语义）；
        // 设备未实现时退化为历史快照尝试（桌面 createHistorySnapshot 对小记无实际归档）。
        if (this.device.archiveQuickNote) {
          try { await this.device.archiveQuickNote(plan.id); }
          catch (e) { this.warn("小记冲突归档失败（远端继续覆盖）: " + plan.id + " " + (e as Error).message, { kind: "remote_incomplete", noteId: plan.id }); }
        } else {
          const bytes = await this.device.readQuickBody(plan.id);
          if (bytes) await this.device.writeHistory("quick-" + plan.id, bytes);
        }
      }
      const needBody = !local || local.contentHash !== remote.contentHash || plan.kind === "download" || plan.kind === "remote-wins-history";
      if (needBody) {
        const bytes = await this.getQuickBody(remote.contentHash);
        if (!bytes) {
          this.warn("远端缺小记正文，跳过: " + remote.id, { kind: "remote_incomplete", noteId: remote.id });
          quickWS.set(remote.id, { ...remote });
          continue;
        }
        await this.device.writeQuickBody(remote.id, bytes);
        report.downloadedNotes++;
      }
      const oldDecl = local?.assetsHash;
      if (oldDecl && oldDecl !== remote.assetsHash) {
        const d = await this.getDeclaration("quickNotes", remote.id, oldDecl);
        if (d) prevQuickDecls.set(remote.id, { declHash: oldDecl, filenames: d.assets.map((a) => a.filename) });
      }
      const decl = await this.scheduleAssets("quickNotes", remote.id, remote.assetsHash);
      if (decl) newQuickDecls.set(remote.id, { declHash: remote.assetsHash!, filenames: decl.assets.map((a) => a.filename) });
      quickWS.set(remote.id, { ...remote });
    }

    // 资产：全局流水线（与上面的正文/声明同一调度器；失败只影响该对象）。
    await this.flushAssetTasks();
    this.emitProgress({ phase: "apply", done: lakePlan.notes.length + quickPlan.items.length, total: lakePlan.notes.length + quickPlan.items.length });

    // ---- 上传 ----
    for (const plan of lakePlan.notes) {
      if (!plan.uploadLocal) continue;
      const entry = lakeWS.get(plan.id);
      if (!entry) continue;
      try {
        const body = await this.device.readBody(plan.id);
        if (!body) {
          // P0：上传前本地正文缺失 → 先按远端同条目 contentHash 尝试拉回（校验一致才落盘）。
          const restored = await this.restoreMissingBody("lake", plan.id, plan.remote?.contentHash ?? entry.contentHash);
          if (restored) {
            this.warn("本地缺正文，已从云端拉回: " + plan.id, { kind: "local_body_restored", noteId: plan.id, title: entry.title });
            entry.contentHash = sha256Hex(restored);
            // 云端已有同内容正文：本轮无需上传（索引仍以合并结果为准）。
            continue;
          }
          // 云端也没有可拉回的副本：跳过 + 绝不把空正文上传/声明进新索引。
          this.warn("本地缺正文，跳过上传: " + plan.id, { kind: "local_body_missing", noteId: plan.id, title: entry.title });
          lakeWS.failUpload(plan.id, plan.remote ? { ...plan.remote } : null);
          newLakeDecls.delete(plan.id);
          prevDecls.delete(plan.id);
          continue;
        }
        const hash = sha256Hex(body);
        entry.contentHash = hash;
        const remoteDecl = plan.remote?.assetsHash ? await this.getDeclaration("lake", plan.id, plan.remote.assetsHash) : null;
        // 数据安全（261026 真机事故）：本地附件目录为空 ≠ 用户删光了附件。
        // 首拉未完成/附件还没落地/外部清缓存时目录同样是空的；此时若按 uploadAssets 的结果把
        // entry.assetsHash 置空，新索引会「声明该条目没有附件」，随后 planLakeDeletes 会把这台的
        // 全部云端附件判成孤儿执行物理删除（真机上一次性删掉 2 万对象）。没有本地证据就不改声明。
        const localAssetsEmpty = (await this.device.listAssets(plan.id)).length === 0;
        if (localAssetsEmpty && plan.remote?.assetsHash) {
          entry.assetsHash = plan.remote.assetsHash;
          this.warn("本地附件未落地，保留云端声明不删附件: " + plan.id, { kind: "asset_kept_remote", noteId: plan.id, title: entry.title });
          // 顺手自愈：把缺失的附件按远端声明补下来（本次循环后在下方统一 flush）。
          const decl = await this.scheduleAssets("lake", plan.id, plan.remote.assetsHash);
          if (decl) newLakeDecls.set(plan.id, { declHash: plan.remote.assetsHash, filenames: decl.assets.map((a) => a.filename) });
        } else {
          const decl = await this.uploadAssets("lake", plan.id, remoteDecl);
          if (decl) {
          this.uploadOps.push({ space: "lake", noteId: plan.id, key: declarationKey("lake", plan.id, decl.declHash), bytes: new TextEncoder().encode(serializeDeclaration(decl.declaration)), gzip: true });
          entry.assetsHash = decl.declHash;
          newLakeDecls.set(plan.id, { declHash: decl.declHash, filenames: decl.declaration.assets.map((a) => a.filename) });
            if (plan.remote?.assetsHash && plan.remote.assetsHash !== decl.declHash) {
              const old = await this.getDeclaration("lake", plan.id, plan.remote.assetsHash);
              if (old) prevDecls.set(plan.id, { declHash: plan.remote.assetsHash, filenames: old.assets.map((a) => a.filename) });
            }
          } else if (plan.remote?.assetsHash) {
            // 本地有文件但读不出字节（IO 异常等）：同样不能丢声明，保留远端版本。
            entry.assetsHash = plan.remote.assetsHash;
            this.warn("附件读取失败，保留云端声明: " + plan.id, { kind: "asset_kept_remote", noteId: plan.id, title: entry.title });
          } else {
            entry.assetsHash = undefined;
            if (plan.remote?.assetsHash) {
              const old = await this.getDeclaration("lake", plan.id, plan.remote.assetsHash);
              if (old) prevDecls.set(plan.id, { declHash: plan.remote.assetsHash, filenames: old.assets.map((a) => a.filename) });
            }
          }
        }
        // 仅在正文内容真的变化时 PUT（锁/图标等元数据变更不必重传正文）。
        if (plan.remote?.contentHash !== hash) {
          this.uploadOps.push({ space: "lake", noteId: plan.id, key: lakeBodyKey(plan.id, hash), bytes: body });
          report.uploadedNotes++;
        }
      } catch (e) {
        this.warnings.push("上传失败，保持 local 下轮重试: " + plan.id + " " + (e as Error).message);
        // 关键：失败笔记不得进入本轮新索引（否则索引引用未落盘正文/声明），回退到远端旧条目或移出。
        lakeWS.failUpload(plan.id, plan.remote ? { ...plan.remote } : null);
        newLakeDecls.delete(plan.id);
        prevDecls.delete(plan.id);
      }
    }
    // 上传分支里登记的自愈资产任务（本地附件未落地但远端有声明）在这里统一下载，失败只影响该对象。
    await this.flushAssetTasks();
    for (const plan of quickPlan.items) {
      if (!plan.uploadLocal) continue;
      const entry = quickWS.get(plan.id);
      if (!entry) continue;
      try {
        const body = await this.device.readQuickBody(plan.id);
        if (!body) {
          const restored = await this.restoreMissingBody("quickNotes", plan.id, plan.remote?.contentHash ?? entry.contentHash);
          if (restored) {
            this.warn("本地缺小记正文，已从云端拉回: " + plan.id, { kind: "local_body_restored", noteId: plan.id });
            entry.contentHash = sha256Hex(restored);
            continue;
          }
          this.warn("本地缺小记正文，跳过上传: " + plan.id, { kind: "local_body_missing", noteId: plan.id });
          quickWS.failUpload(plan.id, plan.remote ? { ...plan.remote } : null);
          newQuickDecls.delete(plan.id);
          prevQuickDecls.delete(plan.id);
          continue;
        }
        entry.contentHash = sha256Hex(body);
        const remoteDecl = plan.remote?.assetsHash ? await this.getDeclaration("quickNotes", plan.id, plan.remote.assetsHash) : null;
        // 与 Lake 同一条数据安全规则：本地图片目录为空不能当成「用户删光了图片」。
        const localQuickAssetsEmpty = (await this.device.listQuickAssets(plan.id)).length === 0;
        if (localQuickAssetsEmpty && plan.remote?.assetsHash) {
          entry.assetsHash = plan.remote.assetsHash;
          this.warn("本地小记图片未落地，保留云端声明: " + plan.id, { kind: "asset_kept_remote", noteId: plan.id });
          const decl = await this.scheduleAssets("quickNotes", plan.id, plan.remote.assetsHash);
          if (decl) newQuickDecls.set(plan.id, { declHash: plan.remote.assetsHash, filenames: decl.assets.map((a) => a.filename) });
        } else {
        const decl = await this.uploadQuickAssets(plan.id, remoteDecl);
        if (decl) {
          this.uploadOps.push({ space: "quickNotes", noteId: plan.id, key: declarationKey("quickNotes", plan.id, decl.declHash), bytes: new TextEncoder().encode(serializeDeclaration(decl.declaration)), gzip: true });
          entry.assetsHash = decl.declHash;
          newQuickDecls.set(plan.id, { declHash: decl.declHash, filenames: decl.declaration.assets.map((a) => a.filename) });
          if (plan.remote?.assetsHash && plan.remote.assetsHash !== decl.declHash) {
            const old = await this.getDeclaration("quickNotes", plan.id, plan.remote.assetsHash);
            if (old) prevQuickDecls.set(plan.id, { declHash: plan.remote.assetsHash, filenames: old.assets.map((a) => a.filename) });
          }
        } else if (plan.remote?.assetsHash) {
          entry.assetsHash = plan.remote.assetsHash;
          this.warn("小记图片读取失败，保留云端声明: " + plan.id, { kind: "asset_kept_remote", noteId: plan.id });
        } else {
          entry.assetsHash = undefined;
        }
        }
        if (plan.remote?.contentHash !== entry.contentHash) {
          this.uploadOps.push({ space: "quickNotes", noteId: plan.id, key: quickNoteBodyKey(entry.contentHash), bytes: body });
          report.uploadedNotes++;
        }
      } catch (e) {
        this.warnings.push("小记上传失败，保持 local 下轮重试: " + plan.id + " " + (e as Error).message);
        quickWS.failUpload(plan.id, plan.remote ? { ...plan.remote } : null);
        newQuickDecls.delete(plan.id);
        prevQuickDecls.delete(plan.id);
      }
    }

    // 小记上传分支的自愈任务同样在这里下载。
    await this.flushAssetTasks();
    this.phase("downloads");
    // 全局传输（≤8）：all-or-isolate，失败笔记不进本轮索引。
    const uploadFailures = await this.flushUploadOps();
    this.phase("uploads");
    for (const [key, msg] of uploadFailures) {
      const [space, id] = key.split(":");
      this.warnings.push((space === "lake" ? "上传失败，保持 local 下轮重试: " : "小记上传失败，保持 local 下轮重试: ") + id + " " + msg);
      if (space === "lake") {
        const plan = lakePlan.notes.find((p) => p.id === id);
        lakeWS.failUpload(id, plan?.remote ? { ...plan.remote } : null);
        newLakeDecls.delete(id);
        prevDecls.delete(id);
      } else {
        const plan = quickPlan.items.find((p) => p.id === id);
        quickWS.failUpload(id, plan?.remote ? { ...plan.remote } : null);
        newQuickDecls.delete(id);
        prevQuickDecls.delete(id);
      }
    }

    const lakeChanged = lakePlan.notes.some((p) => p.kind !== "none" || p.uploadLocal || p.applyRemote) || lakePlan.folders.some((f) => f.kind !== "none" || f.applyRemote);
    // 小记标签关系（tagIds/tagsUpdatedAt）独立于正文 hash：关系版本较新的一侧胜出。
    const remoteQuickById = new Map(remoteQuick.items.map((q) => [q.id, q] as const));
    let quickLinksChanged = false;
    for (const [id, localEntry] of new Map(quickWS.indexValues().map((q) => [q.id, q] as const))) {
      const remoteEntry = remoteQuickById.get(id);
      if (!remoteEntry) continue;
      const lt = localEntry.tagsUpdatedAt ?? "";
      const rt = remoteEntry.tagsUpdatedAt ?? "";
      if (rt > lt) {
        localEntry.tagIds = remoteEntry.tagIds ? [...remoteEntry.tagIds] : undefined;
        localEntry.tagsUpdatedAt = remoteEntry.tagsUpdatedAt;
        quickLinksChanged = true;
      } else if ((localEntry.tagIds ?? []).join("\u0000") !== (remoteEntry.tagIds ?? []).join("\u0000") || lt !== rt) {
        quickLinksChanged = true;
      }
    }
    const purgesChanged = JSON.stringify(mergedQuickPurges) !== JSON.stringify([...(remoteQuick.purged ?? [])].sort());
    const quickChanged = tagsChanged || quickLinksChanged || purgesChanged || quickPlan.items.some((p) => p.kind !== "none" || p.uploadLocal || p.applyRemote);
    // 本地状态保留「远端已彻底删除、本机回收站副本」（remotePurged），但不进同步索引。
    const stateNotes = lakeChanged ? lakeWS.localValues().sort((a, b) => (a.id < b.id ? -1 : 1)) : state.lake.notes;
    const stateFolders = [...state.folders].sort((a, b) => (a.id < b.id ? -1 : 1));
    const newLake: LakeIndex = lakeChanged ? { v: 3, space: "lake", notes: lakeWS.indexValues().filter((n) => !purged.has(n.id)).sort((a, b) => (a.id < b.id ? -1 : 1)), folders: stateFolders } : remoteLake;
    // 小记：发布索引同样剔除「云端已删除」的副本；本地状态保留它们（适配器据此留 quick 回收站只读副本）。
    const quickKeptCopies = state.quickNotes.items.filter((q) => purged.has(q.id) && !revived.has(q.id));
    const newQuick: QuickNotesIndex = quickChanged ? { v: 3, space: "quickNotes", items: quickWS.indexValues().filter((q) => !purged.has(q.id)).sort((a, b) => (a.id < b.id ? -1 : 1)), tags: mergedQuickTags, ...(mergedQuickPurges.length ? { purged: mergedQuickPurges } : {}) } : remoteQuick;
    const quickState: QuickNotesIndex = quickKeptCopies.length === 0 ? newQuick : (() => {
      const byId = new Map(newQuick.items.map((q) => [q.id, q] as const));
      for (const q of quickKeptCopies) if (!byId.has(q.id)) byId.set(q.id, q);
      return { ...newQuick, items: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) };
    })();
    // 标记持久化：本轮视图（恢复/远端复活/本地 purge 已相应剔除）原样落盘，下一轮才能继续挡住复活。
    const remotePurged = [...purged].sort();
    // 无变化的半边不做全量序列化/哈希（大库空跑时这是主要 CPU）
    const lakeSerialized = lakeChanged ? serializeLakeIndex(newLake) : "";
    const quickSerialized = quickChanged ? serializeQuickNotesIndex(newQuick) : "";
    const lakeCommit = lakeChanged ? indexHashOf(lakeSerialized) : pointer.lake.commit;
    const quickCommit = quickChanged ? indexHashOf(quickSerialized) : pointer.quickNotes.commit;
    const needPublish = lakeCommit !== pointer.lake.commit || quickCommit !== pointer.quickNotes.commit;


    if (!needPublish) {
      // 注意（勿删这里的 saveState）：无发布轮也必须落盘 state —— resolveRemotePurged 本轮可能已经把
      // 「显式恢复 / 远端复活 / 本地 purge」的 id 从 state.remotePurged 剔除，restorePending 也可能已清；
      // 不落盘就会让 sidecar/DB 残留旧标记（下次加载又当「云端已删除·仅本地」，回收站徽标不消失）。
      // 恢复成功的 id 同时包含文档与小记：只清文档会让 quick 的 restorePending 在 sidecar 里长期残留，
      // 下一轮又把同内容小记重 PUT 一次（幂等但违背“恢复完成后不再产生 S3 行为”）。
      const restoredIds = new Set([
        ...lakePlan.notes.filter((p) => p.kind === "upload" && restore.has(p.id)).map((p) => p.id),
        ...quickPlan.items.filter((p) => p.kind === "upload" && restore.has(p.id)).map((p) => p.id),
      ]);
      const intents = this.clearIntentsOnSync(state.intents, pointer.epoch, pointer.generation, new Set(newLake.notes.map((n) => n.id)), restoredIds).filter((it) => !yieldedIntents.has(it.noteId) && !yieldedFolderIntents.has(it.noteId));
      const newState: DeviceState = { ...state, lake: { v: 3, space: "lake", notes: lakeChanged ? stateNotes : state.lake.notes, folders: stateFolders }, quickNotes: quickState, quickPurges: mergedQuickPurges, quickPurgeTimes, folders: stateFolders, remotePurged, intents, restorePending: (state.restorePending ?? []).filter((id) => !restoredIds.has(id)) };
      await this.device.saveState(newState);
      await this.device.saveBaseline({ epoch: pointer.epoch, generation: pointer.generation, lakeCommit: pointer.lake.commit, quickNotesCommit: pointer.quickNotes.commit, lake: newLake, quickNotes: newQuick });
      await this.executePending(newLake, newQuick, pointer.lake.commit, pointer.quickNotes.commit, newState, report);
      this.phase("pending");
      this.emitProgress({ phase: "finalize", done: 1, total: 1 });
      return { ...report, generation: pointer.generation };
    }

    const generation = pointer.generation + 1;
    const planned: PendingDelete[] = [
      ...planLakeDeletes({ previous: remoteLake, next: newLake, previousDecls: prevDecls, nextDecls: newLakeDecls, previousCommit: pointer.lake.commit, nextCommit: lakeCommit }),
      ...planQuickNotesDeletes({ previous: remoteQuick, next: newQuick, previousDecls: prevQuickDecls, nextDecls: newQuickDecls, previousCommit: pointer.quickNotes.commit, nextCommit: quickCommit }),
    ].map((d) => this.toPending(d, pointer.epoch, generation, d.space === "quickNotes" ? quickCommit : lakeCommit));
    const dedup = new Map<string, PendingDelete>();
    for (const p of state.pending) dedup.set(p.key + "|" + p.kind, p);
    for (const p of planned) dedup.set(p.key + "|" + p.kind, p);
    const pending = [...dedup.values()];

    const newState: DeviceState = { ...state, lake: { v: 3, space: "lake", notes: stateNotes, folders: stateFolders }, quickNotes: quickState, quickPurges: mergedQuickPurges, quickPurgeTimes, folders: stateFolders, remotePurged, pending };
    await this.device.saveState(newState);
    this.phase("publish-save-state");
    if (!(await this.acquireLock())) throw new S3v3SyncError("lock-busy", "另一台设备正在发布同步，请稍后重试");
    this.phase("publish-lock");
    try {
      const now = await this.readPointer();
      if (!now || now.epoch !== pointer.epoch || now.generation !== pointer.generation || now.lake.commit !== pointer.lake.commit || now.quickNotes.commit !== pointer.quickNotes.commit) {
        throw new PublishRetry();
      }
      if (lakeChanged) await this.writeIndex("lake", lakeCommit, lakeSerialized);
      if (quickChanged) await this.writeIndex("quickNotes", quickCommit, quickSerialized);
      this.phase("publish-index");
      const nextPointer: S3v3Pointer = { v: 3, epoch: pointer.epoch, generation, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: this.iso(), deviceId: this.deviceId };
      await this.assertLockOwned();
      await this.remote.put(S3V3_POINTER_KEY, new TextEncoder().encode(JSON.stringify(nextPointer)));
      const check = await this.readPointer();
      if (!check || check.generation !== generation || check.lake.commit !== lakeCommit || check.quickNotes.commit !== quickCommit) throw new PublishRetry();
      this.phase("publish-pointer");
      // 恢复成功的 id 同时包含文档与小记：只清文档会让 quick 的 restorePending 在 sidecar 里长期残留，
      // 下一轮又把同内容小记重 PUT 一次（幂等但违背“恢复完成后不再产生 S3 行为”）。
      const restoredIds = new Set([
        ...lakePlan.notes.filter((p) => p.kind === "upload" && restore.has(p.id)).map((p) => p.id),
        ...quickPlan.items.filter((p) => p.kind === "upload" && restore.has(p.id)).map((p) => p.id),
      ]);
      const publishedPurgeIds = new Set([...lakePlan.notes.filter((p) => p.kind === "local-purge").map((p) => p.id), ...quickPlan.items.filter((p) => p.kind === "local-purge").map((p) => p.id)]);
      const updatedIntents = this.bumpIntentsAfterPublish(state.intents, pointer.epoch, generation, restoredIds, publishedPurgeIds).filter((it) => !yieldedIntents.has(it.noteId) && !yieldedFolderIntents.has(it.noteId));
      const finalState: DeviceState = { ...newState, intents: updatedIntents, restorePending: (state.restorePending ?? []).filter((id) => !restoredIds.has(id)) };
      await this.device.saveState(finalState);
      await this.device.saveBaseline({ epoch: pointer.epoch, generation, lakeCommit, quickNotesCommit: quickCommit, lake: newLake, quickNotes: newQuick });
      this.phase("publish-finalize");
      const deleted = await this.executePending(newLake, newQuick, lakeCommit, quickCommit, finalState, report);
      this.phase("pending");
      this.emitProgress({ phase: "finalize", done: 1, total: 1 });
      return { ...report, published: true, generation, deletedObjects: deleted };
    } finally {
      await this.releaseLock();
    }
  }

  private toPending(d: PlannedDelete, epoch: string, generation: number, commit: string): PendingDelete {
    const base = { key: d.key, targetEpoch: epoch, targetGeneration: generation, targetCommit: commit, createdAt: this.iso() };
    switch (d.kind) {
      case "body": return { ...base, kind: "body", noteId: d.noteId!, oldHash: d.oldHash! };
      case "asset": return { ...base, kind: "asset", noteId: d.noteId!, filename: d.filename! };
      case "declaration": return { ...base, kind: "declaration", noteId: d.noteId!, oldDeclHash: d.oldDeclHash! };
      case "purge-prefix": return { ...base, kind: "purge-prefix", noteId: d.noteId! };
      case "index": return { ...base, kind: "index", space: d.space!, oldIndexHash: d.oldHash! };
      case "quick-note-body": return { ...base, kind: "quick-note-body", noteId: d.noteId!, oldHash: d.oldHash! };
      case "quick-note-asset": return { ...base, kind: "quick-note-asset", noteId: d.noteId!, filename: d.filename! };
      case "quick-note-declaration": return { ...base, kind: "quick-note-declaration", noteId: d.noteId!, oldDeclHash: d.oldDeclHash! };
      case "quick-note-purge-prefix": return { ...base, kind: "quick-note-purge-prefix", noteId: d.noteId! };
    }
  }

  /** 发布成功后：把本轮真正发布的删除意图钉到本轮 generation（不立即清除，防迟到覆盖）。 */
  private bumpIntentsAfterPublish(intents: DeletionIntent[], epoch: string, generation: number, restoredIds: Set<string>, publishedIds: Set<string>): DeletionIntent[] {
    return intents
      .filter((it) => !restoredIds.has(it.noteId))
      .map((it) => (it.targetEpoch === epoch && publishedIds.has(it.noteId) ? { ...it, targetGeneration: generation } : it));
  }

  /** 增量轮（未发布）：满足「更高 generation 且索引不含该 id」才清除。 */
  private clearIntentsOnSync(intents: DeletionIntent[], epoch: string, generation: number, indexIds: Set<string>, restoredIds: Set<string>): DeletionIntent[] {
    return intents.filter(
      (it) => !restoredIds.has(it.noteId) && !shouldClearDeletionIntent(it, { pointerEpoch: epoch, pointerGeneration: generation, indexHasId: indexIds.has(it.noteId), restored: false }),
    );
  }

  private async executePending(lake: LakeIndex, quick: QuickNotesIndex, lakeCommit: string, quickCommit: string, state: DeviceState, report: S3v3SyncReport): Promise<number> {
    if (state.pending.length === 0) return 0;
    const world: CurrentWorld = { lakeCommit, quickNotesCommit: quickCommit, notes: lake.notes, quickNotes: quick.items, declarations: {}, quickDeclarations: {} };
    // 声明并发取（261026）：待删项多时（批量 purge / 首轮 GC）逐条 RTT 会很慢；只读、可安全并发 8。
    const declTasks: Array<{ space: "lake" | "quickNotes"; id: string; declHash: string }> = [];
    const seenDecl = new Set<string>();
    for (const p of state.pending) {
      if (p.kind === "asset" || p.kind === "declaration" || p.kind === "quick-note-asset" || p.kind === "quick-note-declaration") {
        const space: "lake" | "quickNotes" = p.kind.startsWith("quick") ? "quickNotes" : "lake";
        const list = space === "quickNotes" ? world.quickNotes : world.notes;
        const n = list.find((x) => x.id === p.noteId);
        if (!n?.assetsHash) continue;
        const key = space + "/" + n.id;
        if (seenDecl.has(key)) continue;
        seenDecl.add(key);
        declTasks.push({ space, id: n.id, declHash: n.assetsHash });
      }
    }
    if (declTasks.length > 0) {
      const { errors } = await runTransferPipeline(declTasks, Math.min(8, this.transferConcurrency), async (t) => {
        const d = await this.getDeclaration(t.space, t.id, t.declHash);
        if (d) {
          const target = t.space === "quickNotes" ? world.quickDeclarations : world.declarations;
          target[t.id] = { declHash: t.declHash, filenames: d.assets.map((a) => a.filename) };
        }
        return 0;
      });
      const firstError = errors[0]?.error;
      if (firstError) throw firstError;
    }
    let deleted = 0;
    const deleteKeys: string[] = [];
    const deletePrefixes: string[] = [];
    for (const p of state.pending) {
      const gate = gatePendingDelete(p, world);
      if (!gate.execute) continue; // 仍被引用 → 跳过并出队
      if (p.kind === "purge-prefix" || p.kind === "quick-note-purge-prefix") deletePrefixes.push(p.key);
      else deleteKeys.push(p.key);
    }
    try {
      for (const prefix of deletePrefixes) deleted += await this.remote.deleteByPrefix(prefix);
      if (deleteKeys.length > 0) { await this.remote.deleteMany(deleteKeys); deleted += deleteKeys.length; }
      state.pending = [];
    } catch (e) {
      this.warnings.push("待删执行失败，下轮重试: " + (e as Error).message);
      state.pending = state.pending.filter((p) => gatePendingDelete(p, world).execute);
    }
    state.pending = state.pending;
    await this.device.saveState(state);
    report.deletedObjects += deleted;
    return deleted;
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

  private async buildAndUploadAll(state: DeviceState, report: S3v3SyncReport): Promise<{ lake: LakeIndex; quickNotes: QuickNotesIndex }> {
    // 初始化上传也不得复活「云端已彻底删除·仅本地」的副本（用户定稿：本地只保留，不产生 S3 行为）。
    const purgedIds = new Set(state.remotePurged ?? []);
    const lakeEntries = new Map(state.lake.notes.filter((n) => !purgedIds.has(n.id)).map((n) => [n.id, { ...n }]));
    for (const entry of lakeEntries.values()) {
      const body = await this.device.readBody(entry.id);
      if (!body) {
        // 云端为空时没有可拉回的副本：跳过且不得声明进初始化索引（否则索引引用不存在的正文）。
        this.warn("缺正文，跳过初始化上传: " + entry.id, { kind: "local_body_missing", noteId: entry.id, title: entry.title });
        lakeEntries.delete(entry.id);
        continue;
      }
      entry.contentHash = sha256Hex(body);
      const decl = await this.uploadAssets("lake", entry.id, null);
      if (decl) {
        this.uploadOps.push({ space: "lake", noteId: entry.id, key: declarationKey("lake", entry.id, decl.declHash), bytes: new TextEncoder().encode(serializeDeclaration(decl.declaration)), gzip: true });
        entry.assetsHash = decl.declHash;
      }
      this.uploadOps.push({ space: "lake", noteId: entry.id, key: lakeBodyKey(entry.id, entry.contentHash), bytes: body });
      report.uploadedNotes++;
    }
    const quickEntries = new Map(state.quickNotes.items.filter((q) => !purgedIds.has(q.id)).map((q) => [q.id, { ...q }]));
    for (const entry of quickEntries.values()) {
      const body = await this.device.readQuickBody(entry.id);
      if (!body) {
        this.warn("缺小记正文，跳过初始化上传: " + entry.id, { kind: "local_body_missing", noteId: entry.id });
        quickEntries.delete(entry.id);
        continue;
      }
      entry.contentHash = sha256Hex(body);
      const decl = await this.uploadQuickAssets(entry.id, null);
      if (decl) {
        this.uploadOps.push({ space: "quickNotes", noteId: entry.id, key: declarationKey("quickNotes", entry.id, decl.declHash), bytes: new TextEncoder().encode(serializeDeclaration(decl.declaration)), gzip: true });
        entry.assetsHash = decl.declHash;
      }
      this.uploadOps.push({ space: "quickNotes", noteId: entry.id, key: quickNoteBodyKey(entry.contentHash), bytes: body });
      report.uploadedNotes++;
    }
    const failures = await this.flushUploadOps();
    if (failures.size > 0) throw new Error("初始化上传失败: " + [...failures.values()][0]);
    return {
      lake: { v: 3, space: "lake", notes: [...lakeEntries.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), folders: state.folders },
      quickNotes: { v: 3, space: "quickNotes", items: [...quickEntries.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), tags: state.quickNotes.tags, ...((state.quickPurges ?? []).length ? { purged: [...(state.quickPurges ?? [])].sort() } : {}) },
    };
  }

  private async uploadAssets(space: "lake" | "quickNotes", id: string, remoteDecl: AssetDeclaration | null): Promise<ReturnType<typeof buildAssetDeclaration> | null> {
    const filenames = space === "lake" ? await this.device.listAssets(id) : await this.device.listQuickAssets(id);
    if (filenames.length === 0) return null;
    // 附件按 filename 内容寻址（同名 = 同内容）：远端声明已有的文件直接复用 size/hash，
    // 不读本地字节；只有新增/改名的附件才 readAsset。增量时改一篇带 100 张图的文档也只读新图。
    const remoteByName = new Map((remoteDecl?.assets ?? []).map((a) => [a.filename, a] as const));
    const entries: AssetDeclaration["assets"] = [];
    const toUpload: Array<{ filename: string; bytes: Uint8Array; nativePath?: string | null }> = [];
    for (const filename of filenames) {
      const known = remoteByName.get(filename);
      if (known) { entries.push(known); continue; }
      const bytes = space === "lake" ? await this.device.readAsset(id, filename) : await this.device.readQuickAsset(id, filename);
      if (!bytes) continue;
      entries.push({ filename, size: bytes.length, hash: sha256Hex(bytes) });
      // P0-4：Lake 资产上传时若有原生流式能力，登记「本地路径」而不是把字节留在内存/过桥。
      let nativePath: string | null = null;
      if (space === "lake" && this.remote.putFromFile && this.device.assetNativePath) {
        try { nativePath = await this.device.assetNativePath(id, filename); } catch { nativePath = null; }
      }
      toUpload.push({ filename, bytes, nativePath });
    }
    for (const a of toUpload) {
      const key = space === "lake" ? assetKey(id, a.filename) : quickNoteAssetKey(id, a.filename);
      if (a.nativePath) this.uploadOps.push({ space, noteId: id, key, fromFile: a.nativePath });
      else this.uploadOps.push({ space, noteId: id, key, bytes: a.bytes });
    }
    return buildAssetDeclaration(entries);
  }

  /** 把本轮积累的全部写操作按全局并发 8 执行；返回失败分组（space:noteId → 错误）。 */
  private async flushUploadOps(): Promise<Map<string, string>> {
    const ops = this.uploadOps;
    this.uploadOps = [];
    const { errors } = await runPoolSettled(ops, this.transferConcurrency, async (op) => {
      // P0-4：有原生流式上传能力时只传 key + 本地相对路径（字节不过 JS 桥）；否则回退字节路径。
      if (op.fromFile && this.remote.putFromFile) {
        try {
          if (await this.remote.putFromFile(op.key, op.fromFile, op.gzip ? { gzip: true } : undefined)) return;
        } catch { /* 回退字节路径 */ }
      }
      if (!op.bytes) throw new Error("上传任务缺少字节/原生文件路径: " + op.key);
      await this.remote.put(op.key, op.bytes, op.gzip ? { gzip: true } : undefined);
    });
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
   * 批量读本地正文（261026）：设备端口支持 readBodies 时按 100 篇一批读（移动端一次桥一批），
   * 否则回退逐篇。缺失/异常一律 null（与 readLocalBody 同语义）。
   */
  private async readLocalBodies(space: "lake" | "quickNotes", ids: string[]): Promise<Map<string, Uint8Array | null>> {
    const out = new Map<string, Uint8Array | null>();
    const batchFn = space === "lake" ? this.device.readBodies : this.device.readQuickBodies;
    const CHUNK = 100;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      if (batchFn) {
        try {
          const got = await batchFn.call(this.device, part);
          part.forEach((id, j) => out.set(id, got[j] ?? null));
          continue;
        } catch { /* 端口异常：回退逐篇 */ }
      }
      for (const id of part) out.set(id, await this.readLocalBody(space, id));
    }
    return out;
  }

  /** 批量 stat 本地正文（261026）：端口不支持/异常返回 null（调用方回退读内容比对）。 */
  private async statLocalBodies(space: "lake" | "quickNotes", ids: string[]): Promise<Map<string, { exists: boolean; size: number }> | null> {
    if (ids.length === 0) return new Map();
    const statFn = space === "lake" ? this.device.statBodies : this.device.statQuickBodies;
    if (!statFn) return null;
    const out = new Map<string, { exists: boolean; size: number }>();
    const CHUNK = 100;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        const got = await statFn.call(this.device, part);
        part.forEach((id, j) => out.set(id, got[j] ?? { exists: false, size: 0 }));
      }
      return out;
    } catch { return null; }
  }

  /** 读本地正文（缺失/异常一律 null；用于差集判定，不参与同步语义）。 */
  private async readLocalBody(space: "lake" | "quickNotes", id: string): Promise<Uint8Array | null> {
    try { return space === "lake" ? await this.device.readBody(id) : await this.device.readQuickBody(id); }
    catch { return null; }
  }

  /** 本轮每篇的本地资产 size/hash 缓存（原生统计；仅移动端支持时填充）。 */
  private localAssetStatsCache = new Map<string, Array<{ filename: string; size: number; hash: string }>>();

  /** 本地资产清单（filename 集合）；扫描失败回退空集 = 全量下载（不改旧行为）。 */
  private async localAssetNames(space: "lake" | "quickNotes", id: string): Promise<Set<string>> {
    try {
      const statsFn = space === "lake" ? this.device.listAssetStats : this.device.listQuickAssetStats;
      if (statsFn) {
        try {
          const stats = await statsFn.call(this.device, id);
          this.localAssetStatsCache.set(space + "/" + id, stats);
          return new Set(stats.map((s) => s.filename));
        } catch { /* 旧 APK/不支持：回退名字列表 */ }
      }
      return new Set(space === "lake" ? await this.device.listAssets(id) : await this.device.listQuickAssets(id));
    } catch { return new Set(); }
  }

  private async readLocalAsset(space: "lake" | "quickNotes", id: string, filename: string): Promise<Uint8Array | null> {
    try { return space === "lake" ? await this.device.readAsset(id, filename) : await this.device.readQuickAsset(id, filename); }
    catch { return null; }
  }

  /** P0 资产下载差集：本地已持「同名 + 同 size + 同 sha256」⇒ 内容寻址下逐字节等价，跳过 GET。 */
  private async localAssetMatches(space: "lake" | "quickNotes", id: string, a: AssetDeclaration["assets"][number], localNames: Set<string>): Promise<boolean> {
    if (!localNames.has(a.filename)) return false;
    // 移动端原生清单（261026）：size/hash 在原生算好并缓存（每篇只取一次），
    // 避免把 20k 张图读回 JS 再逐字节 sha256（原 P0 热点）。
    const cachedStats = this.localAssetStatsCache.get(space + "/" + id);
    const hit = cachedStats?.find((s) => s.filename === a.filename);
    if (hit) return hit.size === a.size && hit.hash === a.hash;
    if (cachedStats) return false;
    const have = await this.readLocalAsset(space, id, a.filename);
    return !!have && have.length === a.size && sha256Hex(have) === a.hash;
  }

  /** 上传前正文缺失：按远端内容 hash 尝试从云端拉回（校验一致才落盘）。 */
  private async restoreMissingBody(space: "lake" | "quickNotes", id: string, expectedHash?: string): Promise<Uint8Array | null> {
    if (!expectedHash) return null;
    const bytes = space === "lake" ? await this.getBody("lake", id, expectedHash) : await this.getQuickBody(expectedHash);
    if (!bytes || sha256Hex(bytes) !== expectedHash) return null;
    if (space === "lake") await this.device.writeBody(id, bytes);
    else await this.device.writeQuickBody(id, bytes);
    return bytes;
  }

  /**
   * 登记某条的资产下载任务（P0-1）：只做「声明读取 + 本地差集判定」，真正 GET 由全局流水线执行。
   * 与旧 downloadAssets 的差异：不再 per-note runPool（按篇 barrier，有效并发吃不满）。
   */
  private async scheduleAssets(space: "lake" | "quickNotes", id: string, declHash?: string, preloaded?: AssetDeclaration | null): Promise<AssetDeclaration | null> {
    if (!declHash) return null;
    const decl = preloaded !== undefined ? preloaded : await this.getDeclaration(space, id, declHash);
    if (!decl) {
      this.warn((space === "lake" ? "缺资产声明: " : "缺小记图片声明: ") + id, { kind: "remote_incomplete", noteId: id });
      return null;
    }
    const localNames = await this.localAssetNames(space, id);
    for (const a of decl.assets) {
      if (await this.localAssetMatches(space, id, a, localNames)) continue; // 本地已持同内容：不产生 GET
      this.assetTasks.push({
        space, noteId: id, filename: a.filename,
        key: space === "lake" ? assetKey(id, a.filename) : quickNoteAssetKey(id, a.filename),
        size: a.size, hash: a.hash,
      });
    }
    return decl;
  }

  /** 全局有界流水线执行全部资产下载：对象级失败隔离，谁先完成谁写盘。 */
  private async flushAssetTasks(): Promise<void> {
    const tasks = this.assetTasks;
    this.assetTasks = [];
    if (tasks.length === 0) return;
    const bytesTotal = tasks.reduce((sum, t) => sum + (Number.isFinite(t.size) ? t.size : 0), 0);
    this.phase("assets");
    const result = await runTransferPipeline(tasks, this.downloadConcurrency, async (t) => {
      // P0-4：原生流式下载（移动端 OkHttp 直写文件 + 原生 size/sha256 校验，字节不过 JS 桥）。
      if (t.space === "lake" && this.remote.getToFile && this.device.assetNativePath) {
        try {
          const dest = await this.device.assetNativePath(t.noteId, t.filename);
          if (dest) {
            const status = await this.remote.getToFile(t.key, dest, { size: t.size, sha256: t.hash });
            if (status === "ok") return t.size;
            if (status === "missing") {
              this.warn("缺附件: " + t.noteId + "/" + t.filename, { kind: "asset_missing", noteId: t.noteId, filename: t.filename });
              return 0;
            }
            if (status === "corrupt") {
              this.warn("附件校验失败: " + t.noteId + "/" + t.filename, { kind: "asset_missing", noteId: t.noteId, filename: t.filename });
              return 0;
            }
            // unsupported → 回退下面的字节路径
          }
        } catch { /* 原生路径异常 → 回退字节路径，保证可用性 */ }
      }
      const bytes = await this.remote.get(t.key);
      if (!bytes) {
        this.warn((t.space === "lake" ? "缺附件: " : "缺小记图片: ") + t.noteId + "/" + t.filename, { kind: "asset_missing", noteId: t.noteId, filename: t.filename });
        return 0;
      }
      if (bytes.length !== t.size || sha256Hex(bytes) !== t.hash) {
        this.warn((t.space === "lake" ? "附件校验失败: " : "小记图片校验失败: ") + t.noteId + "/" + t.filename, { kind: "asset_missing", noteId: t.noteId, filename: t.filename });
        return 0;
      }
      try {
        if (t.space === "lake") await this.device.writeAsset(t.noteId, t.filename, bytes);
        else await this.device.writeQuickAsset(t.noteId, t.filename, bytes);
      } catch (e) {
        this.warn("附件落盘失败: " + t.noteId + "/" + t.filename + " " + (e as Error).message, { kind: "asset_missing", noteId: t.noteId, filename: t.filename });
        return 0;
      }
      return bytes.length;
    }, {
      phase: "assets",
      totalOverride: tasks.length,
      bytesTotal,
      onProgress: (p) => this.emitProgress(p),
    });
    for (const err of result.errors) {
      const t = tasks[err.index];
      if (!t) continue;
      this.warn("附件下载异常: " + t.noteId + "/" + t.filename + " " + ((err.error as Error)?.message ?? String(err.error)), { kind: "asset_missing", noteId: t.noteId, filename: t.filename });
    }
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

  /** 全量重拉（epoch/回滚/换桶后由 UI 调用）：云端赢，本地多出的归档。 */
  async resetFromCloud(): Promise<S3v3SyncReport> {
    const pointer = await this.readPointer();
    if (!pointer) throw new S3v3SyncError("pointer-corrupt", "云端没有 pointer，无法全量重拉");
    const state = (await this.device.loadState()) ?? emptyState();
    return this.pullAll(pointer, { ...state, pending: [] }, { downloadedNotes: 0, uploadedNotes: 0, deletedObjects: 0, published: false, generation: null, warnings: [], warningDetails: [], supersededNotes: [] }, true);
  }
}
