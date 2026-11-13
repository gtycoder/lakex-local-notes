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
import type { DeviceBaseline, DeviceState, QuickPushState, S3v3DeviceStore } from "../../s3v3DeviceStore.js";
import type { LakeFolderEntry, LakeNoteEntry, QuickNoteEntry, QuickNoteTagEntry } from "../protocol/s3v3Index.js";
import { TRASH_NOTEBOOK_ID } from "../../syncDecisions.js";
import { normalizeNoteKind, type NoteKind } from "../../noteKind.js";
import type { PlanWarning } from "../plan/types.js";
import { searchTextForKind } from "../../noteSearchText.js";
import { sha256Hex } from "../../syncUtils.js";
import type { FileDriver } from "./ports.js";
import type { IntentLogStateV3 } from "./intentLogState.js";
import { ledgerOf, migratePersisted, mergeSyncMarkers, persistedNeedsMigration, toPersistedState } from "./intentLogState.js";

/** 信封标记合并的唯一实现（intentLogState.ts）；这里 re-export 保持既有导入点（适配器/测试）。 */
export { mergeSyncMarkers };
import { settleCloudDeleted } from "./cloudDeleted.js";
import { normalizeFolderSpace } from "../../diary.js";
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
  /** 单篇 apply 失败的结构化警告出口（261112 task-44）：适配器收集，同步结果里透出（复用既有 SyncWarning 结构）。 */
  onApplyWarning?: (warning: PlanWarning) => void;
}

export interface DeviceStoreMeta {
  loadState(): Promise<DeviceState>;
  saveState(state: DeviceState, previous?: DeviceState): Promise<void>;
  /** 单条小记推送的轻量状态（261110）：见 `S3v3DeviceStore.loadQuickPushState`。 */
  loadQuickPushState(id: string): Promise<QuickPushState | null>;
}

