import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { TRASH_NOTEBOOK_ID, type Store } from "../store.js";
import type { QuickNotesStore } from "../quickNotes.js";
import type { SyncNote } from "../noteQueries.js";
import type { LakeFolderEntry, LakeNoteEntry, QuickNoteEntry, QuickNoteTagEntry } from "../../src/core/s3v3Index.js";
import { sha256Hex } from "../../src/core/syncUtils.js";
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "./deviceStore.js";

/**
 * 桌面现有 Store → S3v3DeviceStore 适配器（v1：Lake 文档/目录/附件）。
 * - 元数据以 Store 为准；sync 专属状态（baseline/intents/pending/remotePurged/restorePending/assetsHash）落 sidecar。
 * - 小记暂不支持：检测到 quick-notes 库即抛错，绝不静默跳过。
 */
export class DesktopStoreDevice implements S3v3DeviceStore {
  private readonly store: Store;
  private readonly stateFile: string;
  private readonly baselineFile: string;
  private readonly stagingDir: string;
  private stagedBodies = new Map<string, Uint8Array>();
  private stagedAssets = new Map<string, Map<string, Uint8Array>>();
  private clearedAssets = new Set<string>();
  private readonly skipQuickNotesGuard: boolean;
  /** 正文 hash 缓存：文件 mtime+size 未变则复用，避免每轮全库读正文。首次/变更文件才重算。 */
  private hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();
  private readonly quickNotes?: QuickNotesStore;

