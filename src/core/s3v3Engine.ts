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
  type QuickNotesIndex,
} from "./s3v3Index.js";
import { classifyCloudState } from "./s3v3Pointer.js";
import type { S3v3Pointer } from "./s3v3Types.js";
import { validatePointer } from "./s3v3Types.js";
import { planLakeMerge, planQuickNotesMerge } from "./s3v3Merge.js";
import { planLakeDeletes, planQuickNotesDeletes, type PlannedDelete } from "./s3v3Gc.js";
import { gatePendingDelete, type CurrentWorld, type PendingDelete } from "./s3v3Gate.js";
import { shouldClearDeletionIntent, type DeletionIntent } from "./s3v3Intent.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./s3v3DeviceStore.js";
import type { S3v3Remote } from "./s3v3Ports.js";
import { runPool, runPoolSettled } from "./s3v3Pool.js";
import { mergeQuickNoteTags, type QuickNoteTag } from "./quickNoteTags.js";

const DEFAULT_TRANSFER_CONCURRENCY = 12; // 用户批准：8 → 12（实测首同步约 1.5x）

const LOCK_KEY = "meta/lock.json";
const LOCK_TTL_MS = 120_000;
/** 锁重试：无 CAS 的 provider 下，靠「写后静置再读回」降低双持窗口。 */
const LOCK_DEADLINE_MS = 15_000;
const LOCK_SETTLE_MS = 40; // 单用户场景下减少固定发布延迟；多端冲突仍由锁重试/归属复核兜底
const TRASH_ID = "trash";
const MAX_PUBLISH_RETRIES = 6;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
}
export interface S3v3SyncReport {
  downloadedNotes: number;
  uploadedNotes: number;
  deletedObjects: number;
  published: boolean;
  generation: number | null;
  warnings: string[];
}
export interface S3v3EngineOptions {
  remote: S3v3Remote;
  device: S3v3DeviceStore;
  deviceId: string;
  now?: () => Date;
  /** 发布锁最长等待（ms）；测试可调小。默认 LOCK_DEADLINE_MS。 */
  lockWaitMs?: number;
  /** 阶段耗时回调（诊断慢同步/卡顿）：phase + 距上一阶段毫秒数。 */
  onPhase?: (phase: string, ms: number) => void;
  /** 传输并发（261025 用户批准从 8 提到 12；实测首同步约 1.5x）。 */
  transferConcurrency?: number;
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
  private readonly transferConcurrency: number;
  private phaseStart = 0;
  private readonly declCache = new Map<string, AssetDeclaration>();
  private uploadOps: Array<{ space: "lake" | "quickNotes"; noteId: string; key: string; bytes: Uint8Array; gzip?: boolean }> = [];
  private readonly bodyCache = new Map<string, Uint8Array>();
  private warnings: string[] = [];

  constructor(opts: S3v3EngineOptions) {
    this.remote = opts.remote;
    this.device = opts.device;
    this.deviceId = opts.deviceId;
    this.now = opts.now ?? (() => new Date());
    this.lockWaitMs = opts.lockWaitMs ?? LOCK_DEADLINE_MS;
    this.onPhase = opts.onPhase;
    this.transferConcurrency = Math.max(1, Math.min(32, opts.transferConcurrency ?? DEFAULT_TRANSFER_CONCURRENCY));
  }

  /** 记录阶段耗时；回调异常不影响同步。 */
  private phase(name: string): void {
    const now = Date.now();
    const ms = now - this.phaseStart;
    this.phaseStart = now;
    try { this.onPhase?.(name, ms); } catch { /* 日志回调自行负责 */ }
  }

  private iso(): string { return this.now().toISOString(); }

