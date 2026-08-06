export interface NoteSummary {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  syncState: "local" | "synced" | "conflict";
  isConflict: boolean;
  isLocked?: boolean;
  lockedAt?: string | null;
}

export interface NoteDocument extends NoteSummary {
  content: string;
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
  /** 小记失败不否定 Lake 同步成功。 */
  quickNotes?: QuickNotesSyncStatus;
}

export interface SyncProgress {
  phase: "connect" | "download" | "upload" | "manifest" | "quick-notes" | "done";
  current?: number;
  total?: number;
  message: string;
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
  bytes: number[];
  filename: string;
}

export interface ResourceUploadOutput {
  url: string;
  resourceRef: string;
  filename: string;
  mimeType: string;
  size: number;
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
