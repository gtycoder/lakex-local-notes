import type { CleanOrphanResult, DeepCleanupResult, DraftJournalEntry, NoteDigest, NoteDocument, OrphanAsset, QuickNoteDocument, QuickNoteImage, QuickNoteTrashItem, ResourceUploadInput, ResourceUploadOutput, S3GcLogItem, S3GcPendingItem, S3GcSettings, S3Settings, SaveQuickNoteInput, SyncProgress, SyncResult, SyncSettings, SyncStatusInfo, TreeNode, WorkspaceSnapshot } from "./types";
import type { TrashItem } from "../core/trashRepository";

export interface LakeNative {
  /** 本地资源服务器端口（可被 LAKE_ASSET_PORT 覆盖，多端同机双开用）。 */
  assetPort: number;
  bootstrap(): Promise<WorkspaceSnapshot>;
  readNote(id: string): Promise<NoteDocument>;
  getNoteDigest(id: string): Promise<NoteDigest | null>;
  setNoteLocked(id: string, locked: boolean): Promise<NoteDocument>;
  createNote(title: string): Promise<NoteDocument>;
  saveNote(id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }): Promise<NoteDocument>;
  updateNoteCaches(id: string, markdown: string | null, plain: string | null): Promise<void>;
  readNoteCaches(id: string): Promise<{ markdown: string | null; plain: string | null }>;
  listDraftJournals(): Promise<DraftJournalEntry[]>;
  saveDraftJournal(entry: DraftJournalEntry): Promise<void>;
  deleteDraftJournal(noteId: string): Promise<void>;
  ensureNoteCaches(id: string, lakeContent?: string): Promise<boolean>;
  getNotePaths(id: string): Promise<{ title: string; lakePath: string; assetsDir: string }>;
  pickExportDir(): Promise<string | null>;
  exportNote(id: string, format: "markdown" | "html" | "lake" | "docx" | "pdf", baseDir?: string): Promise<{ format: string; exportPath: string; imageCount: number; skipped: number; size: number }>;
  setNodeIcon(id: string, icon: string | null): Promise<TreeNode>;
  searchNotes(query: string, limit?: number): Promise<Array<{ id: string; title: string; snippet: string; matchType: "title" | "body"; updatedAt?: string; parentTitle?: string | null }>>;
  deleteNote(id: string): Promise<void>;
  listTreeNodes(): Promise<TreeNode[]>;
  listNoteSummaries(): Promise<import("./types").NoteSummary[]>;
  createNotebook(title: string): Promise<TreeNode>;
  createGroup(parentId: string, title: string): Promise<TreeNode>;
  renameTreeNode(id: string, title: string): Promise<TreeNode>;
  createNoteIn(parentId: string | null, title: string): Promise<NoteDocument>;
  moveTreeNode(id: string, parentId: string | null, sortOrder: number): Promise<TreeNode>;
  moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode>;
  reorderTreeNodes(parentId: string | null, orderedIds: string[]): Promise<void>;
  deleteTreeNode(id: string): Promise<void>;
  listTrash(): Promise<TrashItem[]>;
  restoreTrash(id: string): Promise<void>;
  /** 回收站预览：按需补拉该笔记本地缺失的资源（不恢复）。返回 warnings（best-effort）。 */
  ensureTrashNoteAssets(id: string): Promise<{ warnings: string[] }>;
  purgeTrash(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
  createHistorySnapshot(noteId: string, content?: string, force?: boolean): Promise<number | null>;
  listNoteHistory(noteId: string): Promise<Array<{ id: number; createdAt: string; size: number; contentHash: string; refCount: number; filePath: string }>>;
  restoreHistory(historyId: number): Promise<void>;
  deleteHistory(historyId: number): Promise<void>;
  cleanupHistory(): Promise<{ deletedSnapshots: number; freedBytes: number }>;
  getHistorySettings(): Promise<{ maxSnapshots: number; retentionDays: number; cleanupIntervalHours: number; snapshotIntervalMinutes: number }>;
  saveHistorySettings(settings: { maxSnapshots: number; retentionDays: number; cleanupIntervalHours: number; snapshotIntervalMinutes: number }): Promise<void>;
  getHistoryStats(): Promise<{ snapshotCount: number; totalBytes: number }>;
  listNoteOrphans(noteId: string): Promise<Array<{ filename: string; size: number; mimeType: string; protectedByHistory: boolean }>>;
  previewHistorySnapshot(historyId: number): Promise<{ plain: string; html: string; createdAt: string; contentHash: string } | null>;
  previewNoteOrphan(noteId: string, filename: string): Promise<{ kind: "image" | "text"; data: string; size: number } | null>;
  cleanNoteOrphans(noteId: string, filenames?: string[]): Promise<{ count: number; freedBytes: number }>;
  uploadResource(input: ResourceUploadInput, noteId: string): Promise<ResourceUploadOutput>;
  downloadRemoteResource(url: string, noteId: string): Promise<ResourceUploadOutput>;
  listOrphanAssets(): Promise<OrphanAsset[]>;
  cleanOrphanAssets(): Promise<CleanOrphanResult>;
  /** 附件操作（桌面本地优先）：系统默认应用打开。 */
  openAttachment(noteId: string, filename: string): Promise<{ ok: boolean; error?: string }>;
  /** 附件操作：在文件管理器中显示。 */
  showAttachmentInFolder(noteId: string, filename: string): Promise<{ ok: boolean }>;
  getS3Settings(): Promise<S3Settings | null>;
  saveS3Settings(settings: S3Settings): Promise<void>;
  testS3Connection(): Promise<string>;
  getSyncSettings(): Promise<SyncSettings>;
  saveSyncSettings(settings: SyncSettings): Promise<SyncSettings>;
  syncNow(): Promise<SyncResult>;
  getSyncStatus(): Promise<SyncStatusInfo>;
  getSyncPendingSummary(): Promise<import("./types").SyncPendingSummary>;
  listQuickNotes(): Promise<QuickNoteDocument[]>;
  createQuickNote(input: SaveQuickNoteInput): Promise<QuickNoteDocument>;
  updateQuickNote(id: string, input: SaveQuickNoteInput): Promise<QuickNoteDocument>;
  deleteQuickNote(id: string): Promise<void>;
  stageQuickNoteImage(draftId: string, input: { bytes: number[]; filename: string }): Promise<QuickNoteImage>;
  discardQuickNoteDraft(draftId: string): Promise<void>;
  discardStagedQuickNoteImage(draftId: string, imageId: string): Promise<void>;
  convertQuickNote(quickNoteId: string, notebookId: string): Promise<NoteDocument>;
  listQuickNoteTrash(): Promise<QuickNoteTrashItem[]>;
  restoreQuickNote(id: string): Promise<QuickNoteDocument>;
  purgeQuickNote(id: string): Promise<void>;
  getS3GcSettings(): Promise<S3GcSettings>;
  saveS3GcSettings(settings: S3GcSettings): Promise<void>;
  listS3GcPending(): Promise<S3GcPendingItem[]>;
  listS3GcLog(): Promise<S3GcLogItem[]>;
  runS3GcReconcile(): Promise<{ deleted: number; kept: number }>;
  runS3DeepCleanup(dryRun: boolean): Promise<DeepCleanupResult>;
  getTrashReminder(): Promise<Array<{ id: string; title: string; deletedAt: string }>>;
  onSyncProgress(callback: (progress: SyncProgress) => void): () => void;
  onPendingSummaryChanged(callback: (summary: import("./types").SyncPendingSummary) => void): () => void;
}

