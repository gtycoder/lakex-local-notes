import type { Manifest, ManifestFolder, ManifestNote } from "./manifestTypes.js";

/** B3：冲突归档（superseded）快照保护窗口（天）。引擎在远端覆盖本机编辑的强制留档处请求保护；
 * 桌面 store 落 protected_until（未到期自动清理跳过、手动删除不受限）；移动端简化 schema 无保护、忽略。 */
export const HISTORY_SNAPSHOT_PROTECT_DAYS = 30;

export interface SyncConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
}

/** 对象存储端口（平台注入）：key 为含 prefix 的完整对象键 */
export interface S3Store {
  /** 读取对象；404 返回 null（首次同步判定），其他错误抛出。
   * 返回**已解压**字节（gunzip 在端口内完成，syncEngine 不感知 gzip——红线 §3.2）。
   * opts.maxBytes：超出上限抛错（单对象大小护栏，对齐桌面 sync.ts:507/523）。 */
  getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null>;
  /** 写入对象；opts.gzip 由端口压缩（manifest 传 {gzip:true}，正文/资源不压缩）。 */
  putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void>;
  /**
   * 流式上传（桌面实现；移动端/测试桩可不实现走字节路径回退）。
   * open 返回 Node Readable（本地文件流）；size 为文件字节数（显式 Content-Length，
   * 避免 aws-chunked 编码——七牛 Kodo 兼容性实测验证）。返回 null = 本地文件缺失。
   */
  putObjectStream?(key: string, size: number, open: () => Promise<unknown | null>): Promise<void>;
  /** 列出某前缀下的对象（GC 用；lastModified 用于年龄保护）。 */
  listObjects?(prefix: string): Promise<Array<{ key: string; lastModified: string; size: number }>>;
  /** 批量删除对象（GC 用）。返回删除数量。 */
  deleteMany?(keys: string[]): Promise<number>;
}

export interface SyncReport {
  pulled: boolean;
  appliedRemote: number;
  uploaded: number;
  published: boolean;
  message: string;
  warnings: string[];
  /** 本地修改被远端覆盖、已强制留档的文档（对齐桌面 SyncResult.supersededNotes，UI 提醒用）。 */
  supersededNotes: Array<{ id: string; title: string }>;
  /** 同步统计（思源式 tooltip 展示）：上传/下载的目录数与字节数（正文 + 资源 + manifest）。 */
  foldersUploaded: number;
  /** 本次同步移入回收站的文档数：trashedDown=下载方向应用远端墓碑（新增入回收站，不含已一致的重复应用）；
   * trashedUp=上传方向本端软删条目发布。UI"移入回收站"展示用。 */
  trashedDown: number;
  trashedUp: number;
  foldersDownloaded: number;
  uploadedBytes: number;
  downloadedBytes: number;
}

export interface LocalNoteRow {
  /** P3-1 契约：getAllNotes 批量路径只保证元数据 + contentHash，content 可为 ""（桌面 adapter 不读全文）；
   * 需要正文的时刻（留历史快照、上传入队）用 getNote(id) 显式回查。 */
  id: string; title: string; content: string; updatedAt: string; syncState: string;
  trashedAt: string | null; restorePendingAt: string | null; parentId: string | null; sortOrder: number;
  /** 协议字段透传（D9）：锁/图标/冲突标记不得因移动端不展示而丢失（红线 §3.5）。 */
  isLocked: boolean; lockedAt: string | null; icon: string | null; isConflict: boolean;
  /** 当前本地内容 hash（桌面 adapter 用 store.contentHash 提供，避免为算 hash 读 content；
   * 移动端不传则 syncEngine 读 content 自行计算）。 */
  contentHash?: string;
  /** 删除前父目录（回收站条目恢复位置；软删上传必须用它而非删除后的 parentId=TRASH）。 */
  deletedFromParentId?: string | null;
  /** v6：文档类型（缺省 doc）。 */
  kind?: "doc" | "sheet" | "bitable" | "board";
}

