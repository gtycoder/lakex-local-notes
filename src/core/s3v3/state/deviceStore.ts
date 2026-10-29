/**
 * 单一 DeviceStore 实现（E2-4）。
 *
 * - **phase A（261029）**：文件型资产 IO 共享 + 落盘标记合并（`createFileBackedAssetIo` / `mergeSyncMarkers`）。
 * - **phase B（261029）**：把 `loadState / saveState / saveFolders / saveQuickNotes` 的**决策与映射**
 *   收进本文件（`createDeviceStoreMeta`），平台侧只实现 `PlatformDataPort` + `FileDriver` 的窄 CRUD。
 *   桌面适配器已切到本实现（薄壳）；移动端 phase C 用同一实现（需先实现相同端口）。
 *
 * 语义边界：
 * - **不做决策的平台代码**：合并/LWW/墓碑判定/信封推导/父目录兜底/回收站软删时机全在这里；
 *   平台端口只落库（幂等），不参与判断。
 * - world（lake/quickNotes/folders）由本层用端口投影重建，不写进信封（E3-1）。
 * - 资产目录 IO 与信封持久化仍走 `FileDriver` / 注入的 `state`/`baseline` 端口。
 *
 * 约束：core 不 import electron/node；只依赖 core 类型、`FileDriver`、`PlatformDataPort`。
 */
import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "../../s3v3DeviceStore.js";
import type { LakeFolderEntry, LakeNoteEntry, QuickNoteEntry, QuickNoteTagEntry } from "../protocol/s3v3Index.js";
import { TRASH_NOTEBOOK_ID } from "../../syncDecisions.js";
import { normalizeNoteKind, type NoteKind } from "../../noteKind.js";
import { searchTextForKind } from "../../noteSearchText.js";
import { sha256Hex } from "../../syncUtils.js";
import type { FileDriver } from "./ports.js";
import type { IntentLogStateV3 } from "./intentLogState.js";
import { ledgerOf, migratePersisted, mergeSyncMarkers, persistedNeedsMigration, toPersistedState } from "./intentLogState.js";

/** 信封标记合并的唯一实现（intentLogState.ts）；这里 re-export 保持既有导入点（适配器/测试）。 */
export { mergeSyncMarkers };
import { settleCloudDeleted } from "./cloudDeleted.js";
import type { PlatformDataPort, QuickNoteSyncRow, QuickTagRow, SyncFolderRow, SyncNoteMetaRow } from "./platformPort.js";

/** 资源文件名白名单（驱动/声明/键都已校验；这里是 SEC-13a 的纵深防御，单一来源）。 */
export const SAFE_ASSET_FILENAME = /^[A-Za-z0-9._-]+$/;

/** 文件名是否是"写入中"的临时文件（原子写的 tmp 后缀；列目录时必须过滤）。 */
function isTempFile(name: string): boolean {
  return name.includes(".tmp");
}

/** 资产 IO 需要实现的端口方法子集。 */
export type AssetIoPort = Pick<S3v3DeviceStore,
  "listAssets" | "readAsset" | "writeAsset" | "deleteAssetsDir" |
  "listQuickAssets" | "readQuickAsset" | "writeQuickAsset" | "deleteQuickAssetsDir" |
  "assetNativePath" | "assetNativePathFor"
>;

export interface AssetIoConfig {
  files: FileDriver;
  /** 文档资产目录（`assets/{noteId}` 的平台命名空间路径）。 */
  assetDirFor: (noteId: string) => string;
  /** 小记资产目录；不接小记的端不给（= 桌面未注入 quickNotes 的语义）。 */
  quickAssetDirFor?: (quickNoteId: string) => string;
  /** 删文档资产目录（桌面把真删延迟到正文/行落库之后；不给 = 立即递归删）。 */
  removeAssetsDir?: (noteId: string) => Promise<void>;
  /** 删小记资产目录（同上）。 */
  removeQuickAssetsDir?: (quickNoteId: string) => Promise<void>;
  /** 平台原生资产路径（移动端流式传输用）；不给 = 引擎走 JS 字节路径（桌面）。 */
  nativeAssetPathFor?: (space: "lake" | "quickNotes", id: string, filename: string) => Promise<string | null>;
}

