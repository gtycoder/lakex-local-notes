export interface TrashItem {
  id: string;
  title: string;
  nodeType: string;
  noteFileId: string | null;
  parentId: string | null;
  deletedAt: string | null;
  updatedAt: string;
  hasFile: boolean;
  /** 收到其他设备 purge 墓碑后被抑制的本地副本（保留可恢复、不上传） */
  purged: boolean;
  /** v3：云端已彻底删除（远端索引缺失）、本机仅保留回收站副本 —— 只打标，不限制恢复。
   *  与 purged 独立：purged=抑制位，cloudDeleted=「云端已删除 · 仅本地」展示位。 */
  cloudDeleted?: boolean;
}

export interface TrashReminderItem {
  id: string;
  title: string;
  deletedAt: string;
}

/** C1：回收站自动过期倒计时（多端共享纯函数）。
 * trashAutoPurgeDays<=0（关闭）→ null（不显示倒计时/不提示）；已过到期 → 0。 */
export function trashDaysUntilPurge(deletedAt: string | null, trashAutoPurgeDays: number): number | null {
  if (!deletedAt || !Number.isFinite(trashAutoPurgeDays) || trashAutoPurgeDays <= 0) return null;
  const timestamp = Date.parse(deletedAt);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp + trashAutoPurgeDays * 24 * 3600 * 1000 - Date.now()) / (24 * 3600 * 1000)));
}