  constructor(store: Store, storeRoot: string, opts: { stateFile?: string; baselineFile?: string; skipQuickNotesGuard?: boolean; quickNotes?: QuickNotesStore } = {}) {
    this.skipQuickNotesGuard = !!opts.skipQuickNotesGuard;
    this.quickNotes = opts.quickNotes;
    this.store = store;
    const dir = path.join(storeRoot, "sync-v3");
    this.stateFile = opts.stateFile ?? path.join(dir, "state.json");
    this.baselineFile = opts.baselineFile ?? path.join(dir, "baseline.json.gz");
    this.stagingDir = path.join(dir, "staging");
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.mkdir(this.stagingDir, { recursive: true });
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

  private sidecarShape(state: DeviceState) {
    return {
      intents: state.intents, pending: state.pending, quickPurgeTimes: state.quickPurgeTimes ?? {},
      remotePurged: state.remotePurged ?? [], restorePending: state.restorePending ?? [], archived: state.archived ?? [],
      assetsHash: Object.fromEntries(state.lake.notes.map((n) => [n.id, n.assetsHash]).filter(([, v]) => v)),
      quickAssetsHash: Object.fromEntries((state.quickNotes.items ?? []).map((n) => [n.id, n.assetsHash]).filter(([, v]) => v)),
      hashCache: Object.fromEntries(this.hashCache),
    };
  }

  async loadState(): Promise<DeviceState | null> {
    const folders: LakeFolderEntry[] = this.store.listFoldersForSync().map((f) => ({
      id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType, icon: f.icon, updatedAt: f.updatedAt,
      ...(f.trashedAt !== undefined && f.trashedAt !== null ? { trashedAt: f.trashedAt } : {}),
      ...(f.deletedFromParentId !== undefined && f.deletedFromParentId !== null ? { deletedFromParentId: f.deletedFromParentId } : {}),
    }));
    const side = await this.readJson<{ intents: DeviceState["intents"]; pending: DeviceState["pending"]; quickPurgeTimes?: Record<string, string>; remotePurged: string[]; restorePending: string[]; archived: DeviceState["archived"]; assetsHash: Record<string, string>; quickAssetsHash?: Record<string, string>; hashCache?: Record<string, { mtimeMs: number; size: number; hash: string }> }>(this.stateFile);
    this.hashCache = new Map(Object.entries(side?.hashCache ?? {}));
    const notes: LakeNoteEntry[] = [];
    // 单 SQL 轻量元数据：避免逐篇 getNoteInfo（读正文/算字数/扫资产卡片，20k 文档会退化到秒级+）
    for (const n of this.store.listNotesSyncMeta()) {
      let contentHash = n.contentHash;
      if (!contentHash) {
        const lakePath = this.store.getNotePaths(n.id).lakePath;
        let stat: { mtimeMs: number; size: number };
        try { stat = await fs.stat(lakePath); }
        catch {
          // P0：正文文件被删后，sidecar 里的 hash 缓存必须失效；否则 saveState 会误以为
          // 「本地已有同 hash 正文」而跳过落盘，云端拉回的正文永远不恢复（0 PUT/0 警告/不恢复）。
          this.hashCache.delete(n.id);
          continue;
        }
        const cached = this.hashCache.get(n.id);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) contentHash = cached.hash;
        else {
          try { contentHash = sha256Hex(await fs.readFile(lakePath)); } catch { continue; }
          this.hashCache.set(n.id, { mtimeMs: stat.mtimeMs, size: stat.size, hash: contentHash });
        }
      }
      if (!contentHash) continue;
      notes.push({
        id: n.id, title: n.title, parentId: n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt, contentHash,
        ...(n.kind && n.kind !== "doc" ? { kind: n.kind } : {}), ...(n.icon !== null ? { icon: n.icon } : {}),
        isLocked: n.isEditLocked, lockedAt: n.editLockedAt, isConflict: n.isConflict,
        ...(n.trashedAt ? { trashedAt: n.trashedAt } : {}), ...(n.deletedFromParentId !== null ? { deletedFromParentId: n.deletedFromParentId } : {}),
        ...(side?.assetsHash?.[n.id] ? { assetsHash: side.assetsHash[n.id] } : {}),
      });
    }
    const quickItems: QuickNoteEntry[] = [];
    const quickTags: QuickNoteTagEntry[] = [];
    const quickDeletes: string[] = [];
    const quickPurges: string[] = [];
    const quickPurgeTimes: Record<string, string> = { ...(side?.quickPurgeTimes ?? {}) };
    if (this.quickNotes) {
      for (const q of this.quickNotes.listQuickNotesForSync()) {
        const tagIds = this.quickNotes.listQuickNoteTagIds(q.id);
        const tagsUpdatedAt = this.quickNotes.links.tagsUpdatedAt(q.id);
        quickItems.push({
          id: q.id, createdAt: q.createdAt, updatedAt: q.updatedAt, contentHash: q.contentHash,
          ...(q.isConflict ? { isConflict: true } : {}),
          ...(side?.quickAssetsHash?.[q.id] ? { assetsHash: side.quickAssetsHash[q.id] } : {}),
          ...(tagIds.length ? { tagIds } : {}),
          ...(tagsUpdatedAt ? { tagsUpdatedAt } : {}),
        });
      }
      for (const t of this.quickNotes.tags.list({ includeDeleted: true })) {
        quickTags.push({ id: t.id, name: t.name, sortOrder: t.sortOrder, pinned: t.pinned, createdAt: t.createdAt, updatedAt: t.updatedAt, ...(t.deletedAt ? { deletedAt: t.deletedAt } : {}) });
      }
      for (const d of this.quickNotes.listAllDeleted()) {
        quickDeletes.push(d.id);
        if (d.purgedAt) { quickPurges.push(d.id); quickPurgeTimes[d.id] = d.purgedAt; }
      }
    }
    // 本地 purge（deleted_notes.purged_at）→ v3 删除意图：否则远端条目会被当成“本地缺失”重新拉回。
    const baseline = await this.loadBaseline();
    const intents = [...(side?.intents ?? [])];
    const knownIntents = new Set(intents.map((it) => it.noteId));
    for (const t of this.store.listPurgedTombstones()) {
      if (knownIntents.has(t.id)) continue;
      intents.push({ noteId: t.id, targetEpoch: baseline?.epoch ?? "", targetGeneration: baseline?.generation ?? 0, ...(t.purgedAt ? { purgedAt: t.purgedAt } : {}) });
    }
    // 显式恢复标记以 DB 为准（restoreTrashItem 写 notes.restore_pending_at、restoreQuickNote 写
    // quick_notes.restore_pending_at）：引擎只认 state.restorePending。sidecar 里的是上次未收尾的残留，
    // 两者取并集（缺了它 ⇒ 用户已恢复的副本会被当成「本地缺失」，永远不重新上传）。
    const restorePending = [...new Set([
      ...(side?.restorePending ?? []),
      ...this.store.listRestorePendingNoteIds(),
      ...(this.quickNotes?.listRestorePendingQuickNoteIds() ?? []),
    ])].sort();
    const state: DeviceState = {
      lake: { v: 3, space: "lake", notes, folders },
      quickNotes: { v: 3, space: "quickNotes", items: quickItems, tags: quickTags, ...(quickPurges.length ? { purged: quickPurges } : {}) },
      quickDeletes,
      quickPurges,
      quickPurgeTimes,
      folders,
      intents, pending: side?.pending ?? [],
      remotePurged: side?.remotePurged ?? [], restorePending, archived: side?.archived ?? [],
    };
    return state;
  }

