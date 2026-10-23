/**
 * 「缺正文」文档的可恢复性判据（纯函数，261023）。
 *
 * 手动删掉 .lake 后，资源页要能告诉用户"这篇还能怎么救"：
 * - **cloud**：已配置云同步、且本机有 sync_base（曾经同步过）⇒ 可以尝试从云端拉回正文；
 * - **history**：没有云端依据，但有历史快照 ⇒ 至少能恢复最新历史版本；
 * - **none**：两边都没有 ⇒ 只能删除。
 *
 * 注意 cloud 只是"可尝试"：云端对象可能已被 GC / 清单已不含该文档，真正结果由拉取时判定
 *（失败会明确回报，不静默）。
 */
export type MissingBodyRecovery = "cloud" | "history" | "none";

export interface MissingBodyDoc {
  id: string;
  title: string;
  kind: "doc" | "usheet" | "bitable" | "board" | "ink";
  updatedAt: string;
  parentId: string | null;
  /** 历史快照数量。 */
  historyCount: number;
  /** 最新一份历史快照 id（无则 null）。 */
  lastHistoryId: number | null;
  /** 本地 sync_base 是否有记录（= 这篇曾经同步过）。 */
  hasSyncBase: boolean;
  /** 当前是否配置了 S3（不看"启用云同步"开关：这里是用户显式发起的恢复动作）。 */
  cloudConfigured: boolean;
  recovery: MissingBodyRecovery;
}

export function missingBodyRecovery(input: {
  cloudConfigured: boolean;
  hasSyncBase: boolean;
  historyCount: number;
}): MissingBodyRecovery {
  if (input.cloudConfigured && input.hasSyncBase) return "cloud";
  if (input.historyCount > 0) return "history";
  return "none";
}
