/**
 * 渲染层 / IPC 对外类型（UI 与 Electron 共用）。
 *
 * CORE-10 tail（261028）：**两端共享的领域类型已下沉为 src/core/sharedTypes.ts 的定义处**，这里
 * re-export 保持既有 import 路径不变；core 生产文件不再 import 本文件（依赖方向 = lib → core）。
 * 渲染层/外壳专属类型（NoteSummary、SyncResult、SyncProgress、S3 设置、诊断报告…）仍定义在本文件。
 */
import type { S3v3DiagnosticReport } from "../core/s3v3Report";
import type { NoteKind } from "../core/noteKind";
import type { QuickNoteSummary, SyncWarning } from "../core/sharedTypes";

export type {
  NoteInfo,
  NoteInfoAsset,
  QuickNoteContent,
  QuickNoteDocument,
  QuickNoteImage,
  QuickNoteSummary,
  SyncSettings,
  SyncWarning,
  SyncWarningKind,
  TreeNode,
  TreeNodeType,
} from "../core/sharedTypes";

export interface NoteSummary {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  /** 独立 purged 标记。 */
  isPurged?: boolean;
  /** v3：云端已彻底删除、本机仅保留回收站副本（「云端已删除 · 仅本地」）。 */
  cloudDeleted?: boolean;
  /** UI 待同步标记（v3 发布成功后清 0；不参与同步正确性）。 */
  isDirty?: boolean;
  isConflict: boolean;
  isEditLocked?: boolean;
  editLockedAt?: string | null;
  /** 文档类型（doc | usheet | bitable | board | ink；缺省 doc）。渲染层据此选择编辑器。 */
  kind?: NoteKind;
}

export interface NoteDocument extends NoteSummary {
  content: string;
  /** 正文文件缺失（被手动删除等）：content 为空串；打开时按只读处理，同步不会上传空正文。 */
  bodyMissing?: boolean;
  /**
   * 正文的 sha256（Batch4-D 保存版本守卫）：打开/保存时由主进程计算并回传，
   * 渲染层存进标签页当 baseHash；下次保存带上它，磁盘内容若已变（外部/他端写）就**不写盘**并返回冲突。
   * 缺省（旧调用 / 正文缺失）⇒ 不参与守卫，保持旧行为。
   */
  contentHash?: string;
}

// ===== 同步记录账本（P1 第 4 项：只记「远端覆盖本地 / 他端删除 / 保存时磁盘被改」） =====

/** 事件类型（与 src/core/syncConflictLog.ts 的 SyncConflictKind 同口径）。 */
export type SyncConflictKind = "remote_wins" | "remote_purged" | "save_external_changed";
/** 记录所属空间（Lake 文档 / 小记）。 */
export type SyncConflictSpace = "lake" | "quickNotes";

/** 一条同步记录（设备本机账本行；**不进 S3、不进 git**）。 */
export interface SyncConflictRow {
  id: string;
  noteId: string;
  space: SyncConflictSpace;
  kind: SyncConflictKind;
  /** ISO 时间（本轮同步时间 / 保存拦截时间）。 */
  at: string;
  /** 记账时的标题快照。 */
  title?: string | null;
  /** 被覆盖的本地版本 hash 与远端版本 hash（审计/对账用，可为空）。 */
  localHash?: string | null;
  remoteHash?: string | null;
  /** 被覆盖版本对应的历史快照引用（「恢复本地被覆盖版」用；无快照为空）。 */
  historyRef?: string | null;
  /** 已读时间（ack 只影响角标，不删数据）。 */
  ackedAt?: string | null;
  /** 已处理时间（恢复成功等）。 */
  resolvedAt?: string | null;
  /** 处理方式（如 restored）。 */
  resolution?: string | null;
}

/** list_sync_conflicts 的返回：按时间倒序 + 未读数（角标）。 */
export interface SyncConflictsSnapshot {
  items: SyncConflictRow[];
  unacked: number;
}

/** restore_sync_conflict 的结果（失败给可读原因，绝不静默）。 */
export type RestoreSyncConflictResult =
  | { ok: true; noteId: string; restoredFromHistory: boolean }
  | { ok: false; reason: "history-missing" | "history-expired" | "not-found" | string; message?: string };

/** 文档 ↔ 标签关系（主库 tag_links(target_kind='note')）：noteId → tagIds（本机 position 顺序）。 */
export type DocumentTagLinks = Record<string, string[]>;

// ===== 保存版本守卫（Batch4-D）：外部/他端改过正文时不静默覆盖 =====

