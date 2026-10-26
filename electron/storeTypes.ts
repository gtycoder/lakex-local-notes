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

/** S3 连接配置（密钥落盘前经 SecretCipher 加密） */
export interface S3Settings {
  endpoint: string; region: string; bucket: string; prefix: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}

/** 云同步开关与自动/手动同步策略（v4，可配置；存 settings 表，纯本地） */
export interface SyncSettings {
  /** 云同步总开关：false 时完全不执行任何 S3 后台任务/同步（纯本地）。 */
  enabled: boolean;
  /** 自动同步模式：interval=按间隔；onOpenClose=仅在开启/关闭时；manual=完全手动。 */
  autoMode: "interval" | "onOpenClose" | "manual";
  /** autoMode=interval 时的间隔分钟数（>=1）。 */
  autoIntervalMinutes: number;
  /** 按需资产（P0-4，261026，与移动端同口径）：首拉只同步 pointer/索引/正文，媒体打开/预览时补拉。
   *  缺省 false（全量语义）。 */
  deferAssets?: boolean;
}

/** S3 GC 保留策略配置（v4，可配置；存 settings 表，纯本地） */
export interface S3GcSettings {
  /** 待回收键保留窗口天数（默认 7） */
  gcRetentionDays: number;
  /** 定期对账周期小时数（默认 24） */
  gcIntervalHours: number;
  /** 回收站自动清空提醒天数（默认 0=关闭；仅提醒，不自动删） */
  trashAutoPurgeDays: number;
}

