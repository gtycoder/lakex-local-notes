/**
 * `PlatformDataPort`：单一 DeviceStore 实现的**窄平台数据端口**（E2-4 phase B，261029）。
 *
 * 按真实调用点冻结（不是先写接口）：桌面迁移时从 `desktopStoreAdapter` 的 loadState/saveState/
 * saveFolders/saveQuickNotes 逐段抽出 `store.xxx()` / `quickNotes.xxx()` 的依赖；
 * 移动端 phase C 用 noteRepository/noteBodies/historyRepository 实现同一端口。
 *
 * 设计约束：
 * - **只做数据 CRUD**，不做决策（合并/LWW/墓碑判定/信封推导全在 core/state/deviceStore.ts）；
 * - 全部异步（桌面同步 Store 用 Promise 包装）；
 * - 幂等/事务语义：
 *   * 行写入类方法必须自身幂等（同一 state 重复 apply 不产生重复行/不抖动 updatedAt）；
 *   * 批量方法（applyNotesCloudDeleted / markBodyRecoveryPending / mergeQuickTags）在实现侧用单事务；
 *   * 读方法只读，不得顺带写库（诊断/体检一致性）；
 * - 错误语义：抛错 = 本轮同步失败（core 会按 note/folder id 包上上下文再抛）；"缺失"用 null/[] 表达，不抛。
 */
import type { NoteKind } from "../../noteKind.js";

/** 同步目录行（世界投影）。 */
export interface SyncFolderRow {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  nodeType: "notebook" | "group";
  icon: string | null;
  updatedAt: string;
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
  /** 移动端 DB 投影（cloud_deleted=1 = 「云端已删除·仅本地」副本）：core 会并入 remotePurged。 */
  cloudDeleted?: boolean;
}

/** 同步笔记元数据行（不读正文；contentHash 可为空 = 需要读盘算）。 */
export interface SyncNoteMetaRow {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  contentHash?: string | null;
  kind?: string | null;
  icon?: string | null;
  isEditLocked?: boolean;
  editLockedAt?: string | null;
  isConflict?: boolean;
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
  /** 移动端 DB 投影（见 SyncFolderRow）与 baseline 资产 hash 兜底；桌面不填。 */
  cloudDeleted?: boolean;
  assetsHash?: string;
}

/** 小记同步行（标签关系一并带出，避免 core 逐条回查）。 */
export interface QuickNoteSyncRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  isConflict?: boolean;
  tagIds: string[];
  tagsUpdatedAt: string | null;
  /** 移动端 DB 投影（小记「云端已删除·仅本地」副本）与 baseline 资产 hash 兜底；桌面不填。 */
  cloudDeleted?: boolean;
  assetsHash?: string;
  /** 已在 quick 回收站（小记软删副本）：saveState 的「state 中缺失」分支必须跳过，保持原状。 */
  deletedAt?: string | null;
}

export interface QuickTagRow {
  id: string;
  name: string;
  sortOrder: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface QuickDeletedRow { id: string; purgedAt?: string | null }
/** 小记本地彻底删除墓碑（purged_at 非空）：与 quickDeletes 分开取，两端口径差异由平台实现决定。 */
export interface QuickPurgeRow { id: string; purgedAt: string }
export interface PurgedTombstoneRow { id: string; purgedAt?: string | null }

/** core → 平台的笔记写入形态（映射规则在 core；平台只落库）。 */
export interface SyncNoteWrite {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  contentHash: string;
  isConflict: boolean;
  isEditLocked: boolean;
  editLockedAt: string | null;
  icon: string | null;
  trashedAt: string | null;
  deletedFromParentId: string | null;
  kind: NoteKind;
}

/** core → 平台的小记写入形态。 */
export interface QuickNoteWrite {
  id: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  isConflict: boolean;
}

export interface QuickAssetWrite { filename: string; bytes: Uint8Array }

/** 正文解析后的派生缓存（由 core 用 core/noteSearchText 计算后交给平台落 FTS；空段落可能为 null）。 */
export interface NoteSearchCaches { markdown: string | null; plain: string | null }

/**
 * 窄数据端口（桌面/移动各一份适配；约 25 个方法，全部来自真实调用点）。
 * 命名与 Store/QuickNotesStore 的既有语义对齐，便于薄壳实现。
 */
export interface PlatformDataPort {
  // ===== 世界投影（只读；loadState / saveFolders 用）=====
  listFoldersForSync(): Promise<SyncFolderRow[]>;
  listNotesSyncMeta(): Promise<SyncNoteMetaRow[]>;
  listQuickNotesForSync(): Promise<QuickNoteSyncRow[]>;
  listQuickTags(): Promise<QuickTagRow[]>;
  /** 小记可恢复删除（软删/学习墓碑）：口径由平台沿用各自旧实现（桌面含已 purge 行、移动不含）。 */
  listQuickDeleted(): Promise<QuickDeletedRow[]>;
  /** 小记本地彻底删除墓碑（purged_at 非空）。 */
  listQuickPurges(): Promise<QuickPurgeRow[]>;
  /** 本地 purge 墓碑（文档/目录）。 */
  listPurgedTombstones(): Promise<PurgedTombstoneRow[]>;
  listRestorePendingNoteIds(): Promise<string[]>;
  listRestorePendingQuickNoteIds(): Promise<string[]>;
  listBodyRecoveryPending(): Promise<string[]>;