  async saveState(state: DeviceState): Promise<void> {
    // 目录必须先于文档落库：他端新建的笔记本/分组 id 在本地还不存在，先建目录才能建子文档。
    // 删除目录则放到文档之后（避免先删父目录导致子文档归位失败）。
    await this.saveFolders(state.folders, false);
    const current = new Map(this.store.listNotesSyncMeta().map((n) => [n.id, n]));
    const wanted = new Map(state.lake.notes.map((n) => [n.id, n]));
    for (const n of wanted.values()) {
      const content = this.stagedBodies.has(n.id) ? new TextDecoder().decode(this.stagedBodies.get(n.id)) : null;
      const cur = current.get(n.id);
      const curHash = cur ? (this.hashCache.get(n.id)?.hash ?? cur.contentHash) : "";
      try {
        if (!cur) {
          // 走 importRemoteNote：它支持原样 id / 远端 trashedAt / deletedFromParentId / 冲突标记，
          // 而 createNoteInAtTopWithContent 会拒绝“回收站”父目录（他端已删文档首次拉取会炸）。
          const staged = this.stagedAssets.get(n.id) ?? new Map<string, Uint8Array>();
          const assets = [...staged.entries()].map(([filename, bytes]) => ({ filename, bytes: Buffer.from(bytes) }));
          const syncNote = {
            id: n.id, title: n.title, parentId: n.trashedAt ? TRASH_NOTEBOOK_ID : n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt,
            contentHash: n.contentHash, isConflict: !!n.isConflict, isEditLocked: !!n.isLocked,
            editLockedAt: n.lockedAt ?? null, icon: n.icon ?? null, trashedAt: n.trashedAt ?? null,
            deletedFromParentId: n.deletedFromParentId ?? null, kind: n.kind ?? "doc",
          };
          this.store.importRemoteNote(syncNote as never, Buffer.from(content ?? "", "utf8"), assets);
          if (n.icon) this.store.setNodeIcon(n.id, n.icon);
        } else {
          // 只有引擎真的写入了新正文（staged）才保存，避免每轮读全库正文
          const contentChanged = content !== null && sha256Hex(new TextEncoder().encode(content)) !== curHash;
          if (contentChanged) {
            const bodyPath = this.store.notePathFor(n.id);
            if (await this.exists(bodyPath)) {
              this.store.saveNote(n.id, n.title, content);
            } else {
              // P0：本地正文文件被删（DB 行还在）⇒ 普通 saveNote 会以「笔记不存在」拒绝；
              // 这是「从云端拉回正文」的恢复路径，必须走 importRemoteNote 重建文件。
              const staged = this.stagedAssets.get(n.id) ?? new Map<string, Uint8Array>();
              const assets = [...staged.entries()].map(([filename, bytes]) => ({ filename, bytes: Buffer.from(bytes) }));
              this.store.importRemoteNote({
                id: n.id, title: n.title, parentId: n.trashedAt ? TRASH_NOTEBOOK_ID : n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt,
                contentHash: n.contentHash, isConflict: !!n.isConflict, isEditLocked: !!n.isLocked,
                editLockedAt: n.lockedAt ?? null, ...(n.icon !== undefined ? { icon: n.icon } : {}),
                trashedAt: n.trashedAt ?? null, deletedFromParentId: n.deletedFromParentId ?? null, kind: n.kind ?? "doc",
              } as never, Buffer.from(content), assets);
            }
          }
          if (n.trashedAt && !cur.trashedAt) {
            // 远端墓碑 → 回收站：必须走 deleteNote（不能 moveTreeNode 到回收站隐藏笔记本）
            this.store.deleteNote(n.id);
          } else if (!n.trashedAt && cur.trashedAt) {
            this.store.restoreTrashItem(n.id);
          }
          // P1（v3 空发布抖动根因）：本轮合并结果的元数据必须原样落库，尤其 updatedAt。
          // 只按字段调 moveTreeNode/setNodeIcon 时它们会用 now() 改写 updated_at，且正文未变时
          // 根本不会写 updated_at ⇒ 本地行永远停留在旧时间戳，下一轮三方合并又把它判成
          // 「本地元数据更新/远端元数据更新」再发布一次，两端空跑隔轮各 +1 generation。
          const metaDiffers = contentChanged
            || (!!n.trashedAt !== !!cur.trashedAt)
            || n.updatedAt !== cur.updatedAt
            || n.title !== cur.title
            || (n.parentId ?? null) !== (cur.parentId ?? null)
            || n.sortOrder !== cur.sortOrder
            || !!n.isConflict !== !!cur.isConflict
            || (n.trashedAt ?? null) !== (cur.trashedAt ?? null)
            || (n.deletedFromParentId ?? null) !== (cur.deletedFromParentId ?? null)
            || (n.icon !== undefined && (cur.icon ?? null) !== (n.icon ?? null));
          if (metaDiffers) {
            const syncNote: SyncNote = {
              id: n.id, title: n.title, parentId: n.trashedAt ? TRASH_NOTEBOOK_ID : n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt,
              isConflict: !!n.isConflict, isEditLocked: !!n.isLocked, editLockedAt: n.lockedAt ?? null,
              ...(n.icon !== undefined ? { icon: n.icon } : {}),
              trashedAt: n.trashedAt ?? null, deletedFromParentId: n.deletedFromParentId ?? null,
              kind: n.kind as SyncNote["kind"],
            };
            this.store.applyRemoteNoteMeta(syncNote);
          }
          if (!!cur.isEditLocked !== !!n.isLocked || (cur.editLockedAt ?? null) !== (n.lockedAt ?? null)) {
            this.store.applyRemoteEditLock(n.id, !!n.isLocked, n.lockedAt ?? null);
          }
        }
        if (this.stagedAssets.has(n.id) || this.clearedAssets.has(n.id)) await this.flushStagedAssets(n.id);
        if (content !== null) {
          try {
            const lakePath = this.store.getNotePaths(n.id).lakePath;
            const st = await fs.stat(lakePath);
            this.hashCache.set(n.id, { mtimeMs: st.mtimeMs, size: st.size, hash: sha256Hex(new TextEncoder().encode(content)) });
          } catch { /* 文件缺失时下轮重新计算 */ }
        }
      } catch (e) {
        throw new Error("DesktopStoreDevice.saveState 失败(" + n.id + "): " + (e as Error).message);
      }
    }
    for (const cur of current.values()) {
      if (wanted.has(cur.id)) continue;
      this.hashCache.delete(cur.id);
      try { this.store.deleteNote(cur.id); this.store.purgeTrashItem(cur.id); } catch { /* 已不在 */ }
    }
    await this.saveQuickNotes(state);
    await this.saveFolders(state.folders, true);
    // 引擎持久化的 remotePurged（远端已彻底删除、本机保留回收站副本）→ 本地展示位 cloud_deleted。
    // 只保留「本地仍有行」的 id：本地主动 purge 后行已物理删除，必须从 sidecar 清掉——
    // 否则永远打标、且引擎每轮都把它当已删条目空转（本地 purge 后不得再有任何 S3 行为）。
    const remotePurged = (state.remotePurged ?? []).filter((id) => this.store.hasNote(id));
    this.store.applyNotesCloudDeleted(remotePurged);
    await this.writeAtomic(this.stateFile, JSON.stringify({ ...this.sidecarShape(state), remotePurged }));
    this.stagedBodies.clear();
    this.stagedAssets.clear();
    this.clearedAssets.clear();
  }

