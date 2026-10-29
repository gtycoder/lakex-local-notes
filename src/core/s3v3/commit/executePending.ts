/**
 * v4 Commit 的收尾段（E2 pending）：执行「待删对象」队列 —— 门禁复用 `core/s3v3Gate`，本文件只做 IO 与队列语义。
 *
 * 为什么不把门禁搬过来：`gatePendingDelete` 是「宁可不删、不可误删」的唯一判据（数据安全护栏），
 * 两端 + 引擎已在用；v4 只换执行编排，判据保持单一来源。
 *
 * 语义（与 v3 `executePending` 一致）：
 *  - 门禁不放行 ⇒ **跳过并出队**（仍被引用/无法确认，保守丢弃这一项，不是失败）；
 *  - 前缀先删、键后删（purge 前缀可能已包含正文对象，先删前缀能让计数更准）；
 *  - 执行失败 ⇒ 本轮不消费队列，保留可执行项等下轮重试（失败只降级为 warning，不影响已成功的发布）；
 *  - 只在这里删「已不可达」的对象；用户语义的删除（user-purge）由 plan 的 DeleteOp 走 Apply。
 */
import { gatePendingDelete, type CurrentWorld, type PendingDelete } from "../../s3v3Gate.js";
import type { PlanWarning } from "../plan/types.js";

export interface PendingDeletePorts {
  deleteRemoteKeys(keys: string[]): Promise<void>;
  deleteRemotePrefix(prefix: string): Promise<number>;
}

export interface ExecutePendingResult {
  deletedObjects: number;
  /** 本轮真正执行删除的项（前缀/键）。 */
  executed: string[];
  /** dryRun 且门禁放行的项（不执行、不消费队列，仅供预演/排障）。 */
  wouldExecute: string[];
  /** 仍留在队列里的项：门禁放行但执行失败 ⇒ 下轮重试；门禁不放行的已出队。 */
  remaining: PendingDelete[];
  warnings: PlanWarning[];
}

const isPrefix = (p: PendingDelete) => p.kind === "purge-prefix" || p.kind === "quick-note-purge-prefix";

/** 执行待删队列。dryRun 只做门禁判定，不产生任何 IO。 */
export async function executePendingDeletes(
  pending: readonly PendingDelete[],
  world: CurrentWorld,
  ports: PendingDeletePorts,
  opts: { dryRun?: boolean } = {},
): Promise<ExecutePendingResult> {
  const warnings: PlanWarning[] = [];
  if (pending.length === 0) return { deletedObjects: 0, executed: [], wouldExecute: [], remaining: [], warnings };

  // 门禁：放行的才进执行集；不放行的直接从队列消失（仍被引用 ⇒ 不再需要删）。
  const executable = pending.filter((p) => gatePendingDelete(p, world).execute);
  const prefixes = executable.filter(isPrefix).map((p) => p.key);
  const keys = executable.filter((p) => !isPrefix(p)).map((p) => p.key);

  if (opts.dryRun) {
    return { deletedObjects: 0, executed: [], wouldExecute: [...prefixes, ...keys], remaining: executable, warnings };
  }

  let deletedObjects = 0;
  try {
    for (const prefix of prefixes) deletedObjects += await ports.deleteRemotePrefix(prefix);
    if (keys.length > 0) { await ports.deleteRemoteKeys(keys); deletedObjects += keys.length; }
  } catch (error) {
    warnings.push({ code: "cleanup_failed", space: "lake", detail: "待删执行失败，下轮重试: " + (error instanceof Error ? error.message : String(error)) });
    return { deletedObjects: 0, executed: [], wouldExecute: [], remaining: executable, warnings };
  }
  return { deletedObjects, executed: [...prefixes, ...keys], wouldExecute: [], remaining: [], warnings };
}
