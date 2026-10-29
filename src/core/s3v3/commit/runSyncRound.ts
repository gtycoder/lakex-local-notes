/**
 * v4 整轮编排（E2-3 的「四相」内核）：把已有的纯/IO 模块串成**一轮同步**。
 *
 * 它的存在意义 = 引擎切换前先把「顺序与不变量」定死在一个可测单元里：
 *   plan（决策）→ apply（正文/声明 IO）→ assets（声明差集）→ buildPublishIndex（合成真相）
 *   → commit（锁 + 读回 + 指针）→ executePending（对象清理）→ settle*（意图生命周期）。
 *
 * 本函数**不做**：读 pointer/索引、写基线、选区/UI 进度、换机全量重拉（这些留在引擎/适配层）。
 * 失败语义：apply/commit 的 warning 全量透出；commit 返回 retry 时**不**执行清理（下一轮重来）。
 */
import type { LakeIndex, QuickNotesIndex, S3v3Pointer } from "../protocol/index.js";
import type { CurrentWorld, PendingDelete } from "../../s3v3Gate.js";
import { planSync, type PlanState, type PlanWorld } from "../plan/plan.js";
import type { PlanWarning, SyncPlan } from "../plan/types.js";
import { applyPlan, type ApplyPorts, type ApplyResult } from "../apply/applyPlan.js";
import { applyAssets, type ApplyAssetsResult, type AssetContext, type AssetPorts } from "../apply/applyAssets.js";
import { buildPublishIndex, type PublishWorld } from "./buildPublishIndex.js";
import { commitPlan, type CommitOptions, type CommitOutcome, type CommitPorts } from "./commitPlan.js";
import { executePendingDeletes, type PendingDeletePorts } from "./executePending.js";
import { settlePublished, settleUnpublished, type IntentLogState } from "./intentLog.js";

export interface RoundPorts extends Omit<ApplyPorts, "putRemote">, Omit<CommitPorts, "putRemote">, AssetPorts, PendingDeletePorts {
  /** 三处端口共用：声明/索引要走 gzip 标记，正文不需要。 */
  putRemote(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }): Promise<void>;
  loadIntentLog(): Promise<IntentLogState>;
  saveIntentLog(state: IntentLogState): Promise<void>;
  loadPending(): Promise<PendingDelete[]>;
  savePending(pending: PendingDelete[]): Promise<void>;
}

export interface RoundInput {
  local: PlanWorld;
  base: PlanWorld | null;
  remote: PlanWorld;
  /** 计划所基于的 pointer；null = **首传**（云端还没有 pointer）。 */
  basePointer: S3v3Pointer | null;
  deviceId: string;
  state?: PlanState;
  deferAssets?: boolean;
  commitOptions?: CommitOptions;
  /** 进度上报（引擎桥到 UI；纯可选，缺省不报）。 */
  progress?: (p: { phase: "archives" | "reads" | "uploads" | "deletes" | "asset-put" | "asset-get"; done: number; total: number; bytesDone: number }) => void;
}

export interface RoundResult {
  plan: SyncPlan;
  apply: ApplyResult;
  assets: ApplyAssetsResult;
  publish: PublishWorld | null;
  commit: CommitOutcome;
  deleted: number;
  remainingPending: PendingDelete[];
  intents: IntentLogState;
  /** 本轮结束后的 pointer（commit 发布/不变；retry 时仍是 base）。 */
  nextPointer: S3v3Pointer;
  warnings: PlanWarning[];
}