/** 唯一冲突码（IPC 与 UI 文案的单一来源）。 */
export const SAVE_CONFLICT_CODE = "external_changed" as const;
export type SaveConflictCode = typeof SAVE_CONFLICT_CODE;

/** 保存被磁盘版本拦下（未写盘）：渲染层据此弹三选项确认。 */
export interface SaveNoteConflict {
  ok: false;
  code: SaveConflictCode;
  noteId: string;
  /** 磁盘当前正文的 sha256：用于审计与「覆盖磁盘」时的显式 baseHash 重试。 */
  diskHash: string;
}

/** save_note 的返回：正常保存回 NoteDocument；被磁盘版本拦下回 SaveNoteConflict。 */
export type SaveNoteResult = NoteDocument | SaveNoteConflict;

/** 正文变更广播的载荷（261110；判据见 src/core/noteBodyBroadcast.ts）。 */
export type { NoteBodyChangedDetail } from "../core/noteBodyBroadcast";

/** save_note 类型判别（主进程与渲染层共用，不要各自写 `"code" in x`）。 */
export function isSaveConflict(value: unknown): value is SaveNoteConflict {
  if (!value || typeof value !== "object") return false;
  const v = value as { ok?: unknown; code?: unknown; diskHash?: unknown; noteId?: unknown };
  return v.ok === false && v.code === SAVE_CONFLICT_CODE && typeof v.diskHash === "string" && typeof v.noteId === "string";
}

/** 冲突确认弹窗文案（单一来源）。 */
export const SAVE_CONFLICT_MESSAGE =
  "磁盘上的正文已经和打开时不一样（可能是另一个窗口、同步或外部工具写入）。为避免覆盖对方的改动，本次没有写入。";

/** 笔记的轻量状态摘要（同步后刷新打开 tab 用）。
 * 只读 DB 行，不读正文文件；updatedAt/title 变化或 deleted 即表示需要全量拉取。 */
export interface NoteDigest {
  id: string;
  title: string;
  updatedAt: string;
  deleted: boolean;
}

export interface WorkspaceSnapshot {
  workspaceId: string;
  workspaceName: string;
  notes: NoteSummary[];
  lastOpenedNoteId: string | null;
  sync: SyncStatus;
}

export interface S3GcSettings {
  gcRetentionDays: number;
  gcIntervalHours: number;
  trashAutoPurgeDays: number;
}
export interface S3GcLogItem {
  id: number;
  ts: string;
  action: string;
  key: string;
  reason: string;
  commitId: string | null;
  deviceId: string | null;
  ok: boolean;
}
export interface DeepCleanupResult {
  dryRun: boolean;
  /** v3 统一清理：本次删除/保留的对象 key。 */
  deleted: string[];
  kept: number;
}
export interface QuickNoteTrashItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
  /** v3：云端已彻底删除、本机仅保留回收站副本。 */
  cloudDeleted?: boolean;
}

/** S3 连接配置：单一来源 = src/core/syncUtils.ts（261029 三处定义收口；本文件只 re-export）。 */
export type { S3Settings } from "../core/syncUtils";

export interface SyncStatus {
  phase: "idle" | "syncing" | "success" | "error";
  message: string;
  lastSyncedAt: string | null;
  pendingChanges: number;
}

export interface DraftJournalEntry {
  noteId: string;
  title: string;
  content: string;
  updatedAt: string;
}

/** Local sync facts only; resource bytes are diffed during sync, not counted from content references. */
export interface SyncPendingSummary {
  documents: number;
  folders: number;
  resources: number;
  quickNotes: number;
  total: number;
  generatedAt: string;
}

export interface QuickNotesSyncStatus {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  completedAt: string;
  error?: string;
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  manifestId: string;
  completedAt: string;
  /** 同步统计（思源式 tooltip）：上传/下载的目录数与字节数（正文 + 资源 + manifest）。 */
  foldersUploaded?: number;
  foldersDownloaded?: number;
  uploadedBytes?: number;
  downloadedBytes?: number;
  /** 261028：上传/下载细分（文档/小记）；旧 uploaded/downloaded 仍为总数。 */
  uploadedDocuments?: number;
  downloadedDocuments?: number;
  uploadedQuickNotes?: number;
  downloadedQuickNotes?: number;
  /** 本次同步总耗时（毫秒）。 */
  durationMs?: number;
  /** 本次同步移入回收站的文档数。 */
  trashed?: number;
  /** 小记失败不否定 Lake 同步成功。 */
  quickNotes?: QuickNotesSyncStatus;
  /** 本地修改被远端覆盖、已存入历史的文档（用于 UI 提醒） */
  supersededNotes: Array<{ id: string; title: string }>;
  /** V5 §5.5：远端对象/资源缺失（B 方案——跳过受影响条目、不覆盖本地、其余继续；manifest 损坏仍中止）。 */
  warnings?: SyncWarning[];
}

