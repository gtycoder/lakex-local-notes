import type { CleanOrphanResult, DataHealthReport, DeepCleanupResult, DraftJournalEntry, LastHistoryCleanup, NoteDigest, NoteDocument, NoteInfo, OrphanAsset, QuickNoteDocument, QuickNoteImage, QuickNoteTrashItem, ResourceUploadInput, ResourceUploadOutput, S3GcLogItem, S3GcPendingItem, S3GcSettings, S3Settings, SaveQuickNoteInput, SyncProgress, SyncResult, SyncSettings, SyncStatusInfo, TreeNode, WorkspaceSnapshot } from "./types";
import type { TrashItem } from "../core/trashPolicy";
import type { GcDiagnostics } from "../core/gcDiagnostics";

/** 小记 staging 入参：桌面传 `Uint8Array`（IPC 结构化克隆），移动端走 HTTP JSON 传 `number[]`。 */
export interface QuickNoteStageInput {
  bytes: Uint8Array | number[];
  filename: string;
}

export interface LakeNative {
  /** 本地资源服务器端口（可被 LAKE_ASSET_PORT 覆盖，多端同机双开用）。 */
  assetPort: number;
  /** 宿主能力：Web 客户端由 shim 下发（nativeDialog=false）；桌面/移动缺省按桌面处理。 */
  capabilities?: { browserClient: boolean; nativeDialog: boolean };
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
  /** 文档属性（元数据 + 字数 + 引用资产 + 历史快照） */
  getNoteInfo(id: string): Promise<NoteInfo>;
  /** 只改附件展示名（不动存储文件/路径） */
  renameAssetDisplay(noteId: string, filename: string, newName: string): Promise<{ ok: boolean; changed: number }>;
  pickExportDir(): Promise<string | null>;
  exportNote(id: string, format: "markdown" | "html" | "pdf" | "docx", baseDir?: string): Promise<{ format: string; exportPath: string; imageCount: number; skipped: number; size: number }>;
  /** 多维表：导出活动数据表为 CSV（UTF-8 BOM + CRLF，Excel 通用） */
  exportBitableCsv(id: string, baseDir?: string): Promise<{ exportPath: string; rowCount: number; size: number }>;
  /** 多维表：导出活动数据表为 ZIP（CSV + 附件/图片文件） */
  exportBitableZip(id: string, baseDir?: string): Promise<{ exportPath: string; rowCount: number; fileCount: number; skipped: number; size: number }>;
  /** 多维表：系统选择框选一个 CSV 文件并读取文本（导入用；取消返回 null） */
  pickImportCsv(): Promise<{ name: string; content: string } | null>;
  pickBackupDir(): Promise<string | null>;
  runWorkspaceBackup(dir: string): Promise<{ backupPath: string; copiedDirs: string[] }>;
  prepareCloudRestore(): Promise<{ quarantinePath: string }>;
  confirmRelaunch(): Promise<boolean>;
  setNodeIcon(id: string, icon: string | null): Promise<TreeNode>;
  searchNotes(query: string, limit?: number): Promise<Array<{ id: string; title: string; snippet: string; matchType: "title" | "body"; updatedAt?: string; parentTitle?: string | null }>>;
  rebuildSearchIndex(): Promise<boolean>;
  deleteNote(id: string): Promise<void>;
  listTreeNodes(): Promise<TreeNode[]>;
  listNoteSummaries(): Promise<import("./types").NoteSummary[]>;
  createNotebook(title: string): Promise<TreeNode>;
  createGroup(parentId: string, title: string): Promise<TreeNode>;
  renameTreeNode(id: string, title: string): Promise<TreeNode>;
  createNoteIn(parentId: string | null, title: string): Promise<NoteDocument>;
  /** 新建表格文档（kind=sheet，v6）。 */
  createSheetIn(parentId: string | null, title: string): Promise<NoteDocument>;
  /** 新建多维表文档（kind=bitable，v6）。 */
  createBitableIn(parentId: string | null, title: string): Promise<NoteDocument>;
  /** 新建画板文档（kind=board，v7）：正文是 Drawnix/Plait 场景 JSON。 */
  createBoardIn(parentId: string | null, title: string): Promise<NoteDocument>;
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
  listNoteHistory(noteId: string): Promise<Array<{
    id: number; createdAt: string; size: number; contentHash: string; refCount: number; filePath: string; protectedUntil: string | null;
    /** 文档类型（同篇快照同类型）：渲染层据此预热预览分包。 */
    kind: "doc" | "sheet" | "bitable" | "board";
  }>>;
  restoreHistory(historyId: number): Promise<void>;
  deleteHistory(historyId: number): Promise<void>;
  cleanupHistory(): Promise<{ deletedSnapshots: number; freedBytes: number }>;
  getHistorySettings(): Promise<{ maxSnapshots: number; retentionDays: number; cleanupIntervalHours: number; snapshotIntervalMinutes: number }>;
  saveHistorySettings(settings: { maxSnapshots: number; retentionDays: number; cleanupIntervalHours: number; snapshotIntervalMinutes: number }): Promise<void>;
  getHistoryStats(): Promise<{ snapshotCount: number; totalBytes: number }>;
  getLastHistoryCleanup(): Promise<LastHistoryCleanup>;
  listNoteOrphans(noteId: string): Promise<Array<{ filename: string; size: number; mimeType: string; protectedByHistory: boolean }>>;
  previewHistorySnapshot(historyId: number): Promise<{
    /** 文档类型：doc 的 html 是 Lake 正文（viewer 渲染）；非 doc 是内部 JSON（结构化预览）。 */
    kind: "doc" | "sheet" | "bitable" | "board";
    plain: string;
    html: string;
    createdAt: string;
    contentHash: string;
  } | null>;
  previewNoteOrphan(noteId: string, filename: string): Promise<{ kind: "image" | "text"; data: string; size: number } | null>;
  cleanNoteOrphans(noteId: string, filenames?: string[]): Promise<{ count: number; freedBytes: number }>;
  uploadResource(input: ResourceUploadInput, noteId: string): Promise<ResourceUploadOutput>;
  downloadRemoteResource(url: string, noteId: string): Promise<ResourceUploadOutput>;
  listOrphanAssets(): Promise<OrphanAsset[]>;
  cleanOrphanAssets(): Promise<CleanOrphanResult>;
  deleteOrphanAsset(id: number): Promise<{ deleted: boolean; freedBytes: number }>;
  readOrphanPreview(id: number): Promise<{ filename: string; mimeType: string; supported: boolean; dataUrl?: string }>;
  listRemovedAssets(): Promise<Array<{ noteId: string; filename: string; status: "orphan" | "history"; orphanId?: number; size: number; mimeType: string; noteTitle?: string; noteState?: "active" | "trash" | "missing"; detectedAt?: string }>>;
  readAssetPreview(noteId: string, filename: string): Promise<{ filename: string; mimeType: string; supported: boolean; dataUrl?: string }>;
  /** 附件操作（桌面本地优先）：系统默认应用打开。 */
  openAttachment(noteId: string, filename: string): Promise<{ ok: boolean; error?: string }>;
  /** 附件操作：在文件管理器中显示。 */
  showAttachmentInFolder(noteId: string, filename: string): Promise<{ ok: boolean }>;
  /** 在文件管理器中显示笔记 .lake 文件 */
  revealNoteFile(id: string): Promise<{ ok: boolean }>;
  /** 打开笔记的附件文件夹 */
  openNoteAssets(id: string): Promise<{ ok: boolean; error?: string }>;
  copyAssetPath(noteId: string, filename: string): Promise<string>;
  /** 复制图片到系统剪贴板 */
  copyAssetImage(noteId: string, filename: string): Promise<{ ok: boolean }>;
  /** 另存为：把单个附件复制到用户选择的位置（suggestedName 为卡片展示名） */
  saveAssetAs(noteId: string, filename: string, suggestedName?: string): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
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
  /** 字节走 Electron 结构化克隆：传 Uint8Array（大附件时 number[] 会凭空多出几百 MB 的数组）。 */
  stageQuickNoteImage(draftId: string, input: QuickNoteStageInput): Promise<QuickNoteImage>;
  /** 小记附件（内核 file 卡）暂存：与图片同一 staging 空间，宽高为 null。 */
  stageQuickNoteFile(draftId: string, input: QuickNoteStageInput): Promise<QuickNoteImage>;
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
  runS3GcDiagnostics(): Promise<GcDiagnostics>;
  runDataHealthCheck(): Promise<DataHealthReport>;
  readAppLog(opts: { keyword?: string; maxLines?: number; context?: number }): Promise<{ matches: Array<{ line: string; hit: boolean }>; file: string; truncated: boolean; generatedAt: string }>;
  /** 关于页：版本与运行环境 + 数据与存储概览（只读）。 */
  getSystemInfo(): Promise<import("./types").SystemInfo>;
  /** 关于页：在文件管理器中显示白名单目录（kind 由主进程解析，绝不传路径）。 */
  revealDataFolder(kind: import("./types").DataFolderKind): Promise<{ ok: boolean; path: string }>;
  runS3GcReconcile(ignoreRetention?: boolean): Promise<{ deleted: number; kept: number; clearedReferenced: number; ageUnknown: number }>;
  runS3DeepCleanup(dryRun: boolean, ignoreRetention?: boolean): Promise<DeepCleanupResult>;
  getTrashReminder(): Promise<Array<{ id: string; title: string; deletedAt: string }>>;
  /** 浏览器端服务（桌面附属窗口；仅本机、不落盘、每次启动默认关闭）。 */
  getWebStatus(): Promise<{ enabled: boolean; port: number; url: string }>;
  setWebEnabled(enabled: boolean): Promise<{ enabled: boolean; port: number; url: string }>;
  /** 用系统默认浏览器打开浏览器端地址（由主进程构造，失败返回 reason）。 */
  openWebClient(): Promise<{ ok: boolean; reason?: string }>;
  onSyncProgress(callback: (progress: SyncProgress) => void): () => void;
  onPendingSummaryChanged(callback: (summary: import("./types").SyncPendingSummary) => void): () => void;
  /** 目录树结构变更（其它窗口/浏览器端写入后广播）→ 调用方重读目录树。 */
  onLibraryChanged(callback: (detail: { channel?: string }) => void): () => void;
}