declare global {
  interface Window { lakeNative?: LakeNative; }
}

export const isDesktop = () => typeof window.lakeNative !== "undefined";

function api(): LakeNative {
  if (!window.lakeNative) throw new Error("原生桥接未就绪，请在 Electron 环境中运行");
  return window.lakeNative;
}

export const native = {
  bootstrap: () => api().bootstrap(),
  readNote: (id: string) => api().readNote(id),
  getNoteDigest: (id: string) => api().getNoteDigest(id),
  setNoteLocked: (id: string, locked: boolean) => api().setNoteLocked(id, locked),
  createNote: (title: string) => api().createNote(title),
  saveNote: (id: string, title: string, content: string, caches?: { markdown?: string | null; plain?: string | null }) => api().saveNote(id, title, content, caches),
  updateNoteCaches: (id: string, markdown: string | null, plain: string | null) => api().updateNoteCaches(id, markdown, plain),
  readNoteCaches: (id: string) => api().readNoteCaches(id),
  listDraftJournals: () => api().listDraftJournals(),
  saveDraftJournal: (entry: DraftJournalEntry) => api().saveDraftJournal(entry),
  deleteDraftJournal: (noteId: string) => api().deleteDraftJournal(noteId),
  ensureNoteCaches: (id: string, lakeContent?: string) => api().ensureNoteCaches(id, lakeContent),
  getNotePaths: (id: string) => api().getNotePaths(id),
  pickExportDir: () => api().pickExportDir(),
  exportNote: (id: string, format: "markdown" | "html" | "lake" | "docx" | "pdf", baseDir?: string) => api().exportNote(id, format, baseDir),
  setNodeIcon: (id: string, icon: string | null) => api().setNodeIcon(id, icon),
  searchNotes: (query: string, limit?: number) => api().searchNotes(query, limit),
  deleteNote: (id: string) => api().deleteNote(id),
  listTreeNodes: () => api().listTreeNodes(),
  listNoteSummaries: () => api().listNoteSummaries(),
  createNotebook: (title: string) => api().createNotebook(title),
  createGroup: (parentId: string, title: string) => api().createGroup(parentId, title),
  renameTreeNode: (id: string, title: string) => api().renameTreeNode(id, title),
  createNoteIn: (parentId: string | null, title: string) => api().createNoteIn(parentId, title),
  moveTreeNode: (id: string, parentId: string | null, sortOrder: number) => api().moveTreeNode(id, parentId, sortOrder),
  moveTreeNodeOrdered: (id: string, parentId: string | null, orderedIds: string[]) => api().moveTreeNodeOrdered(id, parentId, orderedIds),
  reorderTreeNodes: (parentId: string | null, orderedIds: string[]) => api().reorderTreeNodes(parentId, orderedIds),
  deleteTreeNode: (id: string) => api().deleteTreeNode(id),
  listTrash: () => api().listTrash(),
  restoreTrash: (id: string) => api().restoreTrash(id),
  ensureTrashNoteAssets: (id: string) => api().ensureTrashNoteAssets(id),
  purgeTrash: (id: string) => api().purgeTrash(id),
  emptyTrash: () => api().emptyTrash(),
  createHistorySnapshot: (noteId: string, content?: string, force?: boolean) => api().createHistorySnapshot(noteId, content, force),
  listNoteHistory: (noteId: string) => api().listNoteHistory(noteId),
  restoreHistory: (historyId: number) => api().restoreHistory(historyId),
  deleteHistory: (historyId: number) => api().deleteHistory(historyId),
  cleanupHistory: () => api().cleanupHistory(),
  getHistorySettings: () => api().getHistorySettings(),
  saveHistorySettings: (settings: { maxSnapshots: number; retentionDays: number; cleanupIntervalHours: number; snapshotIntervalMinutes: number }) => api().saveHistorySettings(settings),
  getHistoryStats: () => api().getHistoryStats(),
  listNoteOrphans: (noteId: string) => api().listNoteOrphans(noteId),
  previewHistorySnapshot: (historyId: number) => api().previewHistorySnapshot(historyId),
  previewNoteOrphan: (noteId: string, filename: string) => api().previewNoteOrphan(noteId, filename),
  cleanNoteOrphans: (noteId: string, filenames?: string[]) => api().cleanNoteOrphans(noteId, filenames),
  uploadResource: (input: ResourceUploadInput, noteId: string) => api().uploadResource(input, noteId),
  downloadRemoteResource: (url: string, noteId: string) => api().downloadRemoteResource(url, noteId),
  listOrphanAssets: () => api().listOrphanAssets(),
  cleanOrphanAssets: () => api().cleanOrphanAssets(),
  openAttachment: (noteId: string, filename: string) => api().openAttachment(noteId, filename),
  showAttachmentInFolder: (noteId: string, filename: string) => api().showAttachmentInFolder(noteId, filename),
  getS3Settings: () => api().getS3Settings(),
  saveS3Settings: (settings: S3Settings) => api().saveS3Settings(settings),
  testS3Connection: () => api().testS3Connection(),
  getSyncSettings: () => api().getSyncSettings(),
  saveSyncSettings: (settings: SyncSettings) => api().saveSyncSettings(settings),
  syncNow: () => api().syncNow(),
  getSyncStatus: () => api().getSyncStatus(),
  getSyncPendingSummary: () => api().getSyncPendingSummary(),
  listQuickNotes: () => api().listQuickNotes(),
  createQuickNote: (input: SaveQuickNoteInput) => api().createQuickNote(input),
  updateQuickNote: (id: string, input: SaveQuickNoteInput) => api().updateQuickNote(id, input),
  deleteQuickNote: (id: string) => api().deleteQuickNote(id),
  stageQuickNoteImage: (draftId: string, input: { bytes: number[]; filename: string }) => api().stageQuickNoteImage(draftId, input),
  discardQuickNoteDraft: (draftId: string) => api().discardQuickNoteDraft(draftId),
  discardStagedQuickNoteImage: (draftId: string, imageId: string) => api().discardStagedQuickNoteImage(draftId, imageId),
  convertQuickNote: (quickNoteId: string, notebookId: string) => api().convertQuickNote(quickNoteId, notebookId),
  listQuickNoteTrash: () => api().listQuickNoteTrash(),
  restoreQuickNote: (id: string) => api().restoreQuickNote(id),
  purgeQuickNote: (id: string) => api().purgeQuickNote(id),
  getS3GcSettings: () => api().getS3GcSettings(),
  saveS3GcSettings: (settings: S3GcSettings) => api().saveS3GcSettings(settings),
  listS3GcPending: () => api().listS3GcPending(),
  listS3GcLog: () => api().listS3GcLog(),
  runS3GcReconcile: () => api().runS3GcReconcile(),
  runS3DeepCleanup: (dryRun: boolean) => api().runS3DeepCleanup(dryRun),
  getTrashReminder: () => api().getTrashReminder(),
  onSyncProgress: (callback: (progress: SyncProgress) => void) => api().onSyncProgress(callback),
  onPendingSummaryChanged: (callback: (summary: import("./types").SyncPendingSummary) => void) => api().onPendingSummaryChanged(callback),
};
