/** 双源收敛（V5 Phase 2）：ResourceUploadOutput 单一来源 = src/lib/types.ts（lake-core 共享类型）。 */
export type { ResourceUploadOutput } from "../src/lib/types.js";

/** 历史保留策略配置（P5，可配置；存 settings 表，纯本地） */
export interface HistorySettings {
  /** 每文档最多保留的快照份数（默认 100） */
  maxSnapshots: number;
  /** 快照保留天数兜底（默认 30） */
  retentionDays: number;
  /** 定期巡检清理间隔（小时，默认 24；0 = 关闭定期巡检） */
  cleanupIntervalHours: number;
  /** 自动快照间隔（分钟，默认 15；0 = 关闭自动快照） */
  snapshotIntervalMinutes: number;
}

export interface HistoryCleanupResult {
  deletedSnapshots: number;
  freedBytes: number;
}