declare global {
  interface Window { lakeNative?: LakeNative; }
}

/** 是否存在原生桥：桌面 Electron 与移动 Capacitor **都**注入 window.lakeNative。 */
export const hasNativeBridge = () => typeof window.lakeNative !== "undefined";

/** Capacitor 原生平台（Android/iOS）判定；桌面 Electron 的 Capacitor.isNativePlatform() 实测为 false，web 为 "web"。 */
const isCapacitorNative = () =>
  (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;

/**
 * 是否桌面（Electron）壳。
 * 注意：移动端（Capacitor）**也**注入 window.lakeNative，所以不能只凭它判断；
 * 旧实现 `typeof lakeNative !== "undefined"` 在安卓同样返回 true，导致移动端误走桌面路径
 * （如 native.downloadRemoteResource / native.onSyncProgress 在移动端并不存在 → 抛错）。
 * 判据：有原生桥 且 不是 Capacitor 原生平台。
 */
export const isDesktop = () => hasNativeBridge() && !isCapacitorNative();

function api(): LakeNative {
  if (!window.lakeNative) throw new Error("原生桥接未就绪，请在 Electron 环境中运行");
  return window.lakeNative;
}

export const native = {
  /** 宿主能力（Web shim 下发；桌面/移动缺省 = 桌面）。 */
  get capabilities(): { browserClient: boolean; nativeDialog: boolean } {
    return api().capabilities ?? { browserClient: false, nativeDialog: true };
  },
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
  getNoteInfo: (id: string) => api().getNoteInfo(id),
  renameAssetDisplay: (noteId: string, filename: string, newName: string) => api().renameAssetDisplay(noteId, filename, newName),
  pickExportDir: () => api().pickExportDir(),
  exportNote: (id: string, format: "markdown" | "html" | "pdf" | "docx", baseDir?: string) => api().exportNote(id, format, baseDir),
  exportBitableCsv: (id: string, baseDir?: string) => api().exportBitableCsv(id, baseDir),
  exportBitableZip: (id: string, baseDir?: string) => api().exportBitableZip(id, baseDir),
  pickImportCsv: () => api().pickImportCsv(),
  pickBackupDir: () => api().pickBackupDir(),
  runWorkspaceBackup: (dir: string) => api().runWorkspaceBackup(dir),
  prepareCloudRestore: () => api().prepareCloudRestore(),
  confirmRelaunch: () => api().confirmRelaunch(),
  setNodeIcon: (id: string, icon: string | null) => api().setNodeIcon(id, icon),
  searchNotes: (query: string, limit?: number) => api().searchNotes(query, limit),
  rebuildSearchIndex: () => api().rebuildSearchIndex(),
  deleteNote: (id: string) => api().deleteNote(id),
  listTreeNodes: () => api().listTreeNodes(),
  listNoteSummaries: () => api().listNoteSummaries(),
  createNotebook: (title: string) => api().createNotebook(title),
  createGroup: (parentId: string, title: string) => api().createGroup(parentId, title),
  renameTreeNode: (id: string, title: string) => api().renameTreeNode(id, title),
  createNoteIn: (parentId: string | null, title: string) => api().createNoteIn(parentId, title),
  createSheetIn: (parentId: string | null, title: string) => api().createSheetIn(parentId, title),
  createBitableIn: (parentId: string | null, title: string) => api().createBitableIn(parentId, title),
  createBoardIn: (parentId: string | null, title: string) => api().createBoardIn(parentId, title),
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
  getLastHistoryCleanup: () => api().getLastHistoryCleanup(),
  listNoteOrphans: (noteId: string) => api().listNoteOrphans(noteId),
  previewHistorySnapshot: (historyId: number) => api().previewHistorySnapshot(historyId),
  previewNoteOrphan: (noteId: string, filename: string) => api().previewNoteOrphan(noteId, filename),
  cleanNoteOrphans: (noteId: string, filenames?: string[]) => api().cleanNoteOrphans(noteId, filenames),
  uploadResource: (input: ResourceUploadInput, noteId: string) => api().uploadResource(input, noteId),
  downloadRemoteResource: (url: string, noteId: string) => api().downloadRemoteResource(url, noteId),
  listOrphanAssets: () => api().listOrphanAssets(),
  cleanOrphanAssets: () => api().cleanOrphanAssets(),
  deleteOrphanAsset: (id: number) => api().deleteOrphanAsset(id),
  readOrphanPreview: (id: number) => api().readOrphanPreview(id),
  listRemovedAssets: () => api().listRemovedAssets(),
  readAssetPreview: (noteId: string, filename: string) => api().readAssetPreview(noteId, filename),
  openAttachment: (noteId: string, filename: string) => api().openAttachment(noteId, filename),
  showAttachmentInFolder: (noteId: string, filename: string) => api().showAttachmentInFolder(noteId, filename),
  revealNoteFile: (id: string) => api().revealNoteFile(id),
  openNoteAssets: (id: string) => api().openNoteAssets(id),
  copyAssetPath: (noteId: string, filename: string) => api().copyAssetPath(noteId, filename),
  copyAssetImage: (noteId: string, filename: string) => api().copyAssetImage(noteId, filename),
  saveAssetAs: (noteId: string, filename: string, suggestedName?: string) => api().saveAssetAs(noteId, filename, suggestedName),
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
  stageQuickNoteImage: (draftId: string, input: QuickNoteStageInput) => api().stageQuickNoteImage(draftId, input),
  stageQuickNoteFile: (draftId: string, input: QuickNoteStageInput) => api().stageQuickNoteFile(draftId, input),
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
  runS3GcDiagnostics: () => api().runS3GcDiagnostics(),
  runDataHealthCheck: () => api().runDataHealthCheck(),
  readAppLog: (opts: { keyword?: string; maxLines?: number; context?: number }) => api().readAppLog(opts),
  getSystemInfo: () => api().getSystemInfo(),
  revealDataFolder: (kind: import("./types").DataFolderKind) => api().revealDataFolder(kind),
  runS3GcReconcile: (ignoreRetention = false) => api().runS3GcReconcile(ignoreRetention),
  runS3DeepCleanup: (dryRun: boolean, ignoreRetention = false) => api().runS3DeepCleanup(dryRun, ignoreRetention),
  getTrashReminder: () => api().getTrashReminder(),
  getWebStatus: () => api().getWebStatus(),
  setWebEnabled: (enabled: boolean) => api().setWebEnabled(enabled),
  openWebClient: () => api().openWebClient(),
  onSyncProgress: (callback: (progress: SyncProgress) => void) => api().onSyncProgress(callback),
  onPendingSummaryChanged: (callback: (summary: import("./types").SyncPendingSummary) => void) => api().onPendingSummaryChanged(callback),
  onLibraryChanged: (callback: (detail: { channel?: string }) => void) => api().onLibraryChanged(callback),
};
