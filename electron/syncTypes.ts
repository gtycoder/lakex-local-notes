/** 桌面同步对外类型（从 electron/sync.ts 拆出）。 */
// ===== 类型 =====
// Manifest 系列类型与 v2 同步引擎端口已删（D-7：v3 无 manifest，端口收口到 core/s3Ports + mobile 本地最小面）。

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
  /** 同步失败时的域错误码（S3v3SyncError.code；未知为 "unknown"）。 */
  errorCode?: string;
  /** 同步失败分类：retryable（可重试）/ action-required（需人工处理）/ fatal（数据损坏）。 */
  errorClass?: "retryable" | "action-required" | "fatal";
}
