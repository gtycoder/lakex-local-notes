import { randomUUID } from "node:crypto";
import { sha256Hex } from "../../src/core/syncUtils.js";
import {
  S3V3_POINTER_KEY,
  assetKey,
  declarationKey,
  indexKey,
  lakeBodyKey,
  quickNoteAssetKey,
  quickNoteBodyKey,
} from "../../src/core/s3v3Keys.js";
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
} from "../../src/core/s3v3Index.js";
import { classifyCloudState } from "../../src/core/s3v3Pointer.js";
import type { S3v3Pointer } from "../../src/core/s3v3Types.js";
import { validatePointer } from "../../src/core/s3v3Types.js";
import { planLakeMerge, planQuickNotesMerge } from "../../src/core/s3v3Merge.js";
import { planLakeDeletes, planQuickNotesDeletes, type PlannedDelete } from "../../src/core/s3v3Gc.js";
import { gatePendingDelete, type CurrentWorld, type PendingDelete } from "../../src/core/s3v3Gate.js";
import { shouldClearDeletionIntent, type DeletionIntent } from "../../src/core/s3v3Intent.js";
import type { DeviceBaseline, DeviceState, FileDeviceStore } from "./fileDeviceStore.js";
import type { S3v3Remote } from "./ports.js";

const LOCK_KEY = "meta/lock.json";
const LOCK_TTL_MS = 120_000;
const TRASH_ID = "trash";
const MAX_PUBLISH_RETRIES = 3;

export class S3v3SyncError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "S3v3SyncError";
  }
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
  device: FileDeviceStore;
  deviceId: string;
  now?: () => Date;
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

export class S3v3SyncEngine {
  private readonly remote: S3v3Remote;
  private readonly device: FileDeviceStore;
  private readonly deviceId: string;
  private readonly now: () => Date;
  private readonly declCache = new Map<string, AssetDeclaration>();
  private readonly bodyCache = new Map<string, Uint8Array>();
  private warnings: string[] = [];

  constructor(opts: S3v3EngineOptions) {
    this.remote = opts.remote;
    this.device = opts.device;
    this.deviceId = opts.deviceId;
    this.now = opts.now ?? (() => new Date());
  }

  private iso(): string { return this.now().toISOString(); }

