/**
 * 持久本地删除意图（纯逻辑）。
 * 设计：docs/SYNC-PROTOCOL.md §9 / §12.1（历史设计稿 S3-REDESIGN §4.2/§6.6 已删，git 可查；审计第三轮条件 2/3）。
 * 清除条件唯一：看到更高 generation 的索引且该 id 明确不在其中；显式 restore 是唯一提前清除条件。
 * 发布成功本身不清除；无基线时休眠但保留。
 */

export interface DeletionIntent {
  noteId: string;
  /** 删除意图产生时的云端世代（用于只认「更高 generation」）。 */
  targetEpoch: string;
  targetGeneration: number;
  /** 彻底删除发生时间；远端条目 updatedAt 更新于此 → 视为「他端显式恢复」，删除意图让位。 */
  purgedAt?: string;
}

export interface IntentContext {
  pointerEpoch: string;
  pointerGeneration: number;
  indexHasId: boolean;
  /** 用户显式恢复（唯一提前清除条件）。 */
  restored: boolean;
}

/** 是否清除删除意图。 */
export function shouldClearDeletionIntent(intent: DeletionIntent, ctx: IntentContext): boolean {
  if (ctx.restored) return true;
  if (ctx.pointerEpoch !== intent.targetEpoch) return false;
  if (ctx.pointerGeneration <= intent.targetGeneration) return false;
  return !ctx.indexHasId;
}
