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
  /** 小记失败不否定 Lake 同步成功。 */
  quickNotes?: QuickNotesSyncStatus;
  /** 本地修改被远端覆盖、已存入历史的文档（用于 UI 提醒） */
  supersededNotes: Array<{ id: string; title: string }>;
}

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
  text: string;
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
  draftId: string;
  stagedImageIds: string[];
  retainedImageIds?: string[];
}