/** 261105 Batch4-E：自动备份设置（本机 settings；不进 git/同步）。 */
export interface BackupSettingsShape {
  enabled: boolean;
  /** 1 = 每天，7 = 每周。 */
  intervalDays: number;
  keepCount: number;
  maxTotalBytes: number;
}

/** 上次备份状态（时间/结果/文案；未备份过 = null）。 */
export interface BackupStateShape {
  lastBackupAt: string;
  result: "ok" | "partial" | "failed";
  message: string;
  mainFile: string | null;
  quickNotesFile: string | null;
}

/**
 * 261105 task-68：备份目录占用（只读 stat，**不读文件内容**）。
 * 口径与轮转一致：份数 = 备份组数（metadata+quicknotes 同一时间戳），字节 = 这两类备份文件大小之和。
 */
export interface BackupUsageShape {
  dir: string;
  /** 目录是否存在（还没备份过 ⇒ false，不等于错误）。 */
  exists: boolean;
  groups: number;
  /** 备份文件数（含只有半份的组）。 */
  files: number;
  totalBytes: number;
  /** 最新 / 最旧一组的时间（ISO；没有备份时 null）。 */
  newestAt: string | null;
  oldestAt: string | null;
  /** 读目录/stat 失败或半份组提示（只报告，不影响统计）。 */
  warnings: string[];
}

/**
 * 261106 批量操作（A 方案：显式「选择」模式）——**契约单一来源**，桌面 IPC `batch_notes` 与移动端
 * `bridge.batchNotes` 同形同结果（core 编排见 `src/core/batchNotes.ts`）。
 * action 只有 move | trash | tag-add：**没有 purge/物理删除，也没有 restore**（回收站不做多选）；批量打标只追加。
 * trash = 移入回收站（lake → trashed_at；quickNotes → deleted_at），都可恢复。
 */
export type BatchNotesActionShape = "move" | "trash" | "tag-add";
export type BatchNotesSpaceShape = "lake" | "quickNotes";

export interface BatchNotesRequestShape {
  action: BatchNotesActionShape;
  /** 条目 id 列表（去重；上限 500）。字段名固定 ids（不是 targets）。 */
  ids: string[];
  /** 空间（缺省 lake）：quickNotes = 小记（trash 进小记回收站）。 */
  space?: BatchNotesSpaceShape;
  /** move：目标父级（null / 省略 = 根层）。 */
  parentId?: string | null;
  /** tag-add：要追加的标签 id（必须存在于目录；只新增，不提供移除）。 */
  tagIds?: string[];
}

/** 逐条结果原因（与 core 的 BatchNotesReason 一致；新增取值属于契约变更，两端同步改）。 */
export type BatchNotesReasonShape =
  | "invalid-input" | "invalid-action" | "empty-ids" | "too-many-ids" | "invalid-id"
  | "not-found" | "notebook-not-batchable" | "unsupported"
  | "already-trashed"
  | "parent-not-found" | "parent-not-a-container" | "parent-in-trash" | "parent-cycle"
  | "tag-unavailable" | "tag-not-found"
  | "failed";

export interface BatchNotesItemResultShape {
  id: string;
  ok: boolean;
  reason?: BatchNotesReasonShape;
}

export interface BatchNotesResultShape {
  ok: boolean;
  results: BatchNotesItemResultShape[];
  summary: { total: number; done: number; failed: number };
  reason?: BatchNotesReasonShape;
  message?: string;
}

/**
 * 261106 文档「创建副本」——**契约单一来源**（桌面 IPC `duplicate_notes` 与移动端
 * `bridge.duplicateNotes` 同形同结果；纯逻辑见 `src/core/duplicateNotes.ts`）。
 *
 * 语义：副本 = 全新笔记（新 id、同父级紧邻原笔记下方、标题 = 原名称 + " 副本 " + 时间），
 * 正文与全部资源复制，资源 URL 里的原 noteId 已重写成新 id ⇒ 与原笔记完全独立（编辑/删除/标签/
 * 历史/S3 对象互不影响）。请求级拒绝（invalid-* / empty-ids / too-many-ids）整批不执行；
 * 条目级失败逐条返回，不回滚其它条。
 */