  private async saveQuickNotes(state: DeviceState): Promise<void> {
    if (!this.quickNotes) return;
    const qn = this.quickNotes;
    const current = new Map(qn.listQuickNotesForSync().map((q) => [q.id, q] as const));
    const wanted = new Map(state.quickNotes.items.map((q) => [q.id, q] as const));
    for (const item of wanted.values()) {
      const cur = current.get(item.id);
      try {
        if (!cur || cur.contentHash !== item.contentHash) {
          const body = await this.readQuickBody(item.id);
          if (!body) throw new Error("缺小记正文");
          const assets: Array<{ filename: string; bytes: Buffer }> = [];
          for (const filename of await this.listQuickAssets(item.id)) {
            const bytes = await this.readQuickAsset(item.id, filename);
            if (bytes) assets.push({ filename, bytes: Buffer.from(bytes) });
          }
          qn.importRemoteQuickNote({ id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, contentHash: item.contentHash, isConflict: !!item.isConflict }, Buffer.from(body), assets);
        } else {
          // 本地上传成功：仅当同步期间未被编辑才标 synced（I2 守卫）。
          qn.markSyncedIfUnchanged(item.id, item.contentHash);
        }
        qn.applyRemoteQuickNoteTagLinks(item.id, item.tagIds ?? [], item.tagsUpdatedAt ?? "");
      } catch (err) {
        throw new Error("DesktopStoreDevice.saveQuickNotes 失败(" + item.id + "): " + (err as Error).message);
      }
    }
    // 合并标签目录（含墓碑；LWW 在 QuickNoteTagsStore 内）。
    qn.tags.mergeRemote((state.quickNotes.tags ?? []).map((t) => ({
      id: t.id, name: t.name, sortOrder: t.sortOrder ?? t.order ?? 0, pinned: !!t.pinned,
      createdAt: t.createdAt, updatedAt: t.updatedAt, deletedAt: t.deletedAt ?? null,
    })));
    const remoteDeletedQuickIds: string[] = [];
    for (const cur of current.values()) {
      if (wanted.has(cur.id)) continue;
      const purge = state.intents.some((it) => it.noteId === cur.id) || (state.quickPurges ?? []).includes(cur.id);
      try {
        if (purge) {
          try { qn.purgeQuickNote(cur.id); }
          catch { qn.deleteQuickNote(cur.id); qn.purgeQuickNote(cur.id); }
        } else {
          // 远端彻底删除（不是本地 purge）：进回收站保留正文/附件，并打「云端已删除 · 仅本地」标。
          // 本地主动 purge 走上面的分支——purgeQuickNote 会显式清标，之后不得再有任何 S3 行为。
          qn.deleteQuickNote(cur.id);
          remoteDeletedQuickIds.push(cur.id);
        }
      } catch { /* 已不在 active */ }
    }
    if (remoteDeletedQuickIds.length > 0) qn.markQuickNoteTrashCloudDeleted(remoteDeletedQuickIds);
  }