  // ===== 路径 / 存在性 =====
  /** 文档正文文件路径（FileDriver 命名空间）。 */
  noteBodyPath(noteId: string): string;
  /** 小记正文文件路径（FileDriver 命名空间）。 */
  quickNoteBodyPath(quickNoteId: string): string;
  hasNote(noteId: string): Promise<boolean>;
  hasTreeNode(nodeId: string): Promise<boolean>;
  /** 兜底父笔记本（无则懒建「未分类」）。 */
  defaultNotebookId(): Promise<string>;

  // ===== 批量/生命周期钩子（E2-4 phase C-2：移动 executeSet 批窗口 / staging / DB 投影）=====
  /** 批量写窗口：core 在批量阶段前 begin、语句提交处 flush；不实现 = 逐行即时写（桌面）。 */
  beginWriteBatch?(): Promise<void>;
  flushWriteBatch?(): Promise<void>;
  /** 引擎 writeBody 已落 staging 文件（移动，不在 JS 内存）：把 staging 搬到最终正文路径。
   *  不实现 = 桌面（staged 正文在内存，直接随 import/save 落盘）。 */
  moveStagedBodyFiles?(items: ReadonlyArray<{ id: string; kind: NoteKind }>): Promise<void>;

  // ===== 文档写 =====
  /** content = null 且 opts.staged = true：正文在 staging 文件（移动端），行只落元数据/远端 hash。
   *  content 非 null：正文随调用落盘（桌面 / 移动 legacy 路径）。 */
  importRemoteNote(note: SyncNoteWrite, content: Uint8Array | null, opts?: { staged?: boolean }): Promise<void>;
  /** 已有行 + staged 正文（移动端）：只更新行（元数据/远端 contentHash），正文由 moveStagedBodyFiles 搬。
   *  桌面 staged 正文在内存 ⇒ 不实现（core 走 saveNote/importRemoteNote）。 */
  applyStagedBodyNote?(note: SyncNoteWrite): Promise<void>;
  /** caches 由 core 用 core/noteSearchText 预计算（doc 才有；其它类型为 null，平台自行按 kind 派生）。 */
  saveNote(noteId: string, title: string, content: string, caches: NoteSearchCaches | null): Promise<void>;
  applyRemoteNoteMeta(note: SyncNoteWrite): Promise<void>;
  applyRemoteEditLock(noteId: string, locked: boolean, editLockedAt: string | null): Promise<void>;
  setNodeIcon(noteId: string, icon: string): Promise<void>;
  /** 软删（进回收站），不得物理删除。用于「远端墓碑 → 本地进回收站」。 */
  deleteNote(noteId: string): Promise<void>;
  /** 本地「state 中缺失」的收敛删除：移动 = 写 deleted_notes 墓碑（purged_at）+ 删行/正文（删除传播）；
   *  桌面不实现 ⇒ core 回落 deleteNote（软删进回收站 = 迁移前桌面 I0 语义，行为不变）。 */
  purgeLocalNote?(noteId: string): Promise<void>;
  restoreTrashItem(noteId: string): Promise<void>;
  applyNotesCloudDeleted(noteIds: string[]): Promise<void>;
  /** 「云端已删除·仅本地」DB 投影（移动：单事务全清再置位 + 400 分批）；不实现 = core 用 applyNotesCloudDeleted。 */
  applyCloudDeletedProjection?(noteIds: readonly string[]): Promise<void>;
  markBodyRecoveryPending(noteIds: string[]): Promise<void>;
  clearBodyRecoveryPending(): Promise<void>;

  // ===== 目录写 =====
  importRemoteFolder(folder: SyncFolderRow): Promise<void>;
  applyRemoteFolderMeta(folder: SyncFolderRow): Promise<void>;
  /** 删除目录树节点（core 只对「本轮 state 里没有」的目录调用；调用方保证非兜底目录）。 */
  deleteTreeNode(nodeId: string): Promise<void>;

  // ===== 小记写 =====
  listMissingQuickNoteIds(): Promise<string[]>;
  /** 行在、正文文件没了的小记收尸（purge 语义由平台实现）。 */
  purgeOrphanQuickNote(quickNoteId: string): Promise<void>;
  importRemoteQuickNote(item: QuickNoteWrite, body: Uint8Array, assets: QuickAssetWrite[]): Promise<void>;
  markQuickNoteSyncedIfUnchanged(quickNoteId: string, expectedContentHash: string): Promise<void>;
  applyQuickNoteTagLinks(quickNoteId: string, tagIds: string[], tagsUpdatedAt: string): Promise<void>;
  mergeQuickTags(tags: QuickTagRow[]): Promise<void>;
  purgeQuickNote(quickNoteId: string): Promise<void>;
  deleteQuickNote(quickNoteId: string): Promise<void>;
  markQuickNotesCloudDeleted(quickNoteIds: string[]): Promise<void>;
  /** 从未同步过的小记从 state 消失 ⇒ 物理删除（行+正文+图片，不留墓碑/不传删除）。
   *  移动实现；桌面不实现 ⇒ core 回落「软删+打标」（= 迁移前桌面行为，语义不变）。 */
  discardQuickNote?(quickNoteId: string): Promise<void>;
}