// 261107 review 收口：契约类型只存在于 core（与 sharedTypes 同款做法），lib/types 只做别名 re-export，
// 避免「core 加一个 reason、这里忘改」的漂移。
export type {
  DuplicateNotesReason as DuplicateNotesReasonShape,
  DuplicateNotesItemResult as DuplicateNotesItemResultShape,
  DuplicateNotesResult as DuplicateNotesResultShape,
} from "../core/duplicateNotes.js";

export interface DuplicateNotesRequestShape {
  /** 源笔记 id 列表（去重；上限 500）。只接受 lake 空间的正式笔记（doc/usheet/bitable/board/ink）。 */
  ids: string[];
  /** 261108：可选请求 id，用于进度事件与取消对应。 */
  requestId?: string;
}

/** 261108：批量创建副本的进度事件（主进程 → 渲染层）。 */
export interface DuplicateNotesProgressShape {
  requestId: string;
  phase: "prepare" | "copy" | "commit";
  done: number;
  total: number;
}

/**
 * 261106 Markdown 导入：主进程 picker 返回的单个文件（桌面 `pick_markdown_files`）。
 * 不支持的扩展名也返回（supported:false），由调用方计入「跳过数」——用户全选目录时不静默消失。
 */
export interface MarkdownPickedFileShape {
  /** 绝对路径。 */
  path: string;
  /** 文件名（含扩展名）。 */
  name: string;
  /** 相对所选目录的路径（多选文件 = 文件名；分隔符 "/"）。 */
  relativePath: string;
  /** 字节数（stat 失败 = 0）。 */
  size: number;
  /** .md / .markdown。 */
  supported: boolean;
  /** > 20MB：不读正文（按跳过处理）。 */
  tooLarge?: boolean;
  /** UTF-8 正文（去 BOM）；tooLarge / 读失败时缺省。 */
  text?: string;
  /** 读失败的可读原因（文件消失 / 无权限等）。 */
  error?: string;
}

/** 261108 文档导入 picker 的类型过滤。 */
export type ImportPickerKind = "markdown" | "docx" | "xlsx" | "csv" | "all";

/** 261108 文档导入：主进程 picker 返回的单文件（Markdown / Word / Excel / CSV）。 */
export interface ImportPickedFileShape {
  path: string;
  name: string;
  relativePath: string;
  size: number;
  kind: "markdown" | "docx" | "xlsx" | "csv" | "other";
  supported: boolean;
  tooLarge?: boolean;
  error?: string;
  /** Markdown 原文。 */
  markdown?: string;
  /** Word → HTML（图片为 data URL，渲染层物化）。 */
  html?: string;
  /** Excel / CSV → usheet 工作簿。 */
  workbook?: Record<string, unknown>;
  warnings?: string[];
}

/** 261106 Markdown 导入：读一张本地图片（供渲染层 uploadResource 物化为文档资产）。 */
export interface ImportImageShape {
  bytes: Uint8Array;
  mimeType: string;
  /** 原始文件名（展示名）。 */
  filename: string;
}

/**
 * 261106 批量导出（数据层 electron/batchExport.ts）：按类型默认格式导出到同一目录。
 * 261106 二轮默认格式：doc→**markdown**（资料包目录：<标题>/<标题>.md + images/）、
 * usheet→**csv**、bitable→csv、ink→**pdf**、board→pdf（画板渲染在渲染层 ⇒ 当前返回 skipped）。
 * 只读：不写源数据、不标 dirty、不广播。
 */
export type BatchExportFormatShape = "markdown" | "csv" | "pdf";

/** 261106 task-95：渲染层交回的画板图像字节（批量导出的 board→pdf 输入）。 */
export interface BoardImageInputShape {
  /** PNG/SVG 字节（HTTP/JSON 客户端传 number[]）。 */
  bytes: Uint8Array | number[];
  format: "png" | "svg";
}

export interface BatchExportRequestShape {
  /** 文档或分组/笔记本 id（分组递归展开为文档；去重；上限 500）。 */
  ids: string[];
  /** 目标目录；缺省时主进程弹系统目录选择框。给了就必须是本进程选择框的返回值。 */
  dirPath?: string;
  /** 画板图像字节（渲染层先渲染再传；缺失的画板返回 skipped，不产出坏文件）。 */
  boardImages?: Record<string, BoardImageInputShape>;
}