/** 文件型资产/小记资产 IO（两端同语义；路径与删除时机由配置决定）。 */
export function createFileBackedAssetIo(cfg: AssetIoConfig): AssetIoPort {
  const { files } = cfg;
  const quickDir = cfg.quickAssetDirFor;
  const port: AssetIoPort = {
    async listAssets(noteId: string): Promise<string[]> {
      try {
        const names = await files.list(cfg.assetDirFor(noteId));
        return names.filter((n) => !isTempFile(n)).sort();
      } catch { return []; }
    },
    async readAsset(noteId: string, filename: string): Promise<Uint8Array | null> {
      if (!SAFE_ASSET_FILENAME.test(filename)) return null;
      try { return await files.read(join(cfg.assetDirFor(noteId), filename)); } catch { return null; }
    },
    async writeAsset(noteId: string, filename: string, bytes: Uint8Array): Promise<void> {
      if (!SAFE_ASSET_FILENAME.test(filename)) throw new Error("非法资源文件名: " + filename);
      const dir = cfg.assetDirFor(noteId);
      await files.mkdir(dir);
      await files.writeAtomic(join(dir, filename), bytes);
    },
    async deleteAssetsDir(noteId: string): Promise<void> {
      if (cfg.removeAssetsDir) return await cfg.removeAssetsDir(noteId);
      await files.removeDir(cfg.assetDirFor(noteId));
    },
    async listQuickAssets(quickNoteId: string): Promise<string[]> {
      if (!quickDir) return [];
      try {
        const names = await files.list(quickDir(quickNoteId));
        return names.filter((n) => !isTempFile(n)).sort();
      } catch { return []; }
    },
    async readQuickAsset(quickNoteId: string, filename: string): Promise<Uint8Array | null> {
      if (!quickDir || !SAFE_ASSET_FILENAME.test(filename)) return null;
      try { return await files.read(join(quickDir(quickNoteId), filename)); } catch { return null; }
    },
    // SEC-13a：与 writeAsset 同一断言（纵深防御，不依赖上游声明校验）。
    async writeQuickAsset(quickNoteId: string, filename: string, bytes: Uint8Array): Promise<void> {
      if (!SAFE_ASSET_FILENAME.test(filename)) throw new Error("非法资源文件名: " + filename);
      if (!quickDir) throw new Error("quickNotes 未注入");
      const dir = quickDir(quickNoteId);
      await files.mkdir(dir);
      await files.writeAtomic(join(dir, filename), bytes);
    },
    async deleteQuickAssetsDir(quickNoteId: string): Promise<void> {
      if (!quickDir) return;
      if (cfg.removeQuickAssetsDir) return await cfg.removeQuickAssetsDir(quickNoteId);
      await files.removeDir(quickDir(quickNoteId));
    },
  };
  if (cfg.nativeAssetPathFor) {
    const native = cfg.nativeAssetPathFor;
    port.assetNativePathFor = (space, id, filename) => native(space, id, filename);
    // 旧引擎兜底口径：assetNativePath 只服务 lake 空间。
    port.assetNativePath = (id, filename) => native("lake", id, filename);
  }
  return port;
}

/** 路径拼接（core 禁 node:path；驱动路径是不透明字符串，两端都用 "/" 语义）。 */
function join(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : dir + "/" + name;
}

// ============================================================
// phase B：loadState / saveState / saveFolders / saveQuickNotes 的单一编排
// ============================================================

/** 信封持久化端口：core 只生成/迁移信封，落盘归平台（桌面 sidecar 文件 / 移动 SQLite 行）。 */
export interface StateStorePort {
  /** 读原始 JSON（未迁移；null = 无状态）。 */
  read(): Promise<unknown>;
  write(persisted: IntentLogStateV3): Promise<void>;
}

/** baseline 读取端口（saveState 推导删除意图的 target 世代用；写入仍归平台）。 */
export interface BaselineReadPort {
  load(): Promise<DeviceBaseline | null>;
}

