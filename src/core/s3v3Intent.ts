/**
 * 持久本地删除意图（纯逻辑）。
 * 设计：docs/S3-REDESIGN.md §4.2 / §6.6（审计第三轮条件 2/3）。
 * 清除条件唯一：看到更高 generation 的索引且该 id 明确不在其中；显式 restore 是唯一提前清除条件。
 * 发布成功本身不清除；无基线时休眠但保留。
 */

export interface DeletionIntent {
  noteId: string;
  /** 删除意图产生时的云端世代（用于只认「更高 generation」）。 */
  targetEpoch: string;
  targetGeneration: number;
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

/** 是否仍处于「删除意图生效」状态（用于迟到覆盖/分叉时重新压制）。 */
export function isDeletionIntentActive(intent: DeletionIntent, ctx: IntentContext): boolean {
  return !shouldClearDeletionIntent(intent, ctx);
}

/**
 * 迟到覆盖下是否需要重新发布删除：
 * 意图仍生效，且当前索引又把该 id 写回来了（无论 generation 是否变化）。
 */
export function shouldRepublishPurge(intent: DeletionIntent, ctx: IntentContext): boolean {
  return isDeletionIntentActive(intent, ctx) && ctx.indexHasId;
}
