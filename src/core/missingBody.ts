/**
 * 「缺正文」文档的可恢复性判据（纯函数，261023）。
 *
 * 手动删掉 .lake 后，资源页要能告诉用户"这篇还能怎么救"：
 * - **cloud**：已配置云同步、且本机判定「这篇曾在云端」（v3 事实：上一轮成功同步的云端文档集合 /
 *   小记的 quick_note_sync_base）⇒ 可以尝试从云端拉回正文；
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
  /** 这篇是否曾经同步到云端（Del-6：文档侧 = v3 上一轮成功同步的云端 id 集合，不再是 v2 的 sync_base）。 */
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

/** 缺正文「小记」的可恢复性：小记没有历史快照，只有两条路——云端镜像 / 搜索索引缓存文本。 */
export type MissingQuickNoteRecovery = "cloud" | "text" | "none";

export interface MissingQuickNoteDoc {
  id: string;
  createdAt: string;
  updatedAt: string;
  previewText: string;
  imageCount: number;
  tags: string;
  /** 本机 quick_note_sync_base 是否有记录（曾同步过）。 */
  hasSyncBase: boolean;
  /** 允许出网（已配置 S3 且未关闭云同步）。 */
  cloudConfigured: boolean;
  /** 搜索索引里是否还留有全文缓存（可从它重建纯文本；格式/图片会丢）。 */
  hasTextCache: boolean;
  recovery: MissingQuickNoteRecovery;
}

export function missingQuickNoteRecovery(input: {
  cloudConfigured: boolean;
  hasSyncBase: boolean;
  hasTextCache: boolean;
}): MissingQuickNoteRecovery {
  if (input.cloudConfigured && input.hasSyncBase) return "cloud";
  if (input.hasTextCache) return "text";
  return "none";
}