  /** 正常同步（先拉后推 + 发布锁 + 待删门禁）。 */
  async sync(opts: S3v3SyncOptions = {}): Promise<S3v3SyncReport> {
    this.uploadOps = [];
    this.phaseStart = Date.now();
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_PUBLISH_RETRIES; attempt++) {
      this.warnings = [];
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
    if (this.declCache.has(cacheKey)) return this.declCache.get(cacheKey)!;
    const bytes = await this.remote.get(declarationKey(space, id, declHash));
    if (!bytes) return null;
    const decl = validateAssetDeclaration(JSON.parse(new TextDecoder().decode(bytes)));
    if (declarationHashOf(decl) !== declHash) throw new S3v3SyncError("declaration-hash-mismatch", "声明 hash 不符: " + id);
    this.declCache.set(cacheKey, decl);
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
    const report: S3v3SyncReport = { downloadedNotes: 0, uploadedNotes: 0, deletedObjects: 0, published: false, generation: null, warnings: this.warnings };
    const state = (await this.device.loadState()) ?? emptyState();
    const baseline = await this.device.loadBaseline();
    const pointer = await this.readPointer();
    const cloudHasObjects = pointer ? true : (await this.remote.list("objects/")).length > 0 || (await this.remote.list("meta/index/")).length > 0;
    const cloudState = classifyCloudState({ pointer, baseline, cloudHasObjects });
    this.phase("load-state");

    if (!baseline) {
      if (pointer) return await this.pullAll(pointer, state, report, true);
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
  private async pullAll(pointer: S3v3Pointer, state: DeviceState, report: S3v3SyncReport, archiveLocal: boolean): Promise<S3v3SyncReport> {
    const lake = (await this.readIndex("lake", pointer.lake.commit)) as LakeIndex;
    const quick = (await this.readIndex("quickNotes", pointer.quickNotes.commit)) as QuickNotesIndex;
    this.phase("read-index");
    if (archiveLocal) {
      for (const n of state.lake.notes) {
        const bytes = await this.device.readBody(n.id);
        await this.device.archiveBody(n.id, bytes);
      }
      for (const q of state.quickNotes.items) {
        const bytes = await this.device.readQuickBody(q.id);
        if (bytes) await this.device.writeHistory("quick-" + q.id, bytes);
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
    for (const n of lake.notes) {
      const bytes = await this.getBody("lake", n.id, n.contentHash);
      if (!bytes) { this.warnings.push("缺正文: " + n.id); continue; }
      await this.device.writeBody(n.id, bytes);
      await this.downloadAssets(n.id, n.assetsHash);
      report.downloadedNotes++;
    }
    for (const q of quick.items) {
      const bytes = await this.getQuickBody(q.contentHash);
      if (!bytes) { this.warnings.push("缺小记正文: " + q.id); continue; }
      await this.device.writeQuickBody(q.id, bytes);
      await this.downloadQuickAssets(q.id, q.assetsHash);
      report.downloadedNotes++;
    }
    this.phase("downloads");
    await this.device.saveState(newState);
    await this.device.saveBaseline({ epoch: pointer.epoch, generation: pointer.generation, lakeCommit: pointer.lake.commit, quickNotesCommit: pointer.quickNotes.commit, lake, quickNotes: quick });
    this.phase("save");
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

  private async incrementalSync(pointer: S3v3Pointer, baseline: DeviceBaseline, state: DeviceState, report: S3v3SyncReport): Promise<S3v3SyncReport> {
    const remoteLake = pointer.lake.commit === baseline.lakeCommit ? baseline.lake : ((await this.readIndex("lake", pointer.lake.commit)) as LakeIndex);
    const remoteQuick = pointer.quickNotes.commit === baseline.quickNotesCommit ? baseline.quickNotes : ((await this.readIndex("quickNotes", pointer.quickNotes.commit)) as QuickNotesIndex);
    this.phase("read-index");
    const baselineLake = baseline.lake;
    const baselineQuick = baseline.quickNotes;

    const purged = new Set(state.remotePurged ?? []);
    const restore = new Set(state.restorePending ?? []);
    // 「恢复是唯一显式例外」：远端条目 updatedAt 晚于本地 purgedAt → 视为他端显式恢复，删除意图让位。
    const yieldedIntents = new Set<string>();
    for (const it of state.intents) {
      const remote = remoteLake.notes.find((n) => n.id === it.noteId);
      if (remote && it.purgedAt && remote.updatedAt > it.purgedAt) yieldedIntents.add(it.noteId);
    }
    const intentIds = new Set(state.intents.filter((i) => !yieldedIntents.has(i.noteId)).map((i) => i.noteId));
    const lakeLocal: LakeIndex = { v: 3, space: "lake", notes: state.lake.notes.filter((n) => !purged.has(n.id)), folders: state.folders };
    const lakePlan = planLakeMerge(baselineLake, lakeLocal, remoteLake, { restorePending: restore, purgeIntents: intentIds, folderPurgeIntents: intentIds });
    const quickPlan = planQuickNotesMerge(baselineQuick, state.quickNotes, remoteQuick, restore, intentIds, new Set(state.quickDeletes ?? []));
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
      const local = lakeWS.get(plan.id);
      if (plan.applyRemote && remote) {
        if (plan.archiveLocal && local) await this.device.archiveBody(plan.id, await this.device.readBody(plan.id));
        const needBody = !local || local.contentHash !== remote.contentHash || plan.kind === "download" || plan.kind === "remote-wins-history";
        if (needBody) {
          const bytes = await this.getBody("lake", remote.id, remote.contentHash);
          if (!bytes) { this.warnings.push("远端缺正文，跳过: " + remote.id); continue; }
          await this.device.writeBody(remote.id, bytes);
          report.downloadedNotes++;
        }
        const oldDecl = local?.assetsHash;
        if (oldDecl && oldDecl !== remote.assetsHash) {
          const d = await this.getDeclaration("lake", remote.id, oldDecl);
          if (d) prevDecls.set(remote.id, { declHash: oldDecl, filenames: d.assets.map((a) => a.filename) });
        }
        const decl = await this.downloadAssets(remote.id, remote.assetsHash);
        if (decl) newLakeDecls.set(remote.id, { declHash: remote.assetsHash!, filenames: decl.assets.map((a) => a.filename) });
        lakeWS.set(remote.id, { ...remote });
      }
    }
    for (const plan of lakePlan.notes) {
      if (plan.kind === "local-purge") {
        lakeWS.delete(plan.id);
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
      if (plan.kind === "local-purge") { quickWS.delete(plan.id); continue; }
      if (!remote || !plan.applyRemote) continue;
      if (plan.archiveLocal && local) {
        const bytes = await this.device.readQuickBody(plan.id);
        if (bytes) await this.device.writeHistory("quick-" + plan.id, bytes);
      }
      const needBody = !local || local.contentHash !== remote.contentHash || plan.kind === "download" || plan.kind === "remote-wins-history";
      if (needBody) {
        const bytes = await this.getQuickBody(remote.contentHash);
        if (!bytes) { this.warnings.push("远端缺小记正文，跳过: " + remote.id); continue; }
        await this.device.writeQuickBody(remote.id, bytes);
        report.downloadedNotes++;
      }
      const oldDecl = local?.assetsHash;
      if (oldDecl && oldDecl !== remote.assetsHash) {
        const d = await this.getDeclaration("quickNotes", remote.id, oldDecl);
        if (d) prevQuickDecls.set(remote.id, { declHash: oldDecl, filenames: d.assets.map((a) => a.filename) });
      }
      const decl = await this.downloadQuickAssets(remote.id, remote.assetsHash);
      if (decl) newQuickDecls.set(remote.id, { declHash: remote.assetsHash!, filenames: decl.assets.map((a) => a.filename) });
      quickWS.set(remote.id, { ...remote });
    }

    // ---- 上传 ----
    for (const plan of lakePlan.notes) {
      if (!plan.uploadLocal) continue;
      const entry = lakeWS.get(plan.id);
      if (!entry) continue;
      try {
        const body = await this.device.readBody(plan.id);
        if (!body) { this.warnings.push("本地缺正文，跳过上传: " + plan.id); continue; }
        const hash = sha256Hex(body);
        entry.contentHash = hash;
        const remoteDecl = plan.remote?.assetsHash ? await this.getDeclaration("lake", plan.id, plan.remote.assetsHash) : null;
        const decl = await this.uploadAssets("lake", plan.id, remoteDecl);
        if (decl) {
          this.uploadOps.push({ space: "lake", noteId: plan.id, key: declarationKey("lake", plan.id, decl.declHash), bytes: new TextEncoder().encode(serializeDeclaration(decl.declaration)), gzip: true });
          entry.assetsHash = decl.declHash;
          newLakeDecls.set(plan.id, { declHash: decl.declHash, filenames: decl.declaration.assets.map((a) => a.filename) });
          if (plan.remote?.assetsHash && plan.remote.assetsHash !== decl.declHash) {
            const old = await this.getDeclaration("lake", plan.id, plan.remote.assetsHash);
            if (old) prevDecls.set(plan.id, { declHash: plan.remote.assetsHash, filenames: old.assets.map((a) => a.filename) });
          }
        } else {
          entry.assetsHash = undefined;
          if (plan.remote?.assetsHash) {
            const old = await this.getDeclaration("lake", plan.id, plan.remote.assetsHash);
            if (old) prevDecls.set(plan.id, { declHash: plan.remote.assetsHash, filenames: old.assets.map((a) => a.filename) });
          }
        }
        this.uploadOps.push({ space: "lake", noteId: plan.id, key: lakeBodyKey(plan.id, hash), bytes: body });
        report.uploadedNotes++;
      } catch (e) {
        this.warnings.push("上传失败，保持 local 下轮重试: " + plan.id + " " + (e as Error).message);
        // 关键：失败笔记不得进入本轮新索引（否则索引引用未落盘正文/声明），回退到远端旧条目或移出。
        lakeWS.failUpload(plan.id, plan.remote ? { ...plan.remote } : null);
        newLakeDecls.delete(plan.id);
        prevDecls.delete(plan.id);
      }
    }
    for (const plan of quickPlan.items) {
      if (!plan.uploadLocal) continue;
      const entry = quickWS.get(plan.id);
      if (!entry) continue;
      try {
        const body = await this.device.readQuickBody(plan.id);
        if (!body) { this.warnings.push("本地缺小记正文，跳过上传: " + plan.id); continue; }
        entry.contentHash = sha256Hex(body);
        const remoteDecl = plan.remote?.assetsHash ? await this.getDeclaration("quickNotes", plan.id, plan.remote.assetsHash) : null;
        const decl = await this.uploadQuickAssets(plan.id, remoteDecl);
        if (decl) {
          this.uploadOps.push({ space: "quickNotes", noteId: plan.id, key: declarationKey("quickNotes", plan.id, decl.declHash), bytes: new TextEncoder().encode(serializeDeclaration(decl.declaration)), gzip: true });
          entry.assetsHash = decl.declHash;
          newQuickDecls.set(plan.id, { declHash: decl.declHash, filenames: decl.declaration.assets.map((a) => a.filename) });
          if (plan.remote?.assetsHash && plan.remote.assetsHash !== decl.declHash) {
            const old = await this.getDeclaration("quickNotes", plan.id, plan.remote.assetsHash);
            if (old) prevQuickDecls.set(plan.id, { declHash: plan.remote.assetsHash, filenames: old.assets.map((a) => a.filename) });
          }
        } else {
          entry.assetsHash = undefined;
        }
        this.uploadOps.push({ space: "quickNotes", noteId: plan.id, key: quickNoteBodyKey(entry.contentHash), bytes: body });
        report.uploadedNotes++;
      } catch (e) {
        this.warnings.push("小记上传失败，保持 local 下轮重试: " + plan.id + " " + (e as Error).message);
        quickWS.failUpload(plan.id, plan.remote ? { ...plan.remote } : null);
        newQuickDecls.delete(plan.id);
        prevQuickDecls.delete(plan.id);
      }
    }

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
    const quickChanged = tagsChanged || quickLinksChanged || quickPlan.items.some((p) => p.kind !== "none" || p.uploadLocal || p.applyRemote);
    // 本地状态保留「远端已彻底删除、本机回收站副本」（remotePurged），但不进同步索引。
    const stateNotes = lakeChanged ? lakeWS.localValues().sort((a, b) => (a.id < b.id ? -1 : 1)) : state.lake.notes;
    const stateFolders = [...state.folders].sort((a, b) => (a.id < b.id ? -1 : 1));
    const newLake: LakeIndex = lakeChanged ? { v: 3, space: "lake", notes: lakeWS.indexValues().filter((n) => !purged.has(n.id)).sort((a, b) => (a.id < b.id ? -1 : 1)), folders: stateFolders } : remoteLake;
    const newQuick: QuickNotesIndex = quickChanged ? { v: 3, space: "quickNotes", items: quickWS.indexValues().sort((a, b) => (a.id < b.id ? -1 : 1)), tags: mergedQuickTags } : remoteQuick;
    // 无变化的半边不做全量序列化/哈希（大库空跑时这是主要 CPU）
    const lakeSerialized = lakeChanged ? serializeLakeIndex(newLake) : "";
    const quickSerialized = quickChanged ? serializeQuickNotesIndex(newQuick) : "";
    const lakeCommit = lakeChanged ? indexHashOf(lakeSerialized) : pointer.lake.commit;
    const quickCommit = quickChanged ? indexHashOf(quickSerialized) : pointer.quickNotes.commit;
    const needPublish = lakeCommit !== pointer.lake.commit || quickCommit !== pointer.quickNotes.commit;

    if (!needPublish) {
      const restoredIds = new Set(lakePlan.notes.filter((p) => p.kind === "upload" && restore.has(p.id)).map((p) => p.id));
      const intents = this.clearIntentsOnSync(state.intents, pointer.epoch, pointer.generation, new Set(newLake.notes.map((n) => n.id)), restoredIds).filter((it) => !yieldedIntents.has(it.noteId));
      const newState: DeviceState = { ...state, lake: { v: 3, space: "lake", notes: lakeChanged ? stateNotes : state.lake.notes, folders: stateFolders }, quickNotes: newQuick, folders: stateFolders, intents, restorePending: (state.restorePending ?? []).filter((id) => !restoredIds.has(id)) };
      await this.device.saveState(newState);
      await this.device.saveBaseline({ epoch: pointer.epoch, generation: pointer.generation, lakeCommit: pointer.lake.commit, quickNotesCommit: pointer.quickNotes.commit, lake: newLake, quickNotes: newQuick });
      await this.executePending(newLake, newQuick, pointer.lake.commit, pointer.quickNotes.commit, newState, report);
      this.phase("pending");
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

    const newState: DeviceState = { ...state, lake: { v: 3, space: "lake", notes: stateNotes, folders: stateFolders }, quickNotes: newQuick, folders: stateFolders, pending };
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
      const restoredIds = new Set(lakePlan.notes.filter((p) => p.kind === "upload" && restore.has(p.id)).map((p) => p.id));
      const publishedPurgeIds = new Set([...lakePlan.notes.filter((p) => p.kind === "local-purge").map((p) => p.id), ...quickPlan.items.filter((p) => p.kind === "local-purge").map((p) => p.id)]);
      const updatedIntents = this.bumpIntentsAfterPublish(state.intents, pointer.epoch, generation, restoredIds, publishedPurgeIds).filter((it) => !yieldedIntents.has(it.noteId));
      const finalState: DeviceState = { ...newState, intents: updatedIntents, restorePending: (state.restorePending ?? []).filter((id) => !restoredIds.has(id)) };
      await this.device.saveState(finalState);
      await this.device.saveBaseline({ epoch: pointer.epoch, generation, lakeCommit, quickNotesCommit: quickCommit, lake: newLake, quickNotes: newQuick });
      this.phase("publish-finalize");
      const deleted = await this.executePending(newLake, newQuick, lakeCommit, quickCommit, finalState, report);
      this.phase("pending");
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
    for (const p of state.pending) {
      if (p.kind === "asset" || p.kind === "declaration" || p.kind === "quick-note-asset" || p.kind === "quick-note-declaration") {
        const list = p.kind.startsWith("quick") ? world.quickNotes : world.notes;
        const n = list.find((x) => x.id === p.noteId);
        if (n?.assetsHash) {
          const d = await this.getDeclaration(p.kind.startsWith("quick") ? "quickNotes" : "lake", n.id, n.assetsHash);
          if (d) {
            const target = p.kind.startsWith("quick") ? world.quickDeclarations : world.declarations;
            target[n.id] = { declHash: n.assetsHash, filenames: d.assets.map((a) => a.filename) };
          }
        }
      }
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
    const lakeEntries = new Map(state.lake.notes.map((n) => [n.id, { ...n }]));
    for (const entry of lakeEntries.values()) {
      const body = await this.device.readBody(entry.id);
      if (!body) { this.warnings.push("缺正文，跳过初始化上传: " + entry.id); continue; }
      entry.contentHash = sha256Hex(body);
      const decl = await this.uploadAssets("lake", entry.id, null);
      if (decl) {
        this.uploadOps.push({ space: "lake", noteId: entry.id, key: declarationKey("lake", entry.id, decl.declHash), bytes: new TextEncoder().encode(serializeDeclaration(decl.declaration)), gzip: true });
        entry.assetsHash = decl.declHash;
      }
      this.uploadOps.push({ space: "lake", noteId: entry.id, key: lakeBodyKey(entry.id, entry.contentHash), bytes: body });
      report.uploadedNotes++;
    }
    const quickEntries = new Map(state.quickNotes.items.map((q) => [q.id, { ...q }]));
    for (const entry of quickEntries.values()) {
      const body = await this.device.readQuickBody(entry.id);
      if (!body) { this.warnings.push("缺小记正文，跳过初始化上传: " + entry.id); continue; }
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
      quickNotes: { v: 3, space: "quickNotes", items: [...quickEntries.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), tags: state.quickNotes.tags },
    };
  }

  private async uploadAssets(space: "lake" | "quickNotes", id: string, remoteDecl: AssetDeclaration | null): Promise<ReturnType<typeof buildAssetDeclaration> | null> {
    const filenames = space === "lake" ? await this.device.listAssets(id) : await this.device.listQuickAssets(id);
    if (filenames.length === 0) return null;
    // 附件按 filename 内容寻址（同名 = 同内容）：远端声明已有的文件直接复用 size/hash，
    // 不读本地字节；只有新增/改名的附件才 readAsset。增量时改一篇带 100 张图的文档也只读新图。
    const remoteByName = new Map((remoteDecl?.assets ?? []).map((a) => [a.filename, a] as const));
    const entries: AssetDeclaration["assets"] = [];
    const toUpload: Array<{ filename: string; bytes: Uint8Array }> = [];
    for (const filename of filenames) {
      const known = remoteByName.get(filename);
      if (known) { entries.push(known); continue; }
      const bytes = space === "lake" ? await this.device.readAsset(id, filename) : await this.device.readQuickAsset(id, filename);
      if (!bytes) continue;
      entries.push({ filename, size: bytes.length, hash: sha256Hex(bytes) });
      toUpload.push({ filename, bytes });
    }
    for (const a of toUpload) {
      this.uploadOps.push({ space, noteId: id, key: space === "lake" ? assetKey(id, a.filename) : quickNoteAssetKey(id, a.filename), bytes: a.bytes });
    }
    return buildAssetDeclaration(entries);
  }

  /** 把本轮积累的全部写操作按全局并发 8 执行；返回失败分组（space:noteId → 错误）。 */
  private async flushUploadOps(): Promise<Map<string, string>> {
    const ops = this.uploadOps;
    this.uploadOps = [];
    const { errors } = await runPoolSettled(ops, this.transferConcurrency, async (op) => {
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

  private async downloadAssets(id: string, declHash?: string): Promise<AssetDeclaration | null> {
    if (!declHash) { return null; }
    const decl = await this.getDeclaration("lake", id, declHash);
    if (!decl) { this.warnings.push("缺资产声明: " + id); return null; }
    await runPool(decl.assets, this.transferConcurrency, async (a) => {
      const bytes = await this.remote.get(assetKey(id, a.filename));
      if (!bytes) { this.warnings.push("缺附件: " + id + "/" + a.filename); return; }
      if (bytes.length !== a.size || sha256Hex(bytes) !== a.hash) { this.warnings.push("附件校验失败: " + id + "/" + a.filename); return; }
      await this.device.writeAsset(id, a.filename, bytes);
    });
    return decl;
  }
  private async downloadQuickAssets(id: string, declHash?: string): Promise<AssetDeclaration | null> {
    if (!declHash) return null;
    const decl = await this.getDeclaration("quickNotes", id, declHash);
    if (!decl) { this.warnings.push("缺小记图片声明: " + id); return null; }
    await runPool(decl.assets, this.transferConcurrency, async (a) => {
      const bytes = await this.remote.get(quickNoteAssetKey(id, a.filename));
      if (!bytes) { this.warnings.push("缺小记图片: " + id + "/" + a.filename); return; }
      if (bytes.length !== a.size || sha256Hex(bytes) !== a.hash) { this.warnings.push("小记图片校验失败: " + id + "/" + a.filename); return; }
      await this.device.writeQuickAsset(id, a.filename, bytes);
    });
    return decl;
  }

  /**
   * 深度清理（手动/周期）：列举对象并用「当前指针+索引+声明」算 keep 集，删除不可达对象。
   * 用于崩溃/半途失败留下的孤儿（如「声明已写、pointer 未切」）。不进入日常同步。
   */
  async deepCleanup(opts: { dryRun?: boolean } = {}): Promise<{ deleted: string[]; kept: number }> {
    const pointer = await this.readPointer();
    if (!pointer) throw new S3v3SyncError("pointer-corrupt", "云端没有 pointer，无法深度清理");
    const lake = (await this.readIndex("lake", pointer.lake.commit)) as LakeIndex;
    const quick = (await this.readIndex("quickNotes", pointer.quickNotes.commit)) as QuickNotesIndex;
    const keep = new Set<string>();
    keep.add(S3V3_POINTER_KEY);
    keep.add(LOCK_KEY);
    keep.add(indexKey("lake", pointer.lake.commit));
    keep.add(indexKey("quickNotes", pointer.quickNotes.commit));
    for (const n of lake.notes) {
      keep.add(lakeBodyKey(n.id, n.contentHash));
      if (!n.assetsHash) continue;
      keep.add(declarationKey("lake", n.id, n.assetsHash));
      const d = await this.getDeclaration("lake", n.id, n.assetsHash);
      for (const a of d?.assets ?? []) keep.add(assetKey(n.id, a.filename));
    }
    for (const q of quick.items) {
      keep.add(quickNoteBodyKey(q.contentHash));
      if (!q.assetsHash) continue;
      keep.add(declarationKey("quickNotes", q.id, q.assetsHash));
      const d = await this.getDeclaration("quickNotes", q.id, q.assetsHash);
      for (const a of d?.assets ?? []) keep.add(quickNoteAssetKey(q.id, a.filename));
    }
    const prefixes = ["objects/", "assets/", "meta/index/", "meta/assets/", "quick-notes/objects/", "quick-notes/assets/", "quick-notes/meta/"];
    const all = new Set<string>();
    for (const prefix of prefixes) for (const item of await this.remote.list(prefix)) all.add(item.key);
    const toDelete = [...all].filter((k) => !keep.has(k)).sort();
    if (!opts.dryRun) {
      const CHUNK = 1000;
      for (let i = 0; i < toDelete.length; i += CHUNK) await this.remote.deleteMany(toDelete.slice(i, i + CHUNK));
      const state = await this.device.loadState();
      if (state) {
        state.pending = state.pending.filter((p) => all.has(p.key) && !toDelete.includes(p.key));
        await this.device.saveState(state);
      }
    }
    return { deleted: toDelete, kept: keep.size };
  }

  /** 全量重拉（epoch/回滚/换桶后由 UI 调用）：云端赢，本地多出的归档。 */
  async resetFromCloud(): Promise<S3v3SyncReport> {
    const pointer = await this.readPointer();
    if (!pointer) throw new S3v3SyncError("pointer-corrupt", "云端没有 pointer，无法全量重拉");
    const state = (await this.device.loadState()) ?? emptyState();
    return this.pullAll(pointer, { ...state, pending: [] }, { downloadedNotes: 0, uploadedNotes: 0, deletedObjects: 0, published: false, generation: null, warnings: [] }, true);
  }
}
