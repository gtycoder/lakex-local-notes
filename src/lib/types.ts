export interface NoteSummary {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  syncState: "local" | "synced" | "conflict" | "purged";
  isConflict: boolean;
  isLocked?: boolean;
  lockedAt?: string | null;
  /** v6/v7 文档类型（doc | sheet | bitable | board；缺省 doc）。渲染层据此选择编辑器。 */
  kind?: "doc" | "sheet" | "usheet" | "bitable" | "board";
}

export interface NoteDocument extends NoteSummary {
  content: string;
}

/** 笔记的轻量状态摘要（同步后刷新打开 tab 用）。
 * 只读 DB 行，不读正文文件；updatedAt/title 变化或 deleted 即表示需要全量拉取。 */
export interface NoteDigest {
  id: string;
  title: string;
  updatedAt: string;
  deleted: boolean;
}

export interface NoteInfoAsset {
  filename: string;
  size: number;
  kind: string;
}

/** 文档属性（"属性"弹窗数据）。 */
export interface NoteInfo {
  id: string;
  title: string;
  /** 所属路径（笔记本 / 分组 …），根下为空 */
  parentPath: string;
  /** 所属路径链（自根向下，带 id，供跳转） */
  parents: Array<{ id: string; title: string }>;
  /** 卡片统计（图片/视频/附件/代码块/表格…） */
  cardStats: Array<{ key: string; label: string; count: number }>;
  createdAt: string | null;
  updatedAt: string;
  syncState: string;
  isConflict: boolean;
  isLocked: boolean;
  lakePath: string;
  assetsDir: string;
  sizeBytes: number;
  charCount: number;
  wordCount: number;
  /** 当前正文（已落盘那份）的 sha256：历史面板用来标出"与当前版本一致"的快照。 */
  contentHash: string;
  assets: NoteInfoAsset[];
  assetTotalBytes: number;
  history: Array<{ id: number; createdAt: string; size: number; contentHash: string }>;
}

export type TreeNodeType = "notebook" | "group" | "note";

export interface TreeNode {
  id: string;
  workspaceId: string;
  parentId: string | null;
  nodeType: TreeNodeType;
  title: string;
  noteFileId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  syncState: NoteSummary["syncState"];
  isConflict: boolean;
  icon?: string | null;
  description?: string | null;
  summary?: string | null;
  /** v6/v7 文档类型（doc | sheet | bitable | board；缺省 doc）：宿主据此对非 doc 隐藏导出/大纲等。 */
  kind?: "doc" | "sheet" | "usheet" | "bitable" | "board";
}

export interface WorkspaceSnapshot {
  workspaceId: string;
  workspaceName: string;
  notes: NoteSummary[];
  lastOpenedNoteId: string | null;
  sync: SyncStatus;
}

export interface SyncSettings {
  enabled: boolean;
  autoMode: "interval" | "onOpenClose" | "manual";
  autoIntervalMinutes: number;
}

export interface S3GcSettings {
  gcRetentionDays: number;
  gcIntervalHours: number;
  trashAutoPurgeDays: number;
}
export interface S3GcPendingItem {
  key: string;
  markedAt: string;
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
  lake: { dryRun: boolean; candidateCount: number; deletedCount: number; keys: string[] };
  quickNotes: { dryRun: boolean; candidateCount: number; deletedCount: number; keys: string[] };
}
export interface QuickNoteTrashItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
}

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

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

/** 同步警告：远端对象/资源缺失时「跳过受影响条目、不覆盖本地、其余继续」（V5 §5.5 B 方案）的结构化报告。
 *  由 core 直接产出（不再拼字符串让消费方正则反解）；UI 据此展示与点击定位。 */
export type SyncWarningKind = "remote_incomplete" | "asset_missing";
export interface SyncWarning {
  kind: SyncWarningKind;
  /** 受影响文档 id（能定位时）。 */
  noteId?: string;
  /** 文档标题（core 能取到时带上，省 UI 一次回查）。 */
  title?: string;
  /** 资源文件名（asset_missing 且能定位到具体文件时）。 */
  filename?: string;
  /** 人类可读一行（日志/兜底展示；UI 优先用 title/filename）。 */
  message: string;
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

/** A3 数据体检（只读诊断）报告：检查本地数据自洽性，不自动修复。 */
export interface DataHealthReport {
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
}

export interface SyncStatusInfo {
  lastSyncedAt: string | null;
  lastResult: SyncResult | null;
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

/** 小记独立内容空间（V1 仅文本 + 图片，不复用 Lake 文档格式）。 */
export interface QuickNoteImage {
  id: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number;
  hash: string;
  url?: string;
}

export interface QuickNoteContent {
  version: number;
  /** 纯文本镜像（预览/搜索/移动端降级显示）；v2 起不再是唯一真相。 */
  text: string;
  /** v2：内核形态正文（Lake HTML）。桌面编辑态由内核产出，其它入口由 text 合成。 */
  body: string;
  images: QuickNoteImage[];
}

export interface QuickNoteSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  previewText: string;
  imageCount: number;
  contentHash: string;
  syncState: "local" | "synced" | "conflict";
  isConflict: boolean;
}

export interface QuickNoteDocument extends QuickNoteSummary {
  content: QuickNoteContent;
}

export interface SaveQuickNoteInput {
  text: string;
  /** 内核形态正文。缺省时主进程按 text 合成（见 quickNoteModel.quickNoteBodyFromText）。 */
  body?: string;
  draftId: string;
  stagedImageIds: string[];
  retainedImageIds?: string[];
}

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

export type DataFolderKind = "data" | "workspace" | "logs" | "assets" | "history" | "quickNotes";
