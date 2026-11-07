/**
 * 设置默认值单一来源（261107）：历史快照 / 回收站自动清理。
 *
 * 背景：此前默认值散落 4 处且已经漂移——桌面历史快照间隔 10、移动 15；回收站 90 天在移动端硬编码。
 * 本文件只放「跨端必须一致的产品默认值」，不放 UI、不放存储实现。
 */
export interface HistorySettingsDefaults {
  maxSnapshots: number;
  retentionDays: number;
  cleanupIntervalHours: number;
  /** 定时兜底快照间隔（分钟；0 = 关闭）。 */
  snapshotIntervalMinutes: number;
}

/** 历史快照默认值（261107 裁决：以桌面/注释口径 10 分钟为准；移动端 15 → 10）。 */
export const HISTORY_SETTINGS_DEFAULTS: HistorySettingsDefaults = {
  maxSnapshots: 100,
  retentionDays: 30,
  cleanupIntervalHours: 24,
  snapshotIntervalMinutes: 10,
};

/** 回收站自动过期天数（两端同口径；<=0 = 关闭）。 */
export const TRASH_AUTO_PURGE_DAYS = 90;