/** 小记同步行 → 索引条目（loadState 与 loadQuickPushState 共用，避免两份映射漂移）。 */
function quickEntryOf(q: QuickNoteSyncRow, assetsQuick: Record<string, string>): QuickNoteEntry {
  return {
    id: q.id, createdAt: q.createdAt, updatedAt: q.updatedAt, contentHash: q.contentHash,
    ...(q.isConflict ? { isConflict: true } : {}),
    ...(assetsQuick[q.id] ?? q.assetsHash ? { assetsHash: assetsQuick[q.id] ?? q.assetsHash } : {}),
    // 标签关系按集合同步：**排序后的 ID 列表**（顺序是设备本地视图，不能传播）。
    ...(q.tagIds.length ? { tagIds: [...q.tagIds].sort() } : {}),
    ...(q.tagsUpdatedAt ? { tagsUpdatedAt: q.tagsUpdatedAt } : {}),
  };
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
    // 显式写 space（非日记 = null）：平台行缺列/旧库无该列时归一成 null，绝不省略字段。
    space: normalizeFolderSpace(f.space),
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
        // 文档标签关系（261105 P1）：本机顺序原样带入 state；发布时由 plan 排序成集合。
        ...((n.tagIds?.length ?? 0) > 0 ? { tagIds: [...n.tagIds!] } : {}),
        ...(n.tagsUpdatedAt ? { tagsUpdatedAt: n.tagsUpdatedAt } : {}),
      });
    }

    const quickItems: QuickNoteEntry[] = [];
    const quickPurgeTimes: Record<string, string> = { ...(ledger?.quickPurgeTimes ?? {}) };
    for (const q of await p.listQuickNotesForSync()) {
      if (q.cloudDeleted) { hasDbProjection = true; purged.add(q.id); }
      quickItems.push(quickEntryOf(q, assetsQuick));
    }
    // 标签目录：只同步名称/时间（顺序是设备本地视图；删除 = 缺席，云端列表不放墓碑）。
    const quickTags: QuickNoteTagEntry[] = (await p.listQuickTags()).map((t: QuickTagRow) => ({
      id: t.id, name: t.name,
      createdAt: t.createdAt, updatedAt: t.updatedAt,
    }));
    // 本机待删标签（离线删过、还没确认远端缺席）：设备本地，不上传。
    const pendingTagDeletes = (await p.listPendingTagDeletes?.()) ?? [];
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
      ...(pendingTagDeletes.length ? { pendingTagDeletes } : {}),
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

  /**
   * 目录按「父先子后」排序（261112 P1-a）：同轮的 parent 可能也在这个 incoming 列表里（首拉/新端），
   * 若按 id 字典序先落子再落父，resolveRemoteFolderParent 找不到父 ⇒ 子目录被落成根目录（parentId=null），
   * 且此后每轮 changed 比较又把 null 当既有值写回，跨端目录结构永久不一致。
   * 只在本列表内定序；父不在本列表（已存在/远端孤儿）时保持原样交给 resolveRemoteFolderParent 兜底。
   */
  function foldersParentsFirst(list: readonly LakeFolderEntry[]): LakeFolderEntry[] {
    const MAX_PARENT_DEPTH = 64;
    const byId = new Map(list.map((f) => [f.id, f] as const));
    /** 父链深度（只在**本列表内**计；父不在列表 = 0，交给 resolveRemoteFolderParent 兜底）。 */
    const depthMemo = new Map<string, number>();
    const depthOf = (id: string, path: Set<string>): number => {
      const cached = depthMemo.get(id);
      if (cached !== undefined) return cached;
      if (path.has(id)) return 0; // 坏环：按根处理，避免死循环
      const node = byId.get(id);
      const parent = node?.parentId ? byId.get(node.parentId) : undefined;
      if (!node || !parent) { depthMemo.set(id, 0); return 0; }
      path.add(id);
      const depth = 1 + depthOf(parent.id, path);
      path.delete(id);
      depthMemo.set(id, depth);
      return depth;
    };
    const maxDepth = list.reduce((max, f) => Math.max(max, depthOf(f.id, new Set())), 0);
    if (maxDepth > MAX_PARENT_DEPTH) {
      // task-104 F-08：深链不再静默；按真实深度排序（父先子后对所有深度都成立），只告警一次。
      deps.log?.("[sync][folder] 目录父链超过 " + MAX_PARENT_DEPTH + " 层（" + maxDepth + "），按深度排序仍保证父先子后: " + list[0]?.id);
    }
    // 稳定排序：同深度保持输入顺序；父深度 < 子深度 ⇒ 父一定先落库。
    return [...list].sort((a, b) => depthOf(a.id, new Set()) - depthOf(b.id, new Set()));
  }

  /** 目录落库：先 import/更新（deleteMissing=false），再在 saveState 收尾删缺失（true）。 */
  async function saveFolders(folders: LakeFolderEntry[], deleteMissing: boolean): Promise<void> {
    const current = new Map((await p.listFoldersForSync()).map((f: SyncFolderRow) => [f.id, f] as const));
    for (const raw of foldersParentsFirst(folders)) {
      // P1-a 兜底（261112 真实 S3）：**notebook 只能根层**。带 parent 却标 notebook 的条目 =
      // 远端类型在合并层丢了（engineBridge.applyFolders 读 meta.kind，而计划的 meta 只有 nodeType）
      // ⇒ 按 group 落库，否则 resolveRemoteFolderParent 会把父强行置 null，跨端目录结构永久不一致。
      // F-08（task-104）：类型兜底改成**显式告警**（仍保留兜底，避免整轮失败/树结构错乱）。
      const f = raw.nodeType === "notebook" && raw.parentId && raw.parentId !== TRASH_NOTEBOOK_ID
        ? (() => {
            deps.log?.("[sync][folder] 远端 directory 标记为 notebook 但带父目录 ⇒ 按 group 落库（上游类型丢失）: " + raw.id + " parent=" + raw.parentId);
            return { ...raw, nodeType: "group" as const };
          })()
        : raw;
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
            || normalizeFolderSpace(c.space) !== normalizeFolderSpace(f.space)
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
      space: normalizeFolderSpace(f.space),
      trashedAt: f.trashedAt ?? null, deletedFromParentId: f.deletedFromParentId ?? null,
    };
  }

  async function saveQuickNotes(state: DeviceState): Promise<void> {
    const current = new Map((await p.listQuickNotesForSync()).map((q: QuickNoteSyncRow) => [q.id, q] as const));
    // 同步窗口守卫（261105 容错批，P1-1）：本轮 plan 快照之后用户又删掉/彻底删掉的小记，
    // 不能因为 state 里还留着就被重新导入——`importRemoteQuickNote` 会清墓碑，等于把删除永久丢掉。
    // 判据：行不在 fresh current（已被删）但 id 出现在墓碑表里 ⇒ 本地新删除优先，下一轮再发布缺席。
    // 261113（C1 实测）：墓碑必须带软删时刻——远端条目比墓碑新 = 他端显式恢复（恢复会 bump updatedAt），
    // 这时要正常导入（旧实现只看「墓碑是否存在」⇒ 任何历史墓碑都会把远端恢复的条目在下载后丢弃，
    // 并让本端把缺席反复发布回去 ⇒ 恢复永远不生效、删除回弹）。
    const quickDeletedNow = new Map((await p.listQuickDeleted()).map((d) => [d.id, d.deletedAt ?? ""] as const));
    // purge 墓碑带时间：用于区分「轮内 purge」与「他端恢复后重新发布」（后者要正常导入）。
    const quickPurgedNow = new Map((await p.listQuickPurges()).map((d) => [d.id, d.purgedAt ?? ""] as const));
    // 显式恢复（restorePending）与远端复活都是例外：恢复动作本身就要把条目重新拉起，不受墓碑守卫压制。
    const restoring = new Set(state.restorePending ?? []);
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
      // 轮内被删（软删或 purge）：以本地新动作为准，本轮不重建、不清墓碑（显式恢复 / 远端复活除外）。
      const purgedAtQuick = quickPurgedNow.get(item.id);
      const purgedDuringRound = purgedAtQuick !== undefined && !restoring.has(item.id) && (item.updatedAt ?? "") <= purgedAtQuick;
      // 软删墓碑同理按时间比较：墓碑 ≥ 远端条目 ⇒ 本地新删除优先（不复活）；
      // 远端条目更新 ⇒ 他端恢复赢，正常导入。时间戳缺失时按旧行为（墓碑优先，保守）。
      const deletedAtQuick = quickDeletedNow.get(item.id);
      const tombstoneWinsOverRemote = deletedAtQuick === undefined ? false : (deletedAtQuick === "" || deletedAtQuick >= (item.updatedAt ?? ""));
      const softDeletedDuringRound = deletedAtQuick !== undefined && purgedAtQuick === undefined && !restoring.has(item.id) && tombstoneWinsOverRemote;
      if (!cur && (purgedDuringRound || softDeletedDuringRound)) continue;
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
        // 261113（D7 修复）：无标签且无版本的小记**不落关系**。移动端口在 tagsUpdatedAt 缺失时会用
        // quick_notes.updated_at 兜底合成版本 ⇒ 一轮整轮 saveState 就给每条无标签小记新建了「本端自造」
        // 的版本行；下一轮 plan 的标签 LWW 见 lt > rt("") 判成「本地关系更新」⇒ 0 正文变更却多发布一轮
        // quick-notes 索引（gen+1）。远端清空标签仍会带更新的 tagsUpdatedAt（版本非空）⇒ 照常应用，语义不变。
        const remoteQuickTagIds = item.tagIds ?? [];
        if (remoteQuickTagIds.length > 0 || item.tagsUpdatedAt) {
          await p.applyQuickNoteTagLinks(item.id, remoteQuickTagIds, item.tagsUpdatedAt ?? "");
        }
      } catch (err) {
        throw new Error("saveQuickNotes 失败(" + item.id + "): " + (err as Error).message);
      }
    }
    // 目录落库：upsert active 行 + 物理删掉本轮判定删除的标签（含 offline 待删），清其关联/版本。
    const removedTagIds = state.pendingTagDeletes ?? [];
    await p.mergeQuickTags((state.quickNotes.tags ?? []) as QuickTagRow[], removedTagIds);
    // 待删集合：**追加**本轮结论（覆盖写会丢掉「同步期间用户又删的」那条），再结算远端已确认缺席的。
    if (removedTagIds.length > 0) await p.addPendingTagDeletes?.(removedTagIds);
    const settledTagIds = state.tagPendingSettled ?? [];
    if (settledTagIds.length > 0) await p.settlePendingTagDeletes?.(settledTagIds);

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

  async function saveState(state: DeviceState, previous?: DeviceState): Promise<void> {
    // 正常轮（队列本来就是空且本轮没消费过）不碰队列：异常记账只在异常发生后写。
    if ((state.bodyRecoveryPending ?? []).length > 0) await p.markBodyRecoveryPending(state.bodyRecoveryPending ?? []);
    else deps.recoveryConsumed?.();

    // 目录必须先于文档落库：他端新建的笔记本/分组 id 在本地还不存在，先建目录才能建子文档。
    await saveFolders(state.folders, false);

    // Review-A P2-1 / P2-E：标签关系版本**每轮批量读一次**（平台端口可选），供下面按版本差异决定是否逐篇应用。
    // - 端口缺失 = 该端未接入批量读 ⇒ null（退化逐篇调用，旧行为不变）；
    // - 读取失败也不阻断同步（同样退化逐篇；端口内部版本比较是幂等 no-op）。
    let tagVersions: Map<string, string> | null = null;
    if (p.applyNoteTagLinks && p.listNoteTagVersions) {
      try { tagVersions = await p.listNoteTagVersions(); } catch { tagVersions = null; }
    }

    // 批量写窗口（移动 executeSet）：只包「文档行写入」这一段；目录/小记保持逐条（与旧移动实现同序）。
    await p.beginWriteBatch?.();
    const current = new Map((await p.listNotesSyncMeta()).map((n: SyncNoteMetaRow) => [n.id, n] as const));
    // 同步窗口守卫（P1-8）：本轮快照之后被 purge 的文档，不得因为 state 里还在就被 importRemoteNote 重建
    //（重建行 + 正文后，墓碑仍在 ⇒ 下一轮再删，表现为「删了又出现」的闪回与重复 PUT）。
    // purgedAt 用于区分「轮内被 purge、快照里还是旧条目」与「他端已恢复并重新发布」：
    // 只有快照条目的 updatedAt 不晚于本地 purge 时间，才算轮内删除；更晚 ⇒ 远端复活，正常导入。
    const purgedNow = new Map((await p.listPurgedTombstones()).map((t) => [t.id, t.purgedAt ?? ""] as const));
    const restoringNow = new Set(state.restorePending ?? []);
    const wanted = new Map(state.lake.notes.map((n) => [n.id, n]));
    // P0 判据来源：必须看**云端基线**（上次成功发布的集合）。本轮的 previous/state 已包含本地刚做的删除，
    // 拿它当基线会把「用户刚删」误判成「基线本来就是回收站」⇒ 远端 active 时隐式恢复。
    const deviceBaseline = await deps.baseline.load();
    const baselineTrashedIds = new Set(
      (deviceBaseline?.lake.notes ?? []).filter((entry) => !!entry.trashedAt).map((entry) => entry.id),
    );
    const stagedMoves: Array<{ id: string; kind: NoteKind }> = [];
    for (const n of wanted.values()) {
      const stagedBytes = deps.stagedBodies.get(n.id);
      const staged = stagedBytes !== undefined || (deps.stagedBodies.has?.(n.id) ?? false);
      const content = stagedBytes !== undefined ? new TextDecoder().decode(stagedBytes) : null;
      const cur = current.get(n.id);
      const curHash = cur ? (hashCache.get(n.id)?.hash ?? cur.contentHash ?? "") : "";
      // P0（261112 真实 S3 验收）：**回收站 = 特殊笔记本**，内容编辑与位置移动是独立字段。
      // 本地在回收站 + 远端 active 的最新编辑 ⇒ 应用正文/标题/标签等字段，**保留本地回收站生命周期**；
      // 绝不因「远端 active」隐式恢复（restoreTrashItem 会把用户删掉的东西塞回文档树）。
      // 仅两条例外允许恢复：① 基线本来就是回收站条目（远端 active = 他端显式恢复传播）② 本机 restore_pending。
      const keepLocalTrash = !!cur && cur.trashedAt != null && !n.trashedAt
        && !restoringNow.has(n.id) && !baselineTrashedIds.has(n.id);
      // C5：远端 parent 可能是本机还没有/已删的目录（首拉父未落库）——不得直接落库。
      const resolvedParentId = n.trashedAt || keepLocalTrash ? TRASH_NOTEBOOK_ID : await resolveRemoteParent(n.parentId);
      try {
        if (!cur) {
          // 轮内被 purge：以本地新动作为准（墓碑优先，不重建）；显式恢复/远端复活是例外。
          const purgedAt = purgedNow.get(n.id);
          if (purgedAt !== undefined && !restoringNow.has(n.id) && (n.updatedAt ?? "") <= purgedAt) continue;
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
              // P0：本地在回收站的行也要能接收远端正文（同步专用写路径，保留 trash 状态；purged 仍拒绝）。
              if (cur.trashedAt != null && p.saveSyncedNote) await p.saveSyncedNote(n.id, n.title, content!, caches);
              else await p.saveNote(n.id, n.title, content!, caches);
            } else {
              // P0：本地正文文件被删（DB 行还在）⇒ 普通 saveNote 会以「笔记不存在」拒绝；
              // 这是「从云端拉回正文」的恢复路径，必须走 importRemoteNote 重建文件。
              await p.importRemoteNote(toNoteWrite(n, resolvedParentId), new TextEncoder().encode(content!));
            }
          }
          // 同步窗口守卫（P1-2）：本地行比本轮快照更新且生命周期相反 ⇒ 用户在图同步期间移入/移出回收站，
          // 本轮不得覆写生命周期（否则删除/恢复被静默回滚），留到下一轮按新状态合并（I2「未变才应用」）。
          //
          // H73-G1（261112，AGENTS §3#24 位置与内容正交）：该守卫**只应保护「本地在同步窗口内自己改了生命周期」**，
          // 不能因为「本地内容更新更晚」就永远挡住远端位置变更（否则：A 改 v2→A 删除→同步；B 未同步改 v2B→同步，
          // B 只应用了正文却永远留在活跃树 = 删除不传播，且 apply-position 不推进 updatedAt ⇒ 守卫永久生效）。
          // 判据 = 本轮快照（previous）里该条的位置：本地当前生命周期与快照一致 ⇒ 本地没动生命周期 ⇒
          // 生命周期差异只可能来自远端（位置赢家=远端）⇒ 必须落地；只有「本地与快照不一致」才按 P1-2 保护。
          // previous 缺失（旧调用/单测直接调 saveState）⇒ 保守沿用旧守卫，行为不倒退。
          const prevNote = previous?.lake.notes.find((entry) => entry.id === n.id);
          const prevTrashedAt = prevNote?.trashedAt ?? null;
          const localLifecycleChangedSinceSnapshot = !!prevNote
            && ((cur.trashedAt ?? null) !== prevTrashedAt);
          const lifecycleRace = (!!n.trashedAt !== !!cur.trashedAt)
            && (!prevNote || localLifecycleChangedSinceSnapshot)
            && !!cur.updatedAt && !!n.updatedAt && cur.updatedAt > n.updatedAt;
          if (lifecycleRace) {
            // 只跳过生命周期/元数据覆写；正文/图标/锁等独立字段仍按正常路径处理。
          } else if (n.trashedAt && !cur.trashedAt) {
            // 远端墓碑 → 回收站：必须走 deleteNote（不能 moveTreeNode 到回收站隐藏笔记本）
            await p.deleteNote(n.id);
          } else if (!n.trashedAt && cur.trashedAt) {
            // P0：只有「基线 trashed → 远端 active」或显式 restore_pending 才恢复（见 keepLocalTrash）；
            // 其余情况保留本地回收站：远端内容仍会按上面的正文/元数据路径应用。
            if (!keepLocalTrash) await p.restoreTrashItem(n.id);
          }
          // P1（v3 空发布抖动根因）：本轮合并结果的元数据必须原样落库，尤其 updatedAt。
          // P0：keepLocalTrash 时把生命周期字段固定为**本地回收站值**（position 归本地、内容归远端），
          // 这样 applyRemoteNoteMeta 不会把行移出回收站（它的 inTrash 判据 = parentId === 回收站笔记本）。
          const metaNote = keepLocalTrash
            ? { ...toNoteWrite(n, resolvedParentId), trashedAt: cur.trashedAt ?? null, deletedFromParentId: cur.deletedFromParentId ?? null }
            : toNoteWrite(n, resolvedParentId);
          const effTrashedAt = keepLocalTrash ? cur.trashedAt : (n.trashedAt ?? null);
          const effDeletedFrom = keepLocalTrash ? (cur.deletedFromParentId ?? null) : (n.deletedFromParentId ?? null);
          const metaDiffers = contentChanged
            || (!!effTrashedAt !== !!cur.trashedAt)
            || n.updatedAt !== cur.updatedAt
            || n.title !== cur.title
            || (metaNote.parentId ?? null) !== (cur.parentId ?? null)
            || n.sortOrder !== cur.sortOrder
            || !!n.isConflict !== !!cur.isConflict
            || (effTrashedAt ?? null) !== (cur.trashedAt ?? null)
            || (effDeletedFrom ?? null) !== (cur.deletedFromParentId ?? null)
            || (n.icon !== undefined && (cur.icon ?? null) !== (n.icon ?? null));
          if (metaDiffers && !lifecycleRace) {
            const localSnapshot = previous?.lake.notes.find((entry) => entry.id === n.id);
            // 引擎本轮自己写了正文（下载/恢复）时，DB 的 updated_at 是引擎写的、不是用户窗口内编辑 ⇒
            // 必须无条件应用远端元数据把 updatedAt 对齐，否则下一轮会误判本地更新再发布。
            await p.applyRemoteNoteMeta(metaNote, contentChanged ? undefined : localSnapshot?.updatedAt);
          }
          if (!!cur.isEditLocked !== !!n.isLocked || (cur.editLockedAt ?? null) !== (n.lockedAt ?? null)) {
            await p.applyRemoteEditLock(n.id, !!n.isLocked, n.lockedAt ?? null);
          }
        }
        // 文档标签关系（261105 P1）：关系版本 LWW；平台侧负责「保留本机顺序 + 远端新增插最前」。
        // P2-E：端口给了批量版本 ⇒ 只在本轮版本与已存版本不同、或「有标签但本地还没有版本行」（无版本旧数据）
        // 时才调用；版本相同 = 端口内的 LWW 判据必为 no-op ⇒ 跳过这一次点查。
        // 远端**清空**标签会带更新的 tagsUpdatedAt（版本不同）⇒ 仍会调用，语义不变。
        // 端口缺失/批量读失败（tagVersions=null）⇒ 退化旧行为（有标签字段或版本就逐篇调用）。
        {
          const stateTagVersion = n.tagsUpdatedAt ?? "";
          const hasTagData = !!stateTagVersion || (n.tagIds?.length ?? 0) > 0;
          const storedTagVersion = tagVersions ? (tagVersions.get(n.id) ?? "") : null;
          const needTagApply = tagVersions
            ? (storedTagVersion !== stateTagVersion || (storedTagVersion === "" && hasTagData))
            : hasTagData;
          if (p.applyNoteTagLinks && needTagApply) {
            await p.applyNoteTagLinks(n.id, n.tagIds ?? [], stateTagVersion);
          }
        }
        await deps.flushAssetDirDeletion?.(n.id);
        if (staged) stagedMoves.push({ id: n.id, kind: normalizeNoteKind(n.kind) });
        if (content !== null) {
          const stat = await files.stat(p.noteBodyPath(n.id));
          if (stat) hashCache.set(n.id, { mtimeMs: stat.mtimeMs, size: stat.size, hash: sha256Hex(new TextEncoder().encode(content)) });
        }
      } catch (e) {
        // P0（261112 真实 S3 验收：一篇卡死整台设备）：**单篇应用失败必须降级**——
        // 记 warning（日志 + 结构化出口）后继续下一篇，绝不把异常抛成整轮 syncNow 失败。
        // 下一轮会重新计划该篇（未标 synced/未推进基线），因此这里是可重试的跳过而不是丢数据。
        const detail = "应用远端更新失败（已跳过，下一轮重试）：" + (e as Error).message;
        deps.log?.("[sync][apply][warn] 跳过本篇 " + n.id + " " + detail);
        deps.onApplyWarning?.({ code: "apply_skipped", space: "lake", id: n.id, title: n.title, detail });
        continue;
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
    // 261105 P1：目录合并之后收敛文档关系（清掉指向不存在标签的孤儿；同轮新到的目录已可用）。
    if (p.pruneNoteTagLinks) {
      await p.pruneNoteTagLinks((state.quickNotes.tags ?? []).map((tag) => tag.id));
    }
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

  /**
   * 单条小记推送的轻量状态（261110 提速）：**只读这条小记 + 标记**，不扫全库文档/不读其它正文。
   * 与 loadState 的字段同义（index entry / remotePurged / restorePending / quickPurges / quickPurgeTimes），
   * 供引擎在「保存并同步」时跳过 O(全库) 的世界重建。任何一步失败抛错 ⇒ 引擎回退 loadState()（语义不变）。
   */
  async function loadQuickPushState(id: string): Promise<QuickPushState | null> {
    const rawPersisted = await deps.state.read();
    const persisted = migratePersisted(rawPersisted, (message) => deps.log?.(message));
    const ledger = persisted ? ledgerOf(persisted) : null;
    const assetsQuick = persisted?.assets.quickNotes ?? {};
    const purged = new Set(ledger?.remotePurged ?? []);
    if (p.listCloudDeletedIds) {
      // 平台有轻量投影就读轻量投影（桌面/移动都实现：几条 SQL，不拼世界）。
      const marked = await p.listCloudDeletedIds();
      for (const x of marked.folders) purged.add(x);
      for (const x of marked.notes) purged.add(x);
      for (const x of marked.quickNotes) purged.add(x);
    } else {
      for (const f of await p.listFoldersForSync()) if (f.cloudDeleted) purged.add(f.id);
      for (const n of await p.listNotesSyncMeta()) if (n.cloudDeleted) purged.add(n.id);
      for (const q of await p.listQuickNotesForSync()) if (q.cloudDeleted) purged.add(q.id);
    }
    // 单条推送提速（261110）：平台有单行查询就只读这一条；否则回退 list（读全部小记行）。
    let quickNote: QuickNoteEntry | null = null;
    if (p.getQuickNoteSyncRow) {
      const row = await p.getQuickNoteSyncRow(id);
      if (row) quickNote = quickEntryOf(row, assetsQuick);
    } else {
      const rows = await p.listQuickNotesForSync();
      for (const q of rows) if (q.id === id) quickNote = quickEntryOf(q, assetsQuick);
    }
    const quickPurgeRows = await p.listQuickPurges();
    const quickPurgeTimes: Record<string, string> = { ...(ledger?.quickPurgeTimes ?? {}) };
    for (const d of quickPurgeRows) quickPurgeTimes[d.id] = d.purgedAt;
    // 显式恢复以 DB 为准（与 loadState 同口径：信封残留 + 文档/小记 DB 标记取并集）。
    const restorePending = [...new Set([
      ...(ledger?.restorePending ?? []),
      ...(await p.listRestorePendingNoteIds()),
      ...(await p.listRestorePendingQuickNoteIds()),
    ])].sort();
    return {
      quickNote, restorePending, remotePurged: [...purged],
      quickPurges: quickPurgeRows.map((d) => d.id), quickPurgeTimes,
    };
  }

  return { loadState, saveState, loadQuickPushState };
}