  /** 正常同步（先拉后推 + 发布锁 + 待删门禁）。 */
  async sync(opts: S3v3SyncOptions = {}): Promise<S3v3SyncReport> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < MAX_PUBLISH_RETRIES; attempt++) {
      this.warnings = [];
      try {
        return await this.syncOnce(opts);
      } catch (e) {
        if (e instanceof PublishRetry) { lastErr = e; continue; }
        throw e;
      }
    }
    throw new S3v3SyncError("publish-conflict", "发布冲突重试超限: " + String(lastErr));
  }

  private async readPointer(): Promise<S3v3Pointer | null> {
    const bytes = await this.remote.get(S3V3_POINTER_KEY);
    if (!bytes) return null;
    const parsed = validatePointer(JSON.parse(new TextDecoder().decode(bytes)));
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
    await this.device.saveState(newState);
    await this.device.saveBaseline({ epoch: pointer.epoch, generation: pointer.generation, lakeCommit: pointer.lake.commit, quickNotesCommit: pointer.quickNotes.commit, lake, quickNotes: quick });
    return { ...report, generation: pointer.generation };
  }

  /** 云端为空 + 用户选择上传本地：初始化 epoch。 */
  private async initialUpload(state: DeviceState, report: S3v3SyncReport): Promise<S3v3SyncReport> {
    const pointer = await this.readPointer();
    if (pointer) throw new S3v3SyncError("cloud-changed", "初始化时云端已有数据");
    const { lake, quickNotes } = await this.buildAndUploadAll(state, report);
    if (!(await this.acquireLock())) throw new S3v3SyncError("lock-busy", "另一台设备正在发布同步");
    try {
      const again = await this.readPointer();
      if (again) throw new PublishRetry();
      const epoch = randomUUID();
      const lakeSerialized = serializeLakeIndex(lake);
      const quickSerialized = serializeQuickNotesIndex(quickNotes);
      const lakeCommit = indexHashOf(lakeSerialized);
      const quickCommit = indexHashOf(quickSerialized);
      await this.writeIndex("lake", lakeCommit, lakeSerialized);
      await this.writeIndex("quickNotes", quickCommit, quickSerialized);
      const p: S3v3Pointer = { v: 3, epoch, generation: 1, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: this.iso(), deviceId: this.deviceId };
      await this.remote.put(S3V3_POINTER_KEY, new TextEncoder().encode(JSON.stringify(p)));
      const check = await this.readPointer();
      if (!check || check.generation !== 1 || check.lake.commit !== lakeCommit) throw new PublishRetry();
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
    const baselineLake = baseline.lake;
    const baselineQuick = baseline.quickNotes;

    const purged = new Set(state.remotePurged ?? []);
    const restore = new Set(state.restorePending ?? []);
    const intentIds = new Set(state.intents.map((i) => i.noteId));
    const lakeLocal: LakeIndex = { v: 3, space: "lake", notes: state.lake.notes.filter((n) => !purged.has(n.id)), folders: state.folders };
    const lakePlan = planLakeMerge(baselineLake, lakeLocal, remoteLake, { restorePending: restore, purgeIntents: intentIds, folderPurgeIntents: intentIds });
    const quickPlan = planQuickNotesMerge(baselineQuick, state.quickNotes, remoteQuick, restore, intentIds);

    const lakeEntries = new Map(state.lake.notes.map((n) => [n.id, n]));
    const quickEntries = new Map(state.quickNotes.items.map((n) => [n.id, n]));
    const newLakeDecls = new Map<string, { declHash: string; filenames: string[] }>();
    const prevDecls = new Map<string, { declHash: string; filenames: string[] }>();
    const newQuickDecls = new Map<string, { declHash: string; filenames: string[] }>();
    const prevQuickDecls = new Map<string, { declHash: string; filenames: string[] }>();

    // ---- 拉取/应用远端 ----
    for (const plan of lakePlan.notes) {
      const remote = plan.remote;
      if (plan.kind === "remote-purged-trash") {
        const local = lakeEntries.get(plan.id);
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
      const local = lakeEntries.get(plan.id);
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
        lakeEntries.set(remote.id, { ...remote });
      }
    }
    for (const plan of lakePlan.notes) {
      if (plan.kind === "local-purge") {
        lakeEntries.delete(plan.id);
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
      const local = quickEntries.get(plan.id);
      if (plan.kind === "local-delete") {
        quickEntries.delete(plan.id);
        await this.device.deleteQuickBody(plan.id);
        await this.device.deleteQuickAssetsDir(plan.id);
        continue;
      }
      if (plan.kind === "local-purge") { quickEntries.delete(plan.id); continue; }
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
      quickEntries.set(remote.id, { ...remote });
    }

    // ---- 上传 ----
    for (const plan of lakePlan.notes) {
      if (!plan.uploadLocal) continue;
      const entry = lakeEntries.get(plan.id);
      if (!entry) continue;
      try {
        const body = await this.device.readBody(plan.id);
        if (!body) { this.warnings.push("本地缺正文，跳过上传: " + plan.id); continue; }
        const hash = sha256Hex(body);
        entry.contentHash = hash;
        const remoteDecl = plan.remote?.assetsHash ? await this.getDeclaration("lake", plan.id, plan.remote.assetsHash) : null;
        const decl = await this.uploadAssets("lake", plan.id, remoteDecl);
        if (decl) {
          await this.remote.put(declarationKey("lake", plan.id, decl.declHash), new TextEncoder().encode(serializeDeclaration(decl.declaration)), { gzip: true });
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
        await this.remote.put(lakeBodyKey(plan.id, hash), body);
        report.uploadedNotes++;
      } catch (e) {
        this.warnings.push("上传失败，保持 local 下轮重试: " + plan.id + " " + (e as Error).message);
      }
    }
    for (const plan of quickPlan.items) {
      if (!plan.uploadLocal) continue;
      const entry = quickEntries.get(plan.id);
      if (!entry) continue;
      try {
        const body = await this.device.readQuickBody(plan.id);
        if (!body) { this.warnings.push("本地缺小记正文，跳过上传: " + plan.id); continue; }
        entry.contentHash = sha256Hex(body);
        const remoteDecl = plan.remote?.assetsHash ? await this.getDeclaration("quickNotes", plan.id, plan.remote.assetsHash) : null;
        const decl = await this.uploadQuickAssets(plan.id, remoteDecl);
        if (decl) {
          await this.remote.put(declarationKey("quickNotes", plan.id, decl.declHash), new TextEncoder().encode(serializeDeclaration(decl.declaration)), { gzip: true });
          entry.assetsHash = decl.declHash;
          newQuickDecls.set(plan.id, { declHash: decl.declHash, filenames: decl.declaration.assets.map((a) => a.filename) });
          if (plan.remote?.assetsHash && plan.remote.assetsHash !== decl.declHash) {
            const old = await this.getDeclaration("quickNotes", plan.id, plan.remote.assetsHash);
            if (old) prevQuickDecls.set(plan.id, { declHash: plan.remote.assetsHash, filenames: old.assets.map((a) => a.filename) });
          }
        } else {
          entry.assetsHash = undefined;
        }
        await this.remote.put(quickNoteBodyKey(entry.contentHash), body);
        report.uploadedNotes++;
      } catch (e) {
        this.warnings.push("小记上传失败，保持 local 下轮重试: " + plan.id + " " + (e as Error).message);
      }
    }

    const lakeChanged = lakePlan.notes.some((p) => p.kind !== "none" || p.uploadLocal || p.applyRemote) || lakePlan.folders.some((f) => f.kind !== "none" || f.applyRemote);
    const quickChanged = quickPlan.items.some((p) => p.kind !== "none" || p.uploadLocal || p.applyRemote);
    // 本地状态保留「远端已彻底删除、本机回收站副本」（remotePurged），但不进同步索引。
    const stateNotes = [...lakeEntries.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const stateFolders = [...state.folders].sort((a, b) => (a.id < b.id ? -1 : 1));
    const newLake: LakeIndex = lakeChanged ? { v: 3, space: "lake", notes: stateNotes.filter((n) => !purged.has(n.id)), folders: stateFolders } : remoteLake;
    const newQuick: QuickNotesIndex = quickChanged ? { v: 3, space: "quickNotes", items: [...quickEntries.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), tags: state.quickNotes.tags } : remoteQuick;
    const lakeSerialized = serializeLakeIndex(newLake);
    const quickSerialized = serializeQuickNotesIndex(newQuick);
    const lakeCommit = lakeChanged ? indexHashOf(lakeSerialized) : pointer.lake.commit;
    const quickCommit = quickChanged ? indexHashOf(quickSerialized) : pointer.quickNotes.commit;
    const needPublish = lakeCommit !== pointer.lake.commit || quickCommit !== pointer.quickNotes.commit;

    if (!needPublish) {
      const restoredIds = new Set(lakePlan.notes.filter((p) => p.kind === "upload" && restore.has(p.id)).map((p) => p.id));
      const intents = this.clearIntentsOnSync(state.intents, pointer.epoch, pointer.generation, new Set(newLake.notes.map((n) => n.id)), restoredIds);
      const newState: DeviceState = { ...state, lake: { v: 3, space: "lake", notes: lakeChanged ? stateNotes : state.lake.notes, folders: stateFolders }, quickNotes: newQuick, folders: stateFolders, intents, restorePending: (state.restorePending ?? []).filter((id) => !restoredIds.has(id)) };
      await this.device.saveState(newState);
      await this.device.saveBaseline({ ...baseline, lake: newLake, quickNotes: newQuick });
      await this.executePending(newLake, newQuick, pointer.lake.commit, pointer.quickNotes.commit, state, report);
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
    if (!(await this.acquireLock())) throw new S3v3SyncError("lock-busy", "另一台设备正在发布同步，请稍后重试");
    try {
      const now = await this.readPointer();
      if (!now || now.epoch !== pointer.epoch || now.generation !== pointer.generation || now.lake.commit !== pointer.lake.commit || now.quickNotes.commit !== pointer.quickNotes.commit) {
        throw new PublishRetry();
      }
      if (lakeChanged) await this.writeIndex("lake", lakeCommit, lakeSerialized);
      if (quickChanged) await this.writeIndex("quickNotes", quickCommit, quickSerialized);
      const nextPointer: S3v3Pointer = { v: 3, epoch: pointer.epoch, generation, lake: { commit: lakeCommit }, quickNotes: { commit: quickCommit }, createdAt: this.iso(), deviceId: this.deviceId };
      await this.remote.put(S3V3_POINTER_KEY, new TextEncoder().encode(JSON.stringify(nextPointer)));
      const check = await this.readPointer();
      if (!check || check.generation !== generation || check.lake.commit !== lakeCommit || check.quickNotes.commit !== quickCommit) throw new PublishRetry();
      const restoredIds = new Set(lakePlan.notes.filter((p) => p.kind === "upload" && restore.has(p.id)).map((p) => p.id));
      const publishedPurgeIds = new Set([...lakePlan.notes.filter((p) => p.kind === "local-purge").map((p) => p.id), ...quickPlan.items.filter((p) => p.kind === "local-purge").map((p) => p.id)]);
      const updatedIntents = this.bumpIntentsAfterPublish(state.intents, pointer.epoch, generation, restoredIds, publishedPurgeIds);
      const finalState: DeviceState = { ...newState, intents: updatedIntents, restorePending: (state.restorePending ?? []).filter((id) => !restoredIds.has(id)) };
      await this.device.saveState(finalState);
      await this.device.saveBaseline({ epoch: pointer.epoch, generation, lakeCommit, quickNotesCommit: quickCommit, lake: newLake, quickNotes: newQuick });
      const deleted = await this.executePending(newLake, newQuick, lakeCommit, quickCommit, finalState, report);
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

  private async acquireLock(): Promise<boolean> {
    const raw = await this.remote.get(LOCK_KEY);
    if (raw) {
      try {
        const lock = JSON.parse(new TextDecoder().decode(raw)) as { deviceId: string; time: number; ttl: number };
        const fresh = Date.now() - lock.time < (lock.ttl ?? LOCK_TTL_MS);
        if (fresh && lock.deviceId !== this.deviceId) return false;
      } catch { /* 损坏锁按过期处理 */ }
    }
    const lock = { deviceId: this.deviceId, time: Date.now(), ttl: LOCK_TTL_MS };
    await this.remote.put(LOCK_KEY, new TextEncoder().encode(JSON.stringify(lock)));
    const check = await this.remote.get(LOCK_KEY);
    if (!check) return false;
    try { return (JSON.parse(new TextDecoder().decode(check)) as { deviceId: string }).deviceId === this.deviceId; } catch { return false; }
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
        await this.remote.put(declarationKey("lake", entry.id, decl.declHash), new TextEncoder().encode(serializeDeclaration(decl.declaration)), { gzip: true });
        entry.assetsHash = decl.declHash;
      }
      await this.remote.put(lakeBodyKey(entry.id, entry.contentHash), body);
      report.uploadedNotes++;
    }
    const quickEntries = new Map(state.quickNotes.items.map((q) => [q.id, { ...q }]));
    for (const entry of quickEntries.values()) {
      const body = await this.device.readQuickBody(entry.id);
      if (!body) { this.warnings.push("缺小记正文，跳过初始化上传: " + entry.id); continue; }
      entry.contentHash = sha256Hex(body);
      const decl = await this.uploadQuickAssets(entry.id, null);
      if (decl) {
        await this.remote.put(declarationKey("quickNotes", entry.id, decl.declHash), new TextEncoder().encode(serializeDeclaration(decl.declaration)), { gzip: true });
        entry.assetsHash = decl.declHash;
      }
      await this.remote.put(quickNoteBodyKey(entry.contentHash), body);
      report.uploadedNotes++;
    }
    return {
      lake: { v: 3, space: "lake", notes: [...lakeEntries.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), folders: state.folders },
      quickNotes: { v: 3, space: "quickNotes", items: [...quickEntries.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), tags: state.quickNotes.tags },
    };
  }

  private async uploadAssets(space: "lake" | "quickNotes", id: string, remoteDecl: AssetDeclaration | null): Promise<ReturnType<typeof buildAssetDeclaration> | null> {
    const filenames = space === "lake" ? await this.device.listAssets(id) : await this.device.listQuickAssets(id);
    if (filenames.length === 0) return null;
    const entries = [];
    const remoteFiles = new Set((remoteDecl?.assets ?? []).map((a) => a.filename));
    for (const filename of filenames) {
      const bytes = space === "lake" ? await this.device.readAsset(id, filename) : await this.device.readQuickAsset(id, filename);
      if (!bytes) continue;
      const hash = sha256Hex(bytes);
      entries.push({ filename, size: bytes.length, hash });
      if (!remoteFiles.has(filename)) {
        await this.remote.put(space === "lake" ? assetKey(id, filename) : quickNoteAssetKey(id, filename), bytes);
      }
    }
    return buildAssetDeclaration(entries);
  }

  private async uploadQuickAssets(id: string, remoteDecl: AssetDeclaration | null) {
    return this.uploadAssets("quickNotes", id, remoteDecl);
  }

  private async downloadAssets(id: string, declHash?: string): Promise<AssetDeclaration | null> {
    if (!declHash) { return null; }
    const decl = await this.getDeclaration("lake", id, declHash);
    if (!decl) { this.warnings.push("缺资产声明: " + id); return null; }
    for (const a of decl.assets) {
      const bytes = await this.remote.get(assetKey(id, a.filename));
      if (!bytes) { this.warnings.push("缺附件: " + id + "/" + a.filename); continue; }
      if (bytes.length !== a.size || sha256Hex(bytes) !== a.hash) { this.warnings.push("附件校验失败: " + id + "/" + a.filename); continue; }
      await this.device.writeAsset(id, a.filename, bytes);
    }
    return decl;
  }
  private async downloadQuickAssets(id: string, declHash?: string): Promise<AssetDeclaration | null> {
    if (!declHash) return null;
    const decl = await this.getDeclaration("quickNotes", id, declHash);
    if (!decl) { this.warnings.push("缺小记图片声明: " + id); return null; }
    for (const a of decl.assets) {
      const bytes = await this.remote.get(quickNoteAssetKey(id, a.filename));
      if (!bytes) { this.warnings.push("缺小记图片: " + id + "/" + a.filename); continue; }
      if (bytes.length !== a.size || sha256Hex(bytes) !== a.hash) { this.warnings.push("小记图片校验失败: " + id + "/" + a.filename); continue; }
      await this.device.writeQuickAsset(id, a.filename, bytes);
    }
    return decl;
  }

  /** 全量重拉（epoch/回滚/换桶后由 UI 调用）：云端赢，本地多出的归档。 */
  async resetFromCloud(): Promise<S3v3SyncReport> {
    const pointer = await this.readPointer();
    if (!pointer) throw new S3v3SyncError("pointer-corrupt", "云端没有 pointer，无法全量重拉");
    const state = (await this.device.loadState()) ?? emptyState();
    return this.pullAll(pointer, { ...state, pending: [] }, { downloadedNotes: 0, uploadedNotes: 0, deletedObjects: 0, published: false, generation: null, warnings: [] }, true);
  }
}
