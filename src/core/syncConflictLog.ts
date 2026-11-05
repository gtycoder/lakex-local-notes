/**
 * 同步记录账本（261105 定稿，第 4 项「同步冲突/覆盖可视化」的纯逻辑）。
 *
 * 背景：同步语义已定稿（三方合并、远端发布者胜、被覆盖本地版本强制留历史快照、不自动合并）。
 * 用户需要知情与可挽回的只有两类事：**远端覆盖本地**、**他端删除**（外加保存守卫的磁盘冲突审计）。
 * 字段级覆盖（标题/锁/图标）噪音大于价值，不记录；后台同步绝不弹窗。
 *
 * 本模块只做「从一轮同步结果里挑出要记账的事件」+「保留/轮转判据」+「聚合统计」，零 IO。
 * 落库、轮转执行、UI 都在平台侧（设备本地表，不进 S3、不进 git）。
 */
import type { WriteOp } from "./s3v3/plan/types.js";

/** 事件类型：只记用户需要知情的三类。 */
export type SyncConflictKind = "remote_wins" | "remote_purged" | "save_external_changed";

export type SyncConflictSpace = "lake" | "quickNotes";

export interface SyncConflictEvent {
  noteId: string;
  space: SyncConflictSpace;
  kind: SyncConflictKind;
  /** ISO 时间（本轮同步时间）。 */
  at: string;
  /** 记账时的标题快照（标题之后可能被改，留快照便于识别）。 */
  title?: string;
  /** 被覆盖的本地版本 hash（remote_wins）与远端版本 hash。 */
  localHash?: string;
  remoteHash?: string;
  /** 被覆盖版本对应的历史快照引用（恢复用）；无快照则缺省。 */
  historyRef?: string;
}

/** 保留上限（定稿：500 条 / 90 天，先到者为准）。 */
export const SYNC_CONFLICT_MAX_ROWS = 500;
export const SYNC_CONFLICT_RETENTION_DAYS = 90;

export interface ConflictRoundWrites {
  /** 本轮 plan 的写操作（只读消费）。 */
  writes: readonly WriteOp[];
}

/**
 * 从一轮 plan 的写操作里挑出要记账的事件。
 *
 * 判据（与引擎语义一一对应，别在这里另造）：
 * - `archive-local` + reason=`remote-wins` ⇒ 远端胜、本地被覆盖（本地版已归档）；
 * - `set-lifecycle` lifecycle=`cloud-deleted` ⇒ 他端已彻底删除，本地副本进回收站；
 * - `quick-soft-delete` ⇒ 他端已删除（小记缺席），本地跟随进小记回收站。
 * 同一 (noteId, space, kind) 在同一轮内只记一条（plan 可能对同一 id 产生多笔写）。
 */
export function selectConflictEvents(
  round: ConflictRoundWrites,
  options: {
    at: string;
    /** 标题快照提供方（可选）：拿不到就不填，不影响记账。 */
    titleOf?: (space: SyncConflictSpace, noteId: string) => string | undefined;
    /** 历史快照引用提供方（可选）：被覆盖版本已归档时给出，供「恢复本地版」使用。 */
    historyRefOf?: (space: SyncConflictSpace, noteId: string) => string | undefined;
  },
): SyncConflictEvent[] {
  const events: SyncConflictEvent[] = [];
  const seen = new Set<string>();
  const push = (space: SyncConflictSpace, noteId: string, kind: SyncConflictKind): void => {
    const key = space + "\u0000" + noteId + "\u0000" + kind;
    if (seen.has(key)) return;
    seen.add(key);
    const title = options.titleOf?.(space, noteId);
    const historyRef = options.historyRefOf?.(space, noteId);
    events.push({
      noteId, space, kind, at: options.at,
      ...(title ? { title } : {}),
      ...(historyRef ? { historyRef } : {}),
    });
  };
  for (const write of round.writes) {
    if (write.kind === "archive-local" && write.reason === "remote-wins") {
      push(write.space, write.id, "remote_wins");
      continue;
    }
    if (write.kind === "set-lifecycle" && write.lifecycle === "cloud-deleted") {
      push(write.space, write.id, "remote_purged");
      continue;
    }
    if (write.kind === "quick-soft-delete") {
      push(write.space, write.id, "remote_purged");
      continue;
    }
    // Review-A P1-3：他端「不可恢复删除」（purged 墓碑）也必须记账——这是最该让用户知道的删除。
    if (write.kind === "quick-purge") {
      push(write.space, write.id, "remote_purged");
    }
  }
  return events;
}

/** 保存守卫的磁盘冲突也进账本（审计用；不影响角标之外的任何同步行为）。 */
export function saveExternalChangedEvent(input: {
  noteId: string;
  at: string;
  title?: string;
  localHash?: string;
  remoteHash?: string;
}): SyncConflictEvent {
  return {
    noteId: input.noteId, space: "lake", kind: "save_external_changed", at: input.at,
    ...(input.title ? { title: input.title } : {}),
    ...(input.localHash ? { localHash: input.localHash } : {}),
    ...(input.remoteHash ? { remoteHash: input.remoteHash } : {}),
  };
}

/**
 * 轮转判据：先按「超过 90 天」再按「超过 500 条」裁掉最旧的，返回要删除的 id 列表。
 * 输入需按 at 倒序（最新在前）——调用方按表里的 at 排序即可；判据不依赖 id 语义。
 */
export function selectConflictsToPrune<T extends { id: string; at: string }>(
  rowsNewestFirst: readonly T[],
  now: Date,
  options: { maxRows?: number; retentionDays?: number } = {},
): string[] {
  const maxRows = options.maxRows ?? SYNC_CONFLICT_MAX_ROWS;
  const retentionDays = options.retentionDays ?? SYNC_CONFLICT_RETENTION_DAYS;
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const drop: string[] = [];
  rowsNewestFirst.forEach((row, index) => {
    const ms = Date.parse(row.at);
    const tooOld = Number.isFinite(ms) && ms < cutoff;
    const tooMany = index >= maxRows;
    if (tooOld || tooMany) drop.push(row.id);
  });
  return drop;
}

/** 角标数字：未被 ack 的事件数（ack 只影响角标，不删数据）。 */
export function unackedConflictCount(rows: readonly { ackedAt?: string | null }[]): number {
  let count = 0;
  for (const row of rows) if (!row.ackedAt) count += 1;
  return count;
}