export interface DeviceStoreMetaDeps {
  platform: PlatformDataPort;
  files: FileDriver;
  assets: AssetIoPort;
  state: StateStorePort;
  baseline: BaselineReadPort;
  /** 引擎 writeBody 的正文 staging（saveState 消费并清空）——平台适配器持有。
   *  桌面 = 内存字节（get 有值）；移动 = staging 文件（只有 has=true，正文由 `moveStagedBodyFiles` 搬）。 */
  stagedBodies: {
    get(noteId: string): Uint8Array | undefined;
    has?(noteId: string): boolean;
    clear(): void;
  };
  /** 桌面正文 hash 缓存（mtime+size→sha256）；移动不传（DB 行自带 hash）。 */
  hashCache?: Map<string, { mtimeMs: number; size: number; hash: string }>;
  /** 本轮兜底创建/复用的目录 id（deleteMissing 不得删）。 */
  protectedFolderIds?: Set<string>;
  /** loadState 观察到缺正文队列非空（决定 saveState 收尾是否清库）。 */
  markRecoverySeen?: (seen: boolean) => void;
  /** saveState 已消费恢复队列（平台复位标记）。 */
  recoveryConsumed?: () => void;
  /** 行/正文落库后真删资产目录（桌面延迟删；不传 = 平台已在 deleteAssetsDir 立即删）。 */
  flushAssetDirDeletion?: (noteId: string) => Promise<void>;
  clearAssetDirDeletions?: () => void;
  log?: (message: string) => void;
}

export interface DeviceStoreMeta {
  loadState(): Promise<DeviceState>;
  saveState(state: DeviceState): Promise<void>;
}

/**
 * 单一编排实现（桌面已切换；移动 phase C 复用）。等价性由 `deviceStoreMeta.test.ts`（内存端口 fixture）
 * 与 electron/s3v3 全量 conformance 共同锁住。
 */
