/** 桌面同步对外类型（从 electron/sync.ts 拆出）。 */
// ===== 类型 =====
// Manifest 系列类型已外移至 src/core/manifestTypes.ts（lake-core，V5 Phase 1）。

export interface QuickNotesSyncStatus {
  uploaded: number; downloaded: number; conflicts: number;
  completedAt: string;
  error?: string;
}

export interface SyncResult {
  uploaded: number; downloaded: number; conflicts: number;
  manifestId: string; completedAt: string;
  /** 同步统计（思源式 tooltip）：上传/下载的目录数与字节数（正文 + 资源 + manifest）。 */
  foldersUploaded?: number; foldersDownloaded?: number;
  uploadedBytes?: number; downloadedBytes?: number;
  /** 本次同步总耗时（毫秒，含小记同步与 GC 标记）。 */
  durationMs?: number;
  /** 本次同步移入回收站的文档数（下载应用墓碑 + 本端软删发布，不含已在回收站的重复应用）。 */
  trashed?: number;
  /** 小记是独立同步空间，失败不会否定 Lake 文档本身的同步结果。 */
  quickNotes?: QuickNotesSyncStatus;
  /** 本地修改被远端覆盖、已存入历史的文档（用于 UI 提醒） */
  supersededNotes: Array<{ id: string; title: string }>;
  /** V5 §5.5：远端对象缺失（B 方案——跳过受影响条目、不覆盖本地、其余继续；manifest 损坏仍中止） */
  warnings?: Array<{ kind: "remote_incomplete" | "asset_missing"; noteId?: string }>;
}

export type SyncWarning = NonNullable<SyncResult["warnings"]>[number];

/** 同步进度事件（主进程 → 渲染进程） */
export interface SyncProgress {
  phase: "connect" | "download" | "upload" | "manifest" | "quick-notes" | "done";
  /** 主循环进度：笔记条目 */
  current?: number;
  total?: number;
  /** 资源（图片/附件）子进度 */
  assetCurrent?: number;
  assetTotal?: number;
  message: string;
  /** done 阶段附带：本地改动被远端覆盖、已存入历史的文档。 */
  supersededNotes?: Array<{ id: string; title: string }>;
  /** 同步失败时附带错误信息。 */
  error?: string;
}