/** 受控写盘（渲染层产出的画板 PNG/SVG 落到本次选择框选中的导出目录）。 */
export interface WriteBatchExportFileShape {
  dirPath: string;
  /** 文件名（不含扩展名；主进程会清洗非法字符并做「 (2)」去重）。 */
  fileName: string;
  ext: "png" | "svg";
  bytes: Uint8Array | number[];
}

export interface BatchExportItemResultShape {
  id: string;
  ok: boolean;
  path?: string;
  /** ink 多页 = 每页一个文件。 */
  paths?: string[];
  format?: BatchExportFormatShape;
  /** 未导出（画板/未知类型）：不是失败，但要给原因。 */
  skipped?: boolean;
  reason?: string;
}

export interface BatchExportResultShape {
  ok: boolean;
  results: BatchExportItemResultShape[];
  summary: { total: number; done: number; failed: number; skipped: number };
  dirPath?: string;
  /** 用户在目录选择框里取消。 */
  cancelled?: boolean;
  reason?: "too-many" | "empty-ids" | "invalid-input" | "cancelled";
  message?: string;
}

/** A3 数据体检（只读诊断）报告：检查本地数据自洽性，不自动修复。 */
/** Batch4-B：文件↔元数据对账候选（文件在、笔记行丢了；只报告，不自动重建）。 */
export interface FileReconcileCandidateShape {
  noteId: string;
  kind: string;
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
}

/** Batch4-B：文件↔元数据对账报告（261105 起默认每 24h 低频只报告；0 = 关闭）。 */
export interface FileReconcileReportShape {
  generatedAt: string;
  durationMs: number;
  enabled: boolean;
  trigger: "sync-idle" | "manual-report";
  /** 当前配置的扫描间隔（小时，0 = 关闭）。 */
  intervalHours?: number;
  knownRows: number;
  scannedFiles: number;
  ignoredFiles: number;
  scanErrors: number;
  candidates: FileReconcileCandidateShape[];
  candidateCount: number;
  truncated: boolean;
  missingBodyDirs: string[];
}

/** 261105：手动「重建数据」——从正文文件重建丢了元数据行的笔记（仅限本次扫描候选）。 */
export interface RebuildCandidateShape {
  noteId: string;
  kind: string;
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  /** 从正文派生的标题（派生不到 = 「恢复的笔记 <id 前 8 位>」）。 */
  title: string;
  titleSource: "body" | "fallback";
  /** 正文不可解析/损坏 = false（不允许勾选重建）。 */
  rebuildable: boolean;
  /** 不可重建原因（可读）。 */
  reason?: string;
}

export interface RebuildScanResultShape {
  generatedAt: string;
  scannedFiles: number;
  truncated: boolean;
  candidates: RebuildCandidateShape[];
}

export type RebuildNoteStatus = "created" | "skipped" | "rejected" | "failed";
export interface RebuildNoteResultShape {
  noteId: string;
  status: RebuildNoteStatus;
  title?: string;
  /** skipped/rejected/failed 的可读原因。 */
  reason?: string;
}

export interface RebuildResultShape {
  generatedAt: string;
  notebookId: string;
  results: RebuildNoteResultShape[];
}

export interface DataHealthReport {
  /** 最近一次文件↔元数据对账（未跑过/未启用 = null；只报告）。 */
  fileReconcile?: FileReconcileReportShape | null;
  /** 后台扫描间隔（小时，0 = 关闭）；未跑过报告时也能显示「是否启用」。 */
  fileScanIntervalHours?: number;
  notesChecked: number;
  notesMissingFile: Array<{ id: string; title: string }>;
  notesHashMismatch: Array<{ id: string; title: string }>;
  historyChecked: number;
  historyMissingFile: number;
  historyMissingSample: Array<{ id: number; noteId: string; filePath: string }>;
  orphanRowsChecked: number;
  orphanRowsFileMissing: Array<{ id: number; noteId: string; filename: string }>;
  /** 树完整性：parent_id 指向不存在节点的条目（侧栏/回收站渲染不出来，但仍在同步与资源聚合里）。 */
  treeChecked: number;
  treeDanglingParent: Array<{ id: string; title: string; parentId: string }>;
  /** 元数据一致性：notes.parent_id 与 tree_nodes.parent_id 不一致（本地自相矛盾的错挂）。 */
  metaParentMismatch: Array<{ id: string; title: string; noteParent: string | null; treeParent: string | null }>;
  refsChecked: number;
  refsMissingResource: Array<{ noteId: string; filename: string }>;
  checkedAt: string;
}

