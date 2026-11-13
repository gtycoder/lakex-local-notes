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
import type { DiaryFolderSpace } from "../../diary.js";

/** 同步目录行（世界投影）。 */
export interface SyncFolderRow {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  nodeType: "notebook" | "group";
  icon: string | null;
  updatedAt: string;
  /** 日记本标记（261109，docs/DIARY.md）：缺省/未知 = 非日记（由 core 归一成 null）。 */
  space?: DiaryFolderSpace | null;
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
  /** 文档标签关系（261105 P1）：本机顺序（展示用）；缺省/空 = 无标签。 */
  tagIds?: string[];
  /** 文档标签关系版本（LWW；缺省 = ""）。 */
  tagsUpdatedAt?: string;
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

/** 标签目录同步行：**不含顺序、不含墓碑**（顺序是设备本地视图；删除 = 缺席）。 */
export interface QuickTagRow {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuickDeletedRow {
  id: string;
  purgedAt?: string | null;
  /** 软删时刻（261113 C1）：用于「墓碑 vs 远端恢复」LWW —— 远端条目比墓碑新 ⇒ 恢复赢，不能压。
   *  平台拿不到时留空：core 按旧行为（墓碑优先）保守处理，绝不因为缺时间戳去复活。 */
  deletedAt?: string;
}
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
  /** 单条小记同步行（可选，261110 单条推送提速）：只读这一条（含标签关系），不读其它小记正文。
   *  【缺失退化】core 回退 listQuickNotesForSync()（读全部小记行，语义不变）。 */
  getQuickNoteSyncRow?(id: string): Promise<QuickNoteSyncRow | null>;
  listQuickTags(): Promise<QuickTagRow[]>;
  /** 小记可恢复删除（软删/学习墓碑）：口径由平台沿用各自旧实现（桌面含已 purge 行、移动不含）。 */
  listQuickDeleted(): Promise<QuickDeletedRow[]>;
  /** 小记本地彻底删除墓碑（purged_at 非空）。 */
  listQuickPurges(): Promise<QuickPurgeRow[]>;
  /** 本地 purge 墓碑（文档/目录）。 */
  listPurgedTombstones(): Promise<PurgedTombstoneRow[]>;
  listRestorePendingNoteIds(): Promise<string[]>;
  listRestorePendingQuickNoteIds(): Promise<string[]>;
  /** 「云端已删除·仅本地」DB 投影 id（可选，261110 单条推送提速）：只读标记列/表，不扫全库世界。
   *  【缺失退化】core 回退 listFoldersForSync + listNotesSyncMeta + listQuickNotesForSync 逐行取 cloudDeleted。 */
  listCloudDeletedIds?(): Promise<{ folders: string[]; notes: string[]; quickNotes: string[] }>;
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
  /**
   * 同步专用正文写入（261112 P0）：与 saveNote 的唯一差异 = **允许写「已进回收站」的行**
   * （保留 trashed 状态/父级，只更新正文/标题/派生缓存）；purged / 已删仍拒绝。
   * 场景：本地把文档移入回收站（软删）后，他端又编辑并发布该文档 —— 内容编辑与位置移动是独立字段，
   * 必须能应用正文而不隐式恢复、也不能整轮失败。
   * 缺省 = 平台未接入 ⇒ core 回落 saveNote（旧行为，可能被用户保存守卫拒绝）。
   */
  saveSyncedNote?(noteId: string, title: string, content: string, caches: NoteSearchCaches | null): Promise<void>;
  /** expectedLocalUpdatedAt = 本轮开始时的本地快照 updatedAt：平台只在当前 DB 仍等于它时才覆盖，
   *  防止同步窗口内用户改名/恢复被远端旧元数据覆盖（261107 数据安全）。 */
  applyRemoteNoteMeta(note: SyncNoteWrite, expectedLocalUpdatedAt?: string): Promise<void>;
  applyRemoteEditLock(noteId: string, locked: boolean, editLockedAt: string | null): Promise<void>;
  /**
   * 文档标签关系 LWW（261105 P1）：远端关系更新时落库。
   * 语义 = 关系版本 LWW + **保留本机顺序、远端新增插最前**；只接受目录里存在的 tag id（未知 id 过滤，展示层兜底）。
   * 不实现 = 该端未接入文档标签（发布侧仍会保留索引里的字段，不主动清空）。
   */
  applyNoteTagLinks?(noteId: string, tagIds: string[], tagsUpdatedAt: string): Promise<void>;
  /**
   * 文档标签关系版本批量读（261105 P2-E）：返回「文档 id → tag_link_versions.links_updated_at」。
   * 供 saveState 每轮只查一次，避免 2 万文档逐篇 SELECT；**只报有版本的行**（无行 = 无版本旧数据）。
   * 缺失 = 该端未接入批量读 ⇒ core 退化逐篇调用 applyNoteTagLinks（旧行为不变）。
   */
  listNoteTagVersions?(): Promise<Map<string, string>>;
  /**
   * 目录收敛（每轮 saveState 末尾、目录合并之后调用）：清掉指向**目录不存在标签**的文档关系。
   * 与 applyNoteTagLinks 分两步：同一轮里目录可能刚随 quick-notes 索引到达（先按远端 id 落关系，
   * 再按最终目录过滤），避免首轮同步因本机目录尚未合并而丢掉全部文档标签。
   */
  pruneNoteTagLinks?(validTagIds: readonly string[]): Promise<void>;
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
  /**
   * 目录落库（单事务）：
   *  - upsert 给定 active 行（name/createdAt/updatedAt；**不碰本机 sort_order**）；
   *  - `removedIds` = 本轮判定删除的标签：物理删除行 + 清 `tag_links`/`tag_link_versions`（含文档标签关联）。
   *    传不存在的 id 是 no-op（幂等）。
   */
  mergeQuickTags(tags: QuickTagRow[], removedIds?: readonly string[]): Promise<void>;
  /** 本机待删标签 id（离线删过、还没确认远端缺席）；**不上传**，仅设备本地。缺省 = []。 */
  listPendingTagDeletes?(): Promise<string[]>;
  /** **追加**待删 id（幂等）。用追加而不是覆盖写：同步轮进行中用户又删了一个标签时，
   *  覆盖写会把这条新待删丢掉 ⇒ 下一轮远端重发就复活。缺省 = 不持久化（降级为每轮重算）。 */
  addPendingTagDeletes?(ids: readonly string[]): Promise<void>;
  /** **结算**：远端已确认缺席的 id 可以从待删集合移除（其余保留）。缺省 = 不结算（只影响体积，不影响正确性）。 */
  settlePendingTagDeletes?(ids: readonly string[]): Promise<void>;
  purgeQuickNote(quickNoteId: string): Promise<void>;
  deleteQuickNote(quickNoteId: string): Promise<void>;
  markQuickNotesCloudDeleted(quickNoteIds: string[]): Promise<void>;
  /** 从未同步过的小记从 state 消失 ⇒ 物理删除（行+正文+图片，不留墓碑/不传删除）。
   *  移动实现；桌面不实现 ⇒ core 回落「软删+打标」（= 迁移前桌面行为，语义不变）。 */
  discardQuickNote?(quickNoteId: string): Promise<void>;
}
