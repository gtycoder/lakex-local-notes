/** 桌面同步对外类型（从 electron/sync.ts 拆出）。 */
// ===== 类型 =====
// Manifest 系列类型已外移至 src/core/manifestTypes.ts（lake-core，V5 Phase 1）。

// 同步结果类型**单一来源 = src/lib/types.ts**（含结构化 warnings）；此处 re-export，供主进程内部引用。
export type { QuickNotesSyncStatus, SyncResult, SyncWarning } from "../src/lib/types.js";

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
