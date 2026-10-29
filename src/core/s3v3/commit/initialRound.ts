/**
 * v4 首传编排（淘汰旧 v3 第 1 步）：空桶/无 pointer 时的「首发」。
 *
 * 与增量轮（runSyncRound）刻意分开：首传的 base 恒为 null、目标世界恒为空，
 * 不引入「pointer 可空」的类型到增量路径（避免把可空语义污染整条链路）。
 * 语义与旧 initial publish 对齐：先对象后索引、再 pointer；被抢先 ⇒ retry。
 */
import type { LakeIndex, QuickNotesIndex, S3v3Pointer } from "../protocol/index.js";
import { planSync, type PlanWorld } from "../plan/plan.js";
import type { SyncPlan } from "../plan/types.js";
import { applyPlan, type ApplyResult } from "../apply/applyPlan.js";
import { applyAssets, type ApplyAssetsResult } from "../apply/applyAssets.js";
import { buildPublishIndex, type PublishWorld } from "./buildPublishIndex.js";
import { commitPlan, type CommitOptions, type CommitOutcome } from "./commitPlan.js";
import type { RoundPorts } from "./runSyncRound.js";

export interface InitialRoundResult {
  plan: SyncPlan;
  apply: ApplyResult;
  assets: ApplyAssetsResult;
  publish: PublishWorld | null;
  commit: CommitOutcome;
}

const EMPTY_WORLD: PlanWorld = {
  lake: { v: 3, space: "lake", notes: [], folders: [] },
  quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
  folders: [],
};

/** 空桶首传：本地就是真相，全部上传后发布 generation 1。 */
export async function initialRound(
  input: { local: PlanWorld; deviceId: string; deferAssets?: boolean; progress?: (p: { phase: "archives" | "reads" | "uploads" | "deletes" | "asset-put" | "asset-get"; done: number; total: number; bytesDone: number }) => void },
  ports: RoundPorts,
  commitOptions: CommitOptions = {},
): Promise<InitialRoundResult> {
  const plan = planSync({
    local: input.local,
    base: null,
    remote: { lake: EMPTY_WORLD.lake as LakeIndex, quickNotes: EMPTY_WORLD.quickNotes as QuickNotesIndex, folders: [] },
    state: { restorePending: [], purgeIntents: [], folderPurgeIntents: [] },
    deferAssets: input.deferAssets,
  });
  const apply = await applyPlan(plan, ports, {
    ...(input.deferAssets ? { deferDeclarations: true } : {}),
    ...(input.progress ? { onProgress: (p) => input.progress!({ phase: p.phase, done: p.done, total: p.total, bytesDone: p.bytes }) } : {}),
  });
  const assets = await applyAssets(plan, { declarations: apply.declarations }, ports, {
    deferDownloads: input.deferAssets === true,
    ...(input.progress ? { onProgress: (p) => input.progress!({ phase: p.phase, done: p.done, total: p.total, bytesDone: p.bytes }) } : {}),
  });
  // 首传没有「远端旧版本」可回退：失败条目直接不进索引（空世界 ⇒ 被移除）。
  const publish = buildPublishIndex(plan, { lake: EMPTY_WORLD.lake, quickNotes: EMPTY_WORLD.quickNotes }, { failedUploads: apply.failedUploads, assetsHashes: assets.assetsHashes });
  const commit = await commitPlan({ plan, next: publish, base: null, deviceId: input.deviceId }, ports, commitOptions);
  return { plan, apply, assets, publish, commit };
}

export type { S3v3Pointer };