  private async saveFolders(folders: LakeFolderEntry[], deleteMissing: boolean): Promise<void> {
    const cur = new Map(this.store.listFoldersForSync().map((f) => [f.id, f]));
    for (const f of folders) {
      const c = cur.get(f.id);
      try {
        if (!c) {
          // 远端目录 id 必须原样落库（createNotebook/createGroup 会生成新 id，跨端子文档将找不到父）
          this.store.importRemoteFolder(f as never);
        } else {
          // P1（v3 空发布抖动根因）：目录同样要把合并结果的 updatedAt/元数据原样落库。
          // moveTreeNode/setNodeIcon 会改成 now()，且不能把「远端较旧但胜出」的时间戳写回；
          // 本地行时间戳一旦与 baseline 不一致，下一轮就再发布一次（隔轮 +1 generation）。
          const changed = c.title !== f.title
            || (c.parentId ?? null) !== (f.parentId ?? null)
            || c.sortOrder !== f.sortOrder
            || (c.icon ?? null) !== (f.icon ?? null)
            || c.updatedAt !== f.updatedAt;
          if (changed) this.store.applyRemoteFolderMeta(f);
        }
      } catch (e) { throw new Error("DesktopStoreDevice.saveFolders 失败(" + f.id + "): " + (e as Error).message); }
    }
    if (deleteMissing) for (const c of cur.values()) if (!folders.some((f) => f.id === c.id)) { try { this.store.deleteTreeNode(c.id); } catch { /* ignore */ } }
  }

