/**
 * 位置字段的**独立三方合并**（261112 task-44；用户裁决：回收站 = 特殊笔记本，删除 = 把笔记移进该笔记本）。
 *
 * 为什么要独立合并：内容（正文/标题/标签）与位置（父目录 / 回收站 / 删除前父目录）是两个正交维度。
 * 旧实现只有内容判定（hash/updatedAt），位置跟着内容赢家走 ⇒
 *   · A 移入回收站（未同步）+ B 编辑正文 ⇒ 云端永远 active（A 的位置发不出去）；
 *   · A 移动文档到别的笔记本 + B 编辑正文 ⇒ A 的移动被 B 的 updatedAt 回滚。
 *
 * 判据（**只看位置三件套，不新增 wire 字段**）：
 *  - 本地≠base 且 远端==base ⇒ 位置赢家 = 本地（移动/删除优先，必须发布本地位置）；
 *  - 远端≠base 且 本地==base ⇒ 位置赢家 = 远端（应用远端位置）；
 *  - 两边都≠base ⇒ 保留既有 updatedAt LWW 兜底（先提交者胜；时间戳相等取本地，保证确定性）；
 *  - base 缺失（首拉/新增）⇒ 不判（"same"），沿用旧行为，避免对协议语义做无根据的推断。
 *
 * 纯函数、零 IO、两端共用（plan 用于合成索引条目，deviceStore 用于决定是否保留本地位置）。
 */
import type { LakeNoteEntry } from "../protocol/s3v3Index.js";

/** 位置三件套（undefined 与 null 同义：都是"没有"）。 */
export interface NotePosition {
  parentId: string | null;
  trashedAt: string | null;
  deletedFromParentId: string | null;
}

export type PositionWinner = "local" | "remote" | "same";

/**
 * 位置投影（**wire 口径**，task-61）：trashed 条目的 `parentId` 一律投影成 `null`。
 * 理由：桌面本地 trashed 行的 notes.parent_id 指向本地容器 `notebook-trash`（该 id 不在云端 folders[]），
 * 若按原值比较会与「基线是 null / 移动端保留原父」判成位置变化 ⇒ 每轮误发布；恢复位置只看 deletedFromParentId。
 * 因此比较与发布都按「位置 = trashedAt；原始父 = deletedFromParentId」的口径。
 */
export function positionOf(entry: Pick<LakeNoteEntry, "parentId" | "trashedAt" | "deletedFromParentId"> | null | undefined): NotePosition | null {
  if (!entry) return null;
  const trashedAt = entry.trashedAt ?? null;
  return {
    // task-61：wire 不携带本地回收站容器 id —— trashed 条目的 parentId 不承载树父语义。
    parentId: trashedAt ? null : (entry.parentId ?? null),
    trashedAt,
    deletedFromParentId: entry.deletedFromParentId ?? null,
  };
}

export function samePosition(a: NotePosition, b: NotePosition): boolean {
  return a.parentId === b.parentId && a.trashedAt === b.trashedAt && a.deletedFromParentId === b.deletedFromParentId;
}

/** 位置字段投影（写进索引条目 / apply-position 写操作用；空值显式写 null 便于比较）。 */
export function positionFields(pos: NotePosition): { parentId: string | null; trashedAt: string | null; deletedFromParentId: string | null } {
  return { parentId: pos.parentId, trashedAt: pos.trashedAt, deletedFromParentId: pos.deletedFromParentId };
}

export interface PositionMergeInput {
  base: NotePosition | null;
  local: NotePosition | null;
  remote: NotePosition | null;
  /** 两边都动时的 LWW 时间戳（缺省按空串比较 = 本地优先，确定性）。 */
  localUpdatedAt?: string;
  remoteUpdatedAt?: string;
}

export interface PositionMergeResult {
  winner: PositionWinner;
  /** 赢家的位置（winner=same 时为本地的当前位置）。 */
  position: NotePosition | null;
  /** 本地位置相对基线是否变化（pure-move 轮必须发布 ⇒ plan 用它置 indexChanged）。 */
  localChanged: boolean;
  /** 远端位置相对基线是否变化。 */
  remoteChanged: boolean;
}

