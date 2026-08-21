/**
 * 共享领域类型（lake-core 对外类型面）。
 * 单一来源仍是 src/lib/types.ts（渲染层与 Electron 共用）；此处 re-export，
 * 供移动端 / 纯逻辑消费方从 lake-core 入口引用，不引入任何平台依赖。
 */
export type {
  NoteSummary,
  NoteDocument,
  NoteDigest,
  TreeNode,
  TreeNodeType,
  WorkspaceSnapshot,
  SyncSettings,
  S3GcSettings,
  S3GcPendingItem,
  S3GcLogItem,
  DeepCleanupResult,
  QuickNoteTrashItem,
  S3Settings,
  SyncStatus,
  DraftJournalEntry,
  SyncPendingSummary,
  QuickNotesSyncStatus,
  SyncResult,
  SyncProgress,
  SyncStatusInfo,
  ImportedResource,
  ResourceUploadInput,
  ResourceUploadOutput,
  OrphanAsset,
  CleanOrphanResult,
  QuickNoteImage,
  QuickNoteContent,
  QuickNoteSummary,
  QuickNoteDocument,
  SaveQuickNoteInput,
} from "../lib/types.js";
