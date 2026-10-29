/**
 * v4 IntentLog（E2-3 收尾）：删除/恢复意图的三段生命周期，收敛成纯函数。
 *
 * 为什么必须显式建模：v3 里这三段散在引擎的两个私有方法里（`bumpIntentsAfterPublish` /
 * `clearIntentsOnSync`），谁都能漏掉一段 —— 漏 bump ⇒ 迟到覆盖（下一轮又把已删条目传上去）；
 * 漏 clear ⇒ 意图永久残留（墓碑永胜，恢复后又被删）。
 *
 * 判据不搬：清除条件仍是 `core/s3v3Intent.shouldClearDeletionIntent`（单一来源）。
 * 本模块只负责「什么时候调它、以及 add/bump 的合并规则」。
 *
 * 三段：
 *  1. add（本地动作）：彻底删除 → 记 target(epoch, generation)；显式恢复 → 进 restorePending 并**撤掉**同 id 的删除意图；
 *  2. bump（发布成功）：真正发布的 purge 意图钉到**新 generation**（不立即清除，防迟到覆盖）；
 *  3. clear（未发布轮/恢复成功）：更高 generation 且索引明确不含该 id 才清；恢复成功立即清。
 */
import { shouldClearDeletionIntent, type DeletionIntent } from "../../s3v3Intent.js";

export interface IntentLogState {
  intents: DeletionIntent[];
  restorePending: string[];
}

export const emptyIntentLog = (): IntentLogState => ({ intents: [], restorePending: [] });

/** 计划输入：应被抑制上传的 id 集合（本地已彻底删除、等清除）。 */
export function pendingPurgeIds(state: IntentLogState): string[] {
  return state.intents.map((i) => i.noteId);
}

/** 本地彻底删除：记意图（同 id 覆盖为最新世代，幂等）。 */
export function addDeleteIntent(
  state: IntentLogState,
  intent: { noteId: string; epoch: string; generation: number; purgedAt?: string },
): IntentLogState {
  const next: DeletionIntent = { noteId: intent.noteId, targetEpoch: intent.epoch, targetGeneration: intent.generation, ...(intent.purgedAt ? { purgedAt: intent.purgedAt } : {}) };
  return {
    intents: [...state.intents.filter((i) => i.noteId !== intent.noteId), next],
    restorePending: state.restorePending.filter((id) => id !== intent.noteId),
  };
}

/** 显式恢复：唯一能撤销删除意图的用户动作（同时撤掉同 id 的删除意图）。 */
export function addRestoreIntent(state: IntentLogState, noteId: string): IntentLogState {
  return {
    intents: state.intents.filter((i) => i.noteId !== noteId),
    restorePending: state.restorePending.includes(noteId) ? state.restorePending : [...state.restorePending, noteId],
  };
}

/** 发布成功：把本轮真正发布的删除意图钉到新 generation；恢复成功的 id 出队。 */
export function settlePublished(
  state: IntentLogState,
  ctx: { epoch: string; generation: number; publishedIds: Iterable<string>; restoredIds?: Iterable<string> },
): IntentLogState {
  const published = new Set(ctx.publishedIds);
  const restored = new Set(ctx.restoredIds ?? []);
  return {
    intents: state.intents
      .filter((i) => !restored.has(i.noteId))
      .map((i) => (i.targetEpoch === ctx.epoch && published.has(i.noteId) ? { ...i, targetGeneration: ctx.generation } : i)),
    restorePending: state.restorePending.filter((id) => !restored.has(id)),
  };
}

/** 未发布轮：更高代 + 索引明确不含该 id 才清；恢复成功的 id 出队。 */
export function settleUnpublished(
  state: IntentLogState,
  ctx: { epoch: string; generation: number; indexIds: Iterable<string>; restoredIds?: Iterable<string> },
): IntentLogState {
  const indexIds = new Set(ctx.indexIds);
  const restored = new Set(ctx.restoredIds ?? []);
  return {
    intents: state.intents.filter((i) => !restored.has(i.noteId) && !shouldClearDeletionIntent(i, {
      pointerEpoch: ctx.epoch,
      pointerGeneration: ctx.generation,
      indexHasId: indexIds.has(i.noteId),
      restored: false,
    })),
    restorePending: state.restorePending.filter((id) => !restored.has(id)),
  };
}
