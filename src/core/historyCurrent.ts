/**
 * 历史快照「当前」标记的唯一判据（261106）。
 *
 * 面板里「当前」= 正文已落盘那份（currentHash）对应的**最新一条**快照；同一内容可能因历史
 * 存量重复行而有多条同 hash 快照，此时只允许把「当前」标在最新一条上（其余只是同内容旧档）。
 */
export interface HistorySnapshotLike {
  id: number;
  contentHash: string;
}

export function pickCurrentHistorySnapshotId<T extends HistorySnapshotLike>(
  list: readonly T[],
  currentHash: string | null | undefined,
): number | null {
  if (!currentHash) return null;
  for (const item of list) if (item.contentHash === currentHash) return item.id;
  return null;
}