export interface SyncDbPort {
  getNote(id: string): Promise<LocalNoteRow | null>;
  getAllNotes(): Promise<LocalNoteRow[]>;
  getSyncBase(id: string): Promise<{ contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null } | null>;
  /** 批量读 hash 账本（可选；提供时同步环一次预载，替代逐条 getSyncBase 的原生往返）。 */
  getAllSyncBases?(): Promise<Map<string, { contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null }>>;
  /** 可选：窗口级批量写（仅 applyRemoteNote 缓冲，窗口末 flush；未实现=逐条即时写）。 */
  beginNoteBatch?(): Promise<void>;
  flushNoteBatch?(): Promise<void>;
  applyRemoteNote(note: ManifestNote, content: string): Promise<void>;
  /** 远端墓碑应用：先拉内容再标记回收站（先内容、后标志；保留可恢复） */
  applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, deletedFromParentId: string | null, parentId: string | null, sortOrder: number): Promise<void>;
  /** 本地软删（入回收站）：保留内容，sync_state=local */
  localTrashNote(id: string): Promise<void>;
  /** 本地恢复：移出回收站 + restore_pending_at（同步时 local-wins 上传 active 覆盖墓碑） */
  localRestoreNote(id: string): Promise<void>;
  /** 收到他端 purge 墓碑（deleted:true）：本地条目移入回收站并标 purged（保留可恢复、不上传）。 */
  applyRemotePurge(id: string): Promise<void>;
  /** 本地删除墓碑列表（deleted_notes 表：本设备从未持有或已彻底删除的）——远端恢复撤销判定用。
   * 返回 null = 端口不支持（移动端无 deleted_notes 场景时可不实现，撤销判定退化）。
   * nodeType：'note' 进 manifest.notes；'folder' 进 manifest.folders 墓碑（v5 删除传播，
   * 发布侧需要 title/parentId/sortOrder 构建墓碑条目，两端实现均返回完整字段）。 */
  listDeletedNotesForSync?(): Promise<Array<{ id: string; deletedAt: string; title?: string; nodeType?: string; parentId?: string | null; sortOrder?: number; updatedAt?: string }>>;
  /** 墓碑已发布到 manifest 后标记（port 无此能力则跳过，计数降级为按全部墓碑）。 */
  markTombstonesPublished?(ids: string[]): Promise<void>;
  /** 读墓碑笔记的删除前内容（墓碑携带内容，他端先拉内容再应用；读失败/不支持 → null 占位符）。 */
  readDeletedContent?(id: string): Promise<string | null>;
  /** 强制读真实内容 hash（远端缺失时回退全量扫描，对齐桌面 cachedBase 优化边界）。 */
  forceHashRead?(id: string): Promise<string | null>;
  /** 撤销本地删除墓碑（远端恢复较新，下载分支调用；对齐桌面 store.revokeLocalDeletion）。 */
  revokeLocalDeletion?(id: string): Promise<void>;
  /** 目录记账：同步后标记 folder 为 synced（对齐桌面 store.markFolderSynced；移动端无目录编辑可不实现）。 */
  markFolderSynced?(id: string, expectedUpdatedAt: string): Promise<boolean>;
  /** 本地已彻底删除（purge）的 folder/group（deleted_notes 带 purged_at）：下载导入远端 folders 前过滤，
   * 防"清空回收站后同步 → 被删笔记本重新导入复活"；发布时检测到也应强制重写 manifest 移除云端残留。 */
  isFolderPurged?(id: string): Promise<boolean>;
  /** 记录"从云端学到的删除"（本设备从未持有该笔记），防离线设备把残留当新文档上传复活（审计 #2）。 */
  rememberDeleted(note: ManifestNote, deletedAt: string): Promise<void>;
  /** v5：收到远端 folder 墓碑且本地有活跃行 → folder 子树移入回收站标 purged（行保留可恢复、不上传），
   * 子 notes 对齐 applyRemotePurge 语义。两端必须实现（与 markFolderSynced 同级，缺失时引擎跳过并记日志）。 */
  applyRemoteFolderDelete?(id: string, deletedAt: string): Promise<void>;
  /** v5：记录"从云端学到的 folder 删除"（本设备从未持有该目录），写 node_type='folder' 墓碑防复活；
   * 不写 purged_at（S3 对象前缀由发起端清理）。 */
  rememberFolderDeleted?(folder: ManifestFolder, deletedAt: string): Promise<void>;
  /** 正文相同但元数据（标题/父/排序/图标）变化时应用远端较新版本（B3 LWW）。 */
  applyRemoteNoteMeta(note: ManifestNote): Promise<void>;
  /** 锁字段级 LWW：应用远端锁状态（锁变更不改正文哈希，需独立应用）。 */
  applyRemoteLock(id: string, locked: boolean, lockedAt: string | null): Promise<void>;
  /** lastUploadedHash 传 null = 两端一致 skip 记账（本机未上传该版本内容，须清除误标，防 ownEdit 重复留档）。 */
  markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string | null): Promise<void>;
  /** 记账快照保护（B2，V5 §5.2）：仅当本地当前内容 hash 仍等于 expectedContentHash（同步期间未编辑）才标 synced；否则保持 local 下轮重传。
   * lastUploadedHash 传 null = 下载对账收尾（本机未上传该版本，不得误标"本机是作者"）。 */
  markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string | null): Promise<void>;
  setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null): Promise<void>;
  /** 兜底父笔记本 id（系统中没有"默认笔记本"；实现 = 任意存在的笔记本，无则自动创建"未分类"）。 */
  defaultNotebookId(): Promise<string>;
  /** 导入远端 notebook/group 节点（移动端 folders/tree 表）。 */
  importRemoteFolder(folder: ManifestFolder): Promise<void>;
  /** 发布方向：列出本地目录树（notebook/group），供 manifest.folders 写入（对齐桌面 listFoldersForSync）。
   * 返回 null = 端口不支持本地目录发布（POC 只读 folders 时可不实现，folders 保持远端透传）。 */
  listFoldersForSync?(): Promise<Array<{ id: string; title: string; parentId: string | null; sortOrder: number; nodeType: string; icon: string | null; updatedAt: string; trashedAt?: string | null; deletedFromParentId?: string | null }>>;
  /** 本机编辑成果被远端覆盖前强制留档（D5，协议 §4.2）：写一条 note_history，防丢数据。 */
  createHistorySnapshot(noteId: string, content: string, meta: { title: string; parentId: string | null; sortOrder: number; protectedDays?: number }): Promise<void>;
  /** 资产落地（D8）：把已校验的图片字节写入本地（Capacitor Filesystem / IndexedDB），供本地资源服务显示。 */
  saveAsset(noteId: string, filename: string, bytes: Uint8Array): Promise<void>;
  /** 资产上传扫描（H3）：列出笔记的本地资产（filename + size + sha256），供 manifest.assets 上传。 */
  listLocalAssets(noteId: string): Promise<Array<{ filename: string; size: number; hash: string }>>;
  /** A 方案：记录 manifest 声明的资产元数据（即使本地文件缺失，上传 union 仍可正确声明）。 */
  recordDeclaredAssets?(noteId: string, assets: Array<{ filename: string; size: number; hash: string }>): Promise<void>;
  /** A 方案：列出该笔记已声明（含本地缺失但 manifest 声明过）的资产元数据。 */
  listDeclaredAssets?(noteId: string): Promise<Array<{ filename: string; size: number; hash: string }>>;
  /** 资产上传扫描（H3）：读取本地资产字节（供上传 S3）。 */
  readLocalAsset(noteId: string, filename: string): Promise<Uint8Array | null>;
  /** 资产流式上传（桌面实现）：打开本地资产文件流；缺失返回 null。syncEngine 探测到
   * 本方法 + S3Store.putObjectStream 同时存在才走流式，否则字节路径。 */
  openLocalAssetStream?(noteId: string, filename: string): Promise<unknown | null>;
  /** 零变更早退：本设备上次成功读/写的 manifest commitId（无则 null）。 */
  getLastSeenCommitId(): Promise<string | null>;
  setLastSeenCommitId(commitId: string): Promise<void>;
  /** 零变更早退：本地上次同步时的墓碑签名（COUNT:MAX(deleted_at)）。 */
  getLastTombstoneSig(): Promise<string>;
  setLastTombstoneSig(sig: string): Promise<void>;
  /** 零变更早退：deleted_notes 的 COUNT:MAX(deleted_at) 签名。 */
  tombstoneSignature(): Promise<string>;
  /** 零变更早退：本地是否有待上传变更（notes 非 synced 或目录/分组改动）。 */
  hasLocalPendingNotes(): Promise<boolean>;
  log(msg: string): Promise<void>;
}

export interface SyncNowOptions {
  /** 进度上报（桌面 UI 用；移动端可不传）。phase 阶段与桌面 sync.ts 对齐。 */
  onProgress?: (phase: string, message: string) => void;
  /** 本机编辑被远端覆盖前的留档钩子（桌面 createHistorySnapshot；移动端已由 SyncDbPort.createHistorySnapshot 覆盖）。 */
  onSuperseded?: (noteId: string, content: string) => void;
  /** 发布后回调（next + prev manifest）：桌面 GC 差集标记（4.5）用；移动端可不传。 */
  onPublished?: (next: Manifest, prev: Manifest | null) => void;
  /** 严格资源语义（桌面=true，对齐 sync.ts 资源缺失跳过整条目；移动端默认 false 宽松图片占位）。 */
  strictAssets?: boolean;
}