export function mergeNotePosition(input: PositionMergeInput): PositionMergeResult {
  const { base, local, remote } = input;
  // 任一边缺席（新增/删除）时不做位置合并：交给原有的内容/缺席判定。
  if (!base || !local || !remote) {
    return { winner: "same", position: local, localChanged: false, remoteChanged: false };
  }
  const localChanged = !samePosition(local, base);
  const remoteChanged = !samePosition(remote, base);
  if (!localChanged && !remoteChanged) return { winner: "same", position: local, localChanged, remoteChanged };
  if (localChanged && !remoteChanged) return { winner: "local", position: local, localChanged, remoteChanged };
  if (!localChanged && remoteChanged) return { winner: "remote", position: remote, localChanged, remoteChanged };
  // 两边都动了：沿用既有 updatedAt LWW 兜底（先提交者胜；相等取本地保证两端确定性选同一方）。
  const winnerIsLocal = (input.localUpdatedAt ?? "") >= (input.remoteUpdatedAt ?? "");
  return { winner: winnerIsLocal ? "local" : "remote", position: winnerIsLocal ? local : remote, localChanged, remoteChanged };
}
// ===== 编辑锁字段的独立合并（task-47）=====
/** 锁状态（isLocked + lockedAt）。lockedAt 是"最后一次锁状态变更时间"（开锁/解锁都写）。 */
export interface NoteLockState { locked: boolean; lockedAt: string | null }
export type LockWinner = "local" | "remote" | "same";

export function lockStateOf(entry: { isLocked?: boolean; lockedAt?: string | null } | null | undefined): NoteLockState | null {
  if (!entry) return null;
  return { locked: !!entry.isLocked, lockedAt: entry.lockedAt ?? null };
}

function sameLock(a: NoteLockState, b: NoteLockState): boolean {
  return a.locked === b.locked && (a.lockedAt ?? "") === (b.lockedAt ?? "");
}

/**
 * 锁字段**独立三方合并**（与内容判定解耦；判据 = 云端基线）：
 *  - 本地变了、远端没变 ⇒ 本地赢（解锁/加锁都能发出去，不依赖"解锁必须带时间戳"）；
 *  - 远端变了、本地没变 ⇒ 远端赢；
 *  - 两边都变 ⇒ lockedAt LWW；时间戳相等/都空时**加锁优先**（保守：不静默丢掉保护锁）；
 *  - 无基线 ⇒ 只能按 lockedAt LWW（相等时加锁优先）。
 * lockedAt 是 ISO 串（桌面开/解锁都写 now）；缺时间戳的"解锁"靠 base 变更检测仍能赢。
 */
export function mergeNoteLock(input: { base: NoteLockState | null; local: NoteLockState | null; remote: NoteLockState | null }): { winner: LockWinner; state: NoteLockState | null } {
  const { base, local, remote } = input;
  if (!local || !remote) return { winner: "same", state: local ?? remote };
  const lww = (): { winner: LockWinner; state: NoteLockState } => {
    const la = local.lockedAt ?? "";
    const ra = remote.lockedAt ?? "";
    if (la > ra) return { winner: "local", state: local };
    if (ra > la) return { winner: "remote", state: remote };
    // 同版本时间戳但状态不同：加锁优先（确定性；两端同选）
    if (local.locked !== remote.locked) return local.locked ? { winner: "local", state: local } : { winner: "remote", state: remote };
    return { winner: "same", state: local };
  };
  if (!base) return lww();
  const localChanged = !sameLock(local, base);
  const remoteChanged = !sameLock(remote, base);
  if (!localChanged && !remoteChanged) return { winner: "same", state: local };
  if (localChanged && !remoteChanged) return { winner: "local", state: local };
  if (!localChanged && remoteChanged) return { winner: "remote", state: remote };
  return lww();
}
