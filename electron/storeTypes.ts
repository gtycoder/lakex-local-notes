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

/** S3 连接配置（密钥落盘前经 SecretCipher 加密）：单一来源 = src/core/syncUtils.ts（261029 收口）。 */
export type { S3Settings } from "../src/core/syncUtils.js";

/** 云同步开关与自动/手动同步策略：单一来源 = src/lib/types.ts（CORE-14 双定义已删）。
 *  渲染层/移动端用同一份；主进程只 re-export，不再维护第二份字段表（避免一侧加字段另一侧漏）。 */
export type { SyncSettings } from "../src/lib/types.js";

/** S3 GC 保留策略配置（v4，可配置；存 settings 表，纯本地） */
export interface S3GcSettings {
  /** 待回收键保留窗口天数（默认 7） */
  gcRetentionDays: number;
  /** 定期对账周期小时数（默认 24） */
  gcIntervalHours: number;
  /** 回收站自动清空提醒天数（默认 0=关闭；仅提醒，不自动删） */
  trashAutoPurgeDays: number;
}