/** F3：上次历史清理结果（无记录 → null）。 */
export type LastHistoryCleanup = { at: string; deletedSnapshots: number; freedBytes: number } | null;


export interface SyncProgress {
  phase: "connect" | "download" | "upload" | "manifest" | "quick-notes" | "done";
  /** 主循环进度：笔记 / 小记条目 */
  current?: number;
  total?: number;
  /** 资源（图片/附件）子进度，独立于主循环 */
  assetCurrent?: number;
  assetTotal?: number;
  message: string;
  /** done 阶段附带：本地改动被远端覆盖、已存入历史的文档。 */
  supersededNotes?: Array<{ id: string; title: string }>;
  /** 同步失败时附带错误信息（自动同步失败也能让状态栏变为“同步失败”）。 */
  error?: string;
  /** 同步失败时的域错误码（S3v3SyncError.code；未知为 "unknown"）。 */
  errorCode?: string;
  /** 同步失败分类：retryable（可重试）/ action-required（需人工处理）/ fatal（数据损坏）。 */
  errorClass?: "retryable" | "action-required" | "fatal";
}

export interface SyncStatusInfo {
  lastSyncedAt: string | null;
  lastResult: SyncResult | null;
  /** SD-13：最近 3 轮 v3 同步诊断（阶段耗时/对象数/字节/失败对象），设置页「同步诊断」复制。 */
  v3Reports?: S3v3DiagnosticReport[];
}

export interface ImportedResource {
  resourceRef: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ResourceUploadInput {
  /** 文件字节（Uint8Array 跨 IPC 结构化克隆传输，避免 number[] 的高内存/慢序列化） */
  bytes: Uint8Array;
  filename: string;
}

export interface ResourceUploadOutput {
  url: string;
  resourceRef: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Lake audio 卡上传成功读 video_id/audioId 作播放源 id（本应用 = canonical URL）；仅音频附件返回 */
  audioId?: string;
  /** Lake audio 卡 audioInfo.fileSize 显示字段 */
  filesize?: number;
}

export interface OrphanAsset {
  id: number;
  noteId: string;
  filename: string;
  filePath: string;
  size: number;
  mimeType: string;
  detectedAt: string;
  /** 所属文档标题（store 列表时补全；active/trash/missing）。 */
  noteTitle?: string;
  noteState?: "active" | "trash" | "missing";
}

export interface CleanOrphanResult {
  count: number;
  freedBytes: number;
}

/**
 * 小记列表投影（DT-05）：列表 IPC **不读 .qnote 正文**，只带列表/筛选/预览占位所需字段。
 * - 标签从关联表 + 标签目录投影（不读正文）；
 * - 资源只留 mime 清单（类型筛选用），字节/正文在打开单条时经 read_quick_note 取。
 */
export interface QuickNoteListSummary extends QuickNoteSummary {
  /** 关联表里的标签 ID（与 QuickNoteContent.tagIds 同口径）。 */
  tagIds: string[];
  /** 展示用标签名（与 tagIds 一一对应）。 */
  tags: string[];
  /** 资源清单里出现过的 mime 类型（去重；类型筛选「图片/附件」用）。 */
  assetMimeTypes: string[];
}

export interface SaveQuickNoteInput {
  text: string;
  /** 内核形态正文。缺省时主进程按 text 合成（见 quickNoteModel.quickNoteBodyFromText）。 */
  body?: string;
  draftId: string;
  stagedImageIds: string[];
  retainedImageIds?: string[];
}

/** 小记标签目录实体：单一来源 = `core/quickNoteTags`（这里只做 re-export，避免又一份带顺序/置顶的重复类型）。 */
export type { QuickNoteTag } from "../core/quickNoteTags";

/** 关于页：主进程 get_system_info 的返回（只读概览）。 */
export interface StorageOverview {
  root: string; dbBytes: number;
  notes: number; notebooks: number; groups: number; trashedNodes: number; tombstones: number;
  historySnapshots: number; historyBytes: number;
  assetFiles: number; assetBytes: number; orphanRows: number;
}

export interface SystemInfo {
  app: { name: string; version: string; description: string };
  runtime: { electron: string; chromium: string; node: string; platform: string; arch: string };
  deps: Record<string, string>;
  paths: { userData: string; workspace: string; logs: string };
  storage: StorageOverview;
  quickNotes: number;
  packaged: boolean;
}

export type DataFolderKind = "data" | "workspace" | "logs" | "assets" | "history" | "quickNotes" | "backups";