  private async flushStagedAssets(noteId: string): Promise<void> {
    const dir = this.store.getNotePaths(noteId).assetsDir;
    const staged = this.stagedAssets.get(noteId);
    if (staged) {
      await fs.mkdir(dir, { recursive: true });
      for (const [filename, bytes] of staged) await fs.writeFile(path.join(dir, filename), bytes);
    }
    if (this.clearedAssets.has(noteId)) await fs.rm(dir, { recursive: true, force: true });
  }

  async loadBaseline(): Promise<DeviceBaseline | null> {
    try { return JSON.parse(gunzipSync(await fs.readFile(this.baselineFile)).toString("utf8")) as DeviceBaseline; } catch { return null; }
  }
  async saveBaseline(baseline: DeviceBaseline): Promise<void> {
    await this.writeAtomic(this.baselineFile, gzipSync(Buffer.from(JSON.stringify(baseline)), { level: 1 }));
    // baseline 只在发布成功后写 ⇒ 这里批量清 UI dirty；20k 也只两条批量 UPDATE。
    this.store.markNotesSynced(baseline.lake.notes.map((n) => n.id));
  }

  async readBody(id: string): Promise<Uint8Array | null> {
    const staged = this.stagedBodies.get(id);
    if (staged) return staged;
    try {
      const doc = this.store.readNote(id);
      if (doc.bodyMissing) return null;
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

  async listAssets(id: string): Promise<string[]> {
    const dir = this.store.getNotePaths(id).assetsDir;
    let files: string[] = [];
    try { files = await fs.readdir(dir); } catch { /* none */ }
    const staged = this.stagedAssets.get(id);
    return [...new Set([...files.filter((f) => !f.includes(".tmp")), ...(staged ? [...staged.keys()] : [])])].sort();
  }
  async readAsset(id: string, filename: string): Promise<Uint8Array | null> {
    const staged = this.stagedAssets.get(id)?.get(filename);
    if (staged) return staged;
    const got = this.store.readAssetBytes(id, filename);
    return got ? new Uint8Array(got.bytes) : null;
  }
  async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    let map = this.stagedAssets.get(id); if (!map) { map = new Map(); this.stagedAssets.set(id, map); }
    map.set(filename, bytes);
  }
  async deleteAssetsDir(id: string): Promise<void> { this.clearedAssets.add(id); }

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
  async listQuickAssets(id: string): Promise<string[]> {
    if (!this.quickNotes) return [];
    try { return (await fs.readdir(this.quickNotes.quickNoteAssetsPathFor(id))).filter((f) => !f.includes(".tmp")).sort(); } catch { return []; }
  }
  async readQuickAsset(id: string, filename: string): Promise<Uint8Array | null> {
    if (!this.quickNotes) return null;
    try { return new Uint8Array(await fs.readFile(path.join(this.quickNotes.quickNoteAssetsPathFor(id), filename))); } catch { return null; }
  }
  async writeQuickAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    if (!this.quickNotes) throw new Error("quickNotes 未注入");
    const dir = this.quickNotes.quickNoteAssetsPathFor(id);
    await fs.mkdir(dir, { recursive: true });
    await this.writeAtomic(path.join(dir, filename), bytes);
  }
  async deleteQuickAssetsDir(id: string): Promise<void> {
    if (!this.quickNotes) return;
    try { await fs.rm(this.quickNotes.quickNoteAssetsPathFor(id), { recursive: true, force: true }); } catch { /* ignore */ }
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