export function createDeviceStoreMeta(deps: DeviceStoreMetaDeps): DeviceStoreMeta {
  const { platform: p, files, assets } = deps;
  const hashCache = deps.hashCache ?? new Map<string, { mtimeMs: number; size: number; hash: string }>();
  const protectedFolders = deps.protectedFolderIds ?? new Set<string>();

  /** C5 父目录兜底：远端 parent 必须能在本机解析后才落库（其余回落兜底笔记本并保护不被删）。 */
  async function resolveRemoteParent(parentId: string | null): Promise<string | null> {
    if (parentId === null || parentId === TRASH_NOTEBOOK_ID) return parentId;
    if (await p.hasTreeNode(parentId)) return parentId;
    try {
      const id = await p.defaultNotebookId();
      protectedFolders.add(id);
      return id;
    } catch { return null; }
  }

  /** 目录 version：笔记本只能根层（回收站除外）；分组的父按文档同一套兜底。 */
  async function resolveRemoteFolderParent(folder: LakeFolderEntry): Promise<string | null> {
    if (folder.parentId === TRASH_NOTEBOOK_ID) return TRASH_NOTEBOOK_ID;
    if (folder.nodeType === "notebook") return null;
    return resolveRemoteParent(folder.parentId);
  }

  const toFolderEntry = (f: SyncFolderRow): LakeFolderEntry => ({
    id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType,
    icon: f.icon, updatedAt: f.updatedAt,
    ...(f.trashedAt !== undefined && f.trashedAt !== null ? { trashedAt: f.trashedAt } : {}),
    ...(f.deletedFromParentId !== undefined && f.deletedFromParentId !== null ? { deletedFromParentId: f.deletedFromParentId } : {}),
  });

  const toNoteWrite = (n: LakeNoteEntry, parentId: string | null): import("./platformPort.js").SyncNoteWrite => ({
    id: n.id, title: n.title, parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt,
    contentHash: n.contentHash, isConflict: !!n.isConflict, isEditLocked: !!n.isLocked,
    editLockedAt: n.lockedAt ?? null, icon: n.icon ?? null,
    trashedAt: n.trashedAt ?? null, deletedFromParentId: n.deletedFromParentId ?? null,
    kind: normalizeNoteKind(n.kind),
  });

  async function loadState(): Promise<DeviceState> {
    const rawPersisted = await deps.state.read();
    // 迁移只做一次：warning 也只收一次；投影走 ledgerOf（不再从原始 JSON 二次 migrate）。
    const persisted = migratePersisted(rawPersisted, (message) => deps.log?.(message));
    const ledger = persisted ? ledgerOf(persisted) : null;
    if (persisted && persistedNeedsMigration(rawPersisted)) {
      deps.log?.("[v3] 同步 state 已从旧格式迁移到 v3 信封（下一轮 saveState 落盘）");
    }
    // 桌面 hash 缓存由信封携带（跨重启复用，避免全库重算）；移动不传缓存。
    if (deps.hashCache) {
      deps.hashCache.clear();
      for (const [id, entry] of Object.entries(persisted?.hashCache ?? {})) deps.hashCache.set(id, entry);
    }
    const assetsLake = persisted?.assets.lake ?? {};
    const assetsQuick = persisted?.assets.quickNotes ?? {};

    // 「云端已删除·仅本地」集合：引擎权威 = 信封；移动端适配器还会把 DB 投影（cloud_deleted）并回来
    //（信封丢失/旧版本时靠它恢复角标，桌面无此列 ⇒ 恒 undefined，行为不变）。
    const purged = new Set(ledger?.remotePurged ?? []);
    let hasDbProjection = false;

    const folderRows = await p.listFoldersForSync();
    for (const f of folderRows) if (f.cloudDeleted) { hasDbProjection = true; purged.add(f.id); }
    const folders: LakeFolderEntry[] = folderRows.map(toFolderEntry);

    const notes: LakeNoteEntry[] = [];
    for (const n of await p.listNotesSyncMeta()) {
      if (n.cloudDeleted) { hasDbProjection = true; purged.add(n.id); }
      let contentHash = n.contentHash ?? "";
      if (!contentHash) {
        const lakePath = p.noteBodyPath(n.id);
        const stat = await files.stat(lakePath);
        if (!stat) {
          // P0：正文文件被删后，信封里的 hash 缓存必须失效；否则 saveState 会误判「本地已有同 hash」
          // 而跳过落盘，云端拉回的正文永远不恢复。
          hashCache.delete(n.id);
          continue;
        }
        const cached = hashCache.get(n.id);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) contentHash = cached.hash;
        else {
          const bytes = await files.read(lakePath);
          if (!bytes) { hashCache.delete(n.id); continue; }
          contentHash = sha256Hex(bytes);
          hashCache.set(n.id, { mtimeMs: stat.mtimeMs, size: stat.size, hash: contentHash });
        }
      }
      if (!contentHash) continue;
      notes.push({
        id: n.id, title: n.title, parentId: n.parentId, sortOrder: n.sortOrder, updatedAt: n.updatedAt, contentHash,
        ...(n.kind && n.kind !== "doc" ? { kind: normalizeNoteKind(n.kind) } : {}),
        ...(n.icon !== null && n.icon !== undefined ? { icon: n.icon } : {}),
        isLocked: !!n.isEditLocked, lockedAt: n.editLockedAt ?? null, isConflict: !!n.isConflict,
        ...(n.trashedAt ? { trashedAt: n.trashedAt } : {}),
        ...(n.deletedFromParentId !== null && n.deletedFromParentId !== undefined ? { deletedFromParentId: n.deletedFromParentId } : {}),
        ...(assetsLake[n.id] ?? n.assetsHash ? { assetsHash: assetsLake[n.id] ?? n.assetsHash } : {}),
      });
    }

    const quickItems: QuickNoteEntry[] = [];
    const quickPurgeTimes: Record<string, string> = { ...(ledger?.quickPurgeTimes ?? {}) };
    for (const q of await p.listQuickNotesForSync()) {
      if (q.cloudDeleted) { hasDbProjection = true; purged.add(q.id); }
      quickItems.push({
        id: q.id, createdAt: q.createdAt, updatedAt: q.updatedAt, contentHash: q.contentHash,
        ...(q.isConflict ? { isConflict: true } : {}),
        ...(assetsQuick[q.id] ?? q.assetsHash ? { assetsHash: assetsQuick[q.id] ?? q.assetsHash } : {}),
        ...(q.tagIds.length ? { tagIds: q.tagIds } : {}),
        ...(q.tagsUpdatedAt ? { tagsUpdatedAt: q.tagsUpdatedAt } : {}),
      });
    }
    const quickTags: QuickNoteTagEntry[] = (await p.listQuickTags()).map((t: QuickTagRow) => ({
      // sortOrder = 新写入字段；order = 旧字段兼容（移动端旧 saveState 读 order，两端都带上避免丢排序）。
      id: t.id, name: t.name, sortOrder: t.sortOrder, order: t.sortOrder, pinned: t.pinned,
      createdAt: t.createdAt, updatedAt: t.updatedAt,
      ...(t.deletedAt ? { deletedAt: t.deletedAt } : {}),
    }));
    // 两端 quickDeletes 口径本就不同（桌面旧实现含 purged 行、移动不含）⇒ 由平台端口各自给，
    // core 不做 if(platform)：deletes 用 listQuickDeleted 原样、purges 用独立 listQuickPurges。
    const quickDeletes = (await p.listQuickDeleted()).map((d) => d.id);
    const quickPurgeRows = await p.listQuickPurges();
    const quickPurges = quickPurgeRows.map((d) => d.id);
    for (const d of quickPurgeRows) quickPurgeTimes[d.id] = d.purgedAt;

    // 本地 purge 墓碑（deleted_notes.purged_at）→ v3 删除意图：否则远端条目会被当成本地缺失重新拉回。
    const baseline = await deps.baseline.load();
    const intents = [...(ledger?.intents ?? [])];
    const knownIntents = new Set(intents.map((it) => it.noteId));
    const purgedTombstones = await p.listPurgedTombstones();
    for (const t of purgedTombstones) {
      if (knownIntents.has(t.id)) continue;
      intents.push({
        noteId: t.id, targetEpoch: baseline?.epoch ?? "", targetGeneration: baseline?.generation ?? 0,
        ...(t.purgedAt ? { purgedAt: t.purgedAt } : {}),
      });
    }

    // 显式恢复标记以 DB 为准：引擎只认 state.restorePending；信封里的是上次未收尾的残留，两者取并集
    //（缺了它 ⇒ 用户已恢复的副本会被当成「本地缺失」，永远不重新上传）。
    const restorePending = [...new Set([
      ...(ledger?.restorePending ?? []),
      ...(await p.listRestorePendingNoteIds()),
      ...(await p.listRestorePendingQuickNoteIds()),
    ])].sort();

    // 标记失效：DB 投影可能比信封旧（恢复过 / 本地 purge 过），这里按**同一判据**兜一次
    // （settleCloudDeleted；引擎 finalizeRemotePurged 用它，远端重现已由引擎负责，适配器只补它知道的两类）。
    if (hasDbProjection) {
      const settled = new Set(settleCloudDeleted([...purged], {
        restorePending,
        locallyPurged: [...quickPurges, ...purgedTombstones.map((t) => t.id)],
      }));
      purged.clear();
      for (const id of settled) purged.add(id);
    }

    const bodyRecoveryPending = await p.listBodyRecoveryPending();
    deps.markRecoverySeen?.(bodyRecoveryPending.length > 0);

    return {
      lake: { v: 3, space: "lake", notes, folders },
      quickNotes: { v: 3, space: "quickNotes", items: quickItems, tags: quickTags, ...(quickPurges.length ? { purged: quickPurges } : {}) },
      quickDeletes,
      quickPurges,
      quickPurgeTimes,
      folders,
      intents,
      pending: ledger?.pending ?? [],
      remotePurged: hasDbProjection ? [...purged].sort() : [...purged],
      restorePending,
      pendingAssets: ledger?.pendingAssets ?? [],
      ...(bodyRecoveryPending.length > 0 ? { bodyRecoveryPending } : {}),
    };
  }

  /** 目录落库：先 import/更新（deleteMissing=false），再在 saveState 收尾删缺失（true）。 */
  async function saveFolders(folders: LakeFolderEntry[], deleteMissing: boolean): Promise<void> {
    const current = new Map((await p.listFoldersForSync()).map((f: SyncFolderRow) => [f.id, f] as const));
    for (const f of folders) {
      const c = current.get(f.id);
      try {
        const parentId = await resolveRemoteFolderParent(f);
        if (!c) {
          // 远端目录 id 必须原样落库（createNotebook/createGroup 会生成新 id，跨端子文档将找不到父）
          await p.importRemoteFolder({ ...folderRow(f), parentId });
        } else {
          // P1（v3 空发布抖动根因）：目录同样要把合并结果的 updatedAt/元数据原样落库。
          const changed = c.title !== f.title
            || (c.parentId ?? null) !== (parentId ?? null)
            || c.sortOrder !== f.sortOrder
            || (c.icon ?? null) !== (f.icon ?? null)
            || c.updatedAt !== f.updatedAt;
          if (changed) await p.applyRemoteFolderMeta({ ...folderRow(f), parentId });
        }
      } catch (e) {
        throw new Error("saveFolders 失败(" + f.id + "): " + (e as Error).message);
      }
    }
    if (!deleteMissing) return;
    for (const c of current.values()) {
      if (folders.some((f) => f.id === c.id) || protectedFolders.has(c.id)) continue;
      try { await p.deleteTreeNode(c.id); } catch { /* ignore */ }
    }
  }

  function folderRow(f: LakeFolderEntry): SyncFolderRow {
    return {
      id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType,
      icon: f.icon ?? null, updatedAt: f.updatedAt,
      trashedAt: f.trashedAt ?? null, deletedFromParentId: f.deletedFromParentId ?? null,
    };
  }

  async function saveQuickNotes(state: DeviceState): Promise<void> {
    const current = new Map((await p.listQuickNotesForSync()).map((q: QuickNoteSyncRow) => [q.id, q] as const));
    // 「曾经同步过」判据下沉 core（C-3 第 4 处漂移）：baseline.quickNotes 是云端侧已发布的集合。
    const baseline = await deps.baseline.load();
    const baselineQuickIds = new Set((baseline?.quickNotes.items ?? []).map((q) => q.id));
    // 正文文件已丢失的行：按墓碑语义收尸（避免"行在、文件没了"永久卡住同步）。
    try {
      for (const id of await p.listMissingQuickNoteIds()) {
        const purge = (state.intents ?? []).some((it) => it.noteId === id) || (state.quickPurges ?? []).includes(id);
        if (purge) await p.purgeOrphanQuickNote(id);
      }
    } catch { /* 自愈失败不阻断 */ }

    const wanted = new Map(state.quickNotes.items.map((q) => [q.id, q] as const));
    for (const item of wanted.values()) {
      const cur = current.get(item.id);
      try {
        if (!cur || cur.contentHash !== item.contentHash) {
          const body = await files.read(p.quickNoteBodyPath(item.id));
          // P0-2 分块应用：正文尚未下到的条目先跳过（行保持旧态/不新建），等正文流水线完成后再落。
          if (!body) continue;
          const assetRows = await assets.listQuickAssets(item.id);
          const assetWrites: Array<{ filename: string; bytes: Uint8Array }> = [];
          for (const filename of assetRows) {
            const bytes = await assets.readQuickAsset(item.id, filename);
            if (bytes) assetWrites.push({ filename, bytes });
          }
          await p.importRemoteQuickNote({
            id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt,
            contentHash: item.contentHash, isConflict: !!item.isConflict,
          }, body, assetWrites);
        } else {
          // 本地上传成功：仅当同步期间未被编辑才标 synced（I2 守卫）。
          await p.markQuickNoteSyncedIfUnchanged(item.id, item.contentHash);
        }
        await p.applyQuickNoteTagLinks(item.id, item.tagIds ?? [], item.tagsUpdatedAt ?? "");
      } catch (err) {
        throw new Error("saveQuickNotes 失败(" + item.id + "): " + (err as Error).message);
      }
    }
    await p.mergeQuickTags((state.quickNotes.tags ?? []) as QuickTagRow[]);

    // quick-missing 三态判定（决策在 core，平台只落库）：
    // 1) purge：信封 intents / quickPurges（显式彻底删除）⇒ 永久删（桌面旧路径）；
    // 2) cloud-delete：云端已删除副本（cloudDeleted）或 baseline 里曾发布过 ⇒ 软删进小记回收站 + 打「仅本地」标；
    // 3) physical-delete：从未同步过（不在 baseline）且平台支持 discard ⇒ 物理删除（移动旧语义，不留墓碑）；
    //    桌面不实现 discardQuickNote ⇒ 回落 cloud-delete = 迁移前桌面行为（语义不变）。
    const remoteDeletedQuickIds: string[] = [];
    for (const cur of current.values()) {
      if (wanted.has(cur.id)) continue;
      if (cur.deletedAt) continue; // 已在 quick 回收站（移动 cloudDeleted 副本）：保持原状
      const purge = (state.intents ?? []).some((it) => it.noteId === cur.id) || (state.quickPurges ?? []).includes(cur.id);
      const knownCloud = cur.cloudDeleted === true || baselineQuickIds.has(cur.id);
      try {
        if (purge) {
          try { await p.purgeQuickNote(cur.id); }
          catch { await p.deleteQuickNote(cur.id); await p.purgeQuickNote(cur.id); }
        } else if (!knownCloud && p.discardQuickNote) {
          await p.discardQuickNote(cur.id);
        } else {
          // 远端彻底删除（不是本地 purge）：进回收站保留正文/附件，并打「云端已删除 · 仅本地」标。
          await p.deleteQuickNote(cur.id);
          remoteDeletedQuickIds.push(cur.id);
        }
      } catch { /* 已不在 active */ }
    }
    if (remoteDeletedQuickIds.length > 0) await p.markQuickNotesCloudDeleted(remoteDeletedQuickIds);
  }

  async function saveState(state: DeviceState): Promise<void> {
    // 正常轮（队列本来就是空且本轮没消费过）不碰队列：异常记账只在异常发生后写。
    if ((state.bodyRecoveryPending ?? []).length > 0) await p.markBodyRecoveryPending(state.bodyRecoveryPending ?? []);
    else deps.recoveryConsumed?.();

    // 目录必须先于文档落库：他端新建的笔记本/分组 id 在本地还不存在，先建目录才能建子文档。
    await saveFolders(state.folders, false);

    // 批量写窗口（移动 executeSet）：只包「文档行写入」这一段；目录/小记保持逐条（与旧移动实现同序）。
    await p.beginWriteBatch?.();
    const current = new Map((await p.listNotesSyncMeta()).map((n: SyncNoteMetaRow) => [n.id, n] as const));
    const wanted = new Map(state.lake.notes.map((n) => [n.id, n]));
    const stagedMoves: Array<{ id: string; kind: NoteKind }> = [];
    for (const n of wanted.values()) {
      const stagedBytes = deps.stagedBodies.get(n.id);
      const staged = stagedBytes !== undefined || (deps.stagedBodies.has?.(n.id) ?? false);
      const content = stagedBytes !== undefined ? new TextDecoder().decode(stagedBytes) : null;
      const cur = current.get(n.id);
      const curHash = cur ? (hashCache.get(n.id)?.hash ?? cur.contentHash ?? "") : "";
      // C5：远端 parent 可能是本机还没有/已删的目录（首拉父未落库）——不得直接落库。
      const resolvedParentId = n.trashedAt ? TRASH_NOTEBOOK_ID : await resolveRemoteParent(n.parentId);
      try {
        if (!cur) {
          // P0-2 分块应用：正文还没下到的条目先不建行（否则会先落一个空正文），等它的分块/下一轮。
          // 移动端 staged 正文在文件里（content=null，staged=true）⇒ 允许建行，正文由钩子搬。
          if (!staged) continue;
          await p.importRemoteNote(
            toNoteWrite(n, resolvedParentId),
            content !== null ? new TextEncoder().encode(content) : null,
            { staged: stagedBytes === undefined },
          );
          if (n.icon) await p.setNodeIcon(n.id, n.icon);
        } else {
          // 只有引擎真的写入了新正文（staged）才保存，避免每轮读全库正文
          const contentChanged = staged || (content !== null && sha256Hex(new TextEncoder().encode(content)) !== curHash);
          if (contentChanged && content === null) {
            // 移动端 staged（正文是 staging 文件，不读回 JS）：行只更新元数据/远端 hash，正文由钩子搬。
            if (!p.applyStagedBodyNote) throw new Error("staged 正文需要 applyStagedBodyNote 端口");
            await p.applyStagedBodyNote(toNoteWrite(n, resolvedParentId));
          } else if (contentChanged) {
            // 派生缓存（text_cache + FTS）必须和同步写入的正文同一次落库（doc 由 core 派生；非 doc 平台按 kind 派生）。
            const kind = normalizeNoteKind(n.kind);
            const caches = kind === "doc" ? searchTextForKind("doc", content!) : null;
            const bodyPath = p.noteBodyPath(n.id);
            if (await files.stat(bodyPath)) {
              await p.saveNote(n.id, n.title, content!, caches);
            } else {
              // P0：本地正文文件被删（DB 行还在）⇒ 普通 saveNote 会以「笔记不存在」拒绝；
              // 这是「从云端拉回正文」的恢复路径，必须走 importRemoteNote 重建文件。
              await p.importRemoteNote(toNoteWrite(n, resolvedParentId), new TextEncoder().encode(content!));
            }
          }
          if (n.trashedAt && !cur.trashedAt) {
            // 远端墓碑 → 回收站：必须走 deleteNote（不能 moveTreeNode 到回收站隐藏笔记本）
            await p.deleteNote(n.id);
          } else if (!n.trashedAt && cur.trashedAt) {
            await p.restoreTrashItem(n.id);
          }
          // P1（v3 空发布抖动根因）：本轮合并结果的元数据必须原样落库，尤其 updatedAt。
          const metaDiffers = contentChanged
            || (!!n.trashedAt !== !!cur.trashedAt)
            || n.updatedAt !== cur.updatedAt
            || n.title !== cur.title
            || (resolvedParentId ?? null) !== (cur.parentId ?? null)
            || n.sortOrder !== cur.sortOrder
            || !!n.isConflict !== !!cur.isConflict
            || (n.trashedAt ?? null) !== (cur.trashedAt ?? null)
            || (n.deletedFromParentId ?? null) !== (cur.deletedFromParentId ?? null)
            || (n.icon !== undefined && (cur.icon ?? null) !== (n.icon ?? null));
          if (metaDiffers) await p.applyRemoteNoteMeta(toNoteWrite(n, resolvedParentId));
          if (!!cur.isEditLocked !== !!n.isLocked || (cur.editLockedAt ?? null) !== (n.lockedAt ?? null)) {
            await p.applyRemoteEditLock(n.id, !!n.isLocked, n.lockedAt ?? null);
          }
        }
        await deps.flushAssetDirDeletion?.(n.id);
        if (staged) stagedMoves.push({ id: n.id, kind: normalizeNoteKind(n.kind) });
        if (content !== null) {
          const stat = await files.stat(p.noteBodyPath(n.id));
          if (stat) hashCache.set(n.id, { mtimeMs: stat.mtimeMs, size: stat.size, hash: sha256Hex(new TextEncoder().encode(content)) });
        }
      } catch (e) {
        throw new Error("saveState 失败(" + n.id + "): " + (e as Error).message);
      }
    }
    // 正文 staging 搬到最终路径（移动），然后一次性提交批量语句（executeSet 单事务）。
    if (stagedMoves.length > 0) await p.moveStagedBodyFiles?.(stagedMoves);
    await p.flushWriteBatch?.();

    for (const cur of current.values()) {
      if (wanted.has(cur.id)) continue;
      hashCache.delete(cur.id);
      // I0（桌面）：收敛阶段「不在本轮状态」的行只软删（进回收站），禁止在同步路径上做不可恢复删除。
      // 移动旧语义不同：写 deleted_notes 墓碑 + 删行（删除传播）。由端口能力表达，不在 core if(platform)。
      try {
        if (p.purgeLocalNote) await p.purgeLocalNote(cur.id);
        else await p.deleteNote(cur.id);
      } catch { /* 已不在 */ }
    }

    await saveQuickNotes(state);
    await saveFolders(state.folders, true);

    // 引擎持久化的 remotePurged → 本地展示位 cloud_deleted；只保留「本地仍有行」的 id
    //（本地主动 purge 后行已物理删除，必须从信封清掉，否则永远打标、引擎每轮空转）。
    const remotePurged: string[] = [];
    for (const id of state.remotePurged ?? []) if (await p.hasNote(id)) remotePurged.push(id);
    if (p.applyCloudDeletedProjection) await p.applyCloudDeletedProjection(remotePurged);
    else await p.applyNotesCloudDeleted(remotePurged);

    const envelope = toPersistedState({ ...state, remotePurged });
    const withCache = deps.hashCache && deps.hashCache.size > 0
      ? { ...envelope, hashCache: Object.fromEntries(deps.hashCache) }
      : envelope;
    await deps.state.write(withCache);
    deps.stagedBodies.clear();
    deps.clearAssetDirDeletions?.();
  }

  return { loadState, saveState };
}