/** 跑一轮。commit 为 retry 时不做清理/意图结算（等价于引擎的 PublishRetry：整轮重来）。 */
export async function runSyncRound(input: RoundInput, ports: RoundPorts): Promise<RoundResult> {
  if (!input.basePointer) throw new Error("runSyncRound 需要 basePointer（无基线请先走首拉路径）");
  const basePointer = input.basePointer;
  const plan = planSync({ local: input.local, base: input.base, remote: input.remote, state: input.state ?? { restorePending: [], purgeIntents: [], folderPurgeIntents: [] }, deferAssets: input.deferAssets });

  const apply = await applyPlan(plan, ports, {
    ...(input.deferAssets ? { deferDeclarations: true } : {}),
    ...(input.progress ? { onProgress: (p) => input.progress!({ phase: p.phase, done: p.done, total: p.total, bytesDone: p.bytes }) } : {}),
  });
  const assetCtx: AssetContext = { declarations: apply.declarations };
  const assets = await applyAssets(plan, assetCtx, ports, {
    deferDownloads: input.deferAssets === true,
    ...(input.progress ? { onProgress: (p) => input.progress!({ phase: p.phase, done: p.done, total: p.total, bytesDone: p.bytes }) } : {}),
  });

  const publish = buildPublishIndex(
    plan,
    // 失败回退的「旧版本」必须取**远端**世界（取本地 = 自己回退到自己，索引必然变化 ⇒ 引用未落盘正文）。
    { lake: input.remote.lake, quickNotes: input.remote.quickNotes },
    { failedUploads: apply.failedUploads, assetsHashes: assets.assetsHashes },
  );
  const commit = await commitPlan({ plan, next: publish, base: basePointer, deviceId: input.deviceId }, ports, input.commitOptions ?? {});

  // plan 的警告必须一起透出（冲突留档 conflict_kept_history 只在 plan 里产生；漏掉会让 UI 冲突清单为空）。
  const warnings: PlanWarning[] = [...plan.warnings, ...apply.warnings, ...assets.warnings];
  // retry：本轮决定作废（索引已写也只是孤儿对象，由 deepCleanup 兜底），不碰清理与意图。
  if (commit.status === "retry") {
    return { plan, apply, assets, publish, commit, deleted: 0, remainingPending: [], intents: input.state ? { intents: input.state.purgeIntents.map((id) => ({ noteId: id, targetEpoch: basePointer.epoch, targetGeneration: basePointer.generation })), restorePending: input.state.restorePending } : { intents: [], restorePending: [] }, nextPointer: basePointer, warnings };
  }

  // 清理：只有本轮真的发布了新 pointer 才清（unchanged/skipped 不产生新的孤儿）。
  const nextLake: LakeIndex = publish?.lake ?? input.remote.lake;
  const nextQuick: QuickNotesIndex = publish?.quickNotes ?? input.remote.quickNotes;
  const world: CurrentWorld = {
    lakeCommit: commit.status === "published" ? commit.lakeCommit : basePointer.lake.commit,
    quickNotesCommit: commit.status === "published" ? commit.quickNotesCommit : basePointer.quickNotes.commit,
    notes: nextLake.notes,
    quickNotes: nextQuick.items,
    declarations: {},
    quickDeclarations: {},
  };
  for (const d of apply.declarations) {
    if (d.space === "lake") world.declarations[d.id] = { declHash: d.declHash, filenames: d.assets.map((a) => a.filename) };
    else world.quickDeclarations[d.id] = { declHash: d.declHash, filenames: d.assets.map((a) => a.filename) };
  }
  const pending = await ports.loadPending();
  const cleanup = await executePendingDeletes(pending, world, ports);
  warnings.push(...cleanup.warnings);
  if (commit.status === "published") await ports.savePending(cleanup.remaining);

  // 意图结算：发布成功 ⇒ bump；未发布 ⇒ 按更高代 + 索引缺席清。
  const log = await ports.loadIntentLog();
  const restoredIds = log.restorePending.filter((id) => plan.publishes.lake.includes(id) || plan.publishes.quickNotes.includes(id));
  const nextPointer = commit.status === "published" ? commit.pointer : basePointer;
  const intents = commit.status === "published"
    ? settlePublished(log, { epoch: nextPointer.epoch, generation: nextPointer.generation, publishedIds: plan.deletes.map((d) => d.id), restoredIds })
    : settleUnpublished(log, { epoch: nextPointer.epoch, generation: nextPointer.generation, indexIds: [...nextLake.notes.map((n) => n.id), ...nextQuick.items.map((q) => q.id)], restoredIds });
  await ports.saveIntentLog(intents);

  return { plan, apply, assets, publish, commit, deleted: cleanup.deletedObjects, remainingPending: cleanup.remaining, intents, nextPointer, warnings };
}
