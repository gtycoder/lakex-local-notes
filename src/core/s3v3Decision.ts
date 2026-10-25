/**
 * 三方（base × local × remote）单条目决策（纯逻辑）。
 * 判定顺序固定：restore_pending → 本地彻底删除意图 → 缺席/新增 → 常规变更。
 * 设计：docs/S3-REDESIGN.md §4.2/§4.3（含审计 P4-B / 第二份 P3-B）。
 */
export type ItemAction =
  | "none"
  | "upload"
  | "download"
  | "remote-purged-move-to-trash"
  | "local-purge-wins"
  | "remote-wins-keep-history"
  | "restore-upload";

export interface ItemDecisionInput {
  /** 基线里是否有该条目。 */
  basePresent: boolean;
  baseHash: string | null;
  localPresent: boolean;
  localHash: string | null;
  remotePresent: boolean;
  remoteHash: string | null;
  /** 本地显式恢复标记（唯一提前例外）。 */
  restorePending: boolean;
  /** 本地彻底删除意图（持久保留，见 s3v3Intent）。 */
  localPurgeIntent: boolean;
}

export function decideItem(input: ItemDecisionInput): ItemAction {
  const { basePresent, baseHash, localPresent, localHash, remotePresent, remoteHash, restorePending, localPurgeIntent } = input;

  // 1) 恢复是唯一显式例外：本地有内容才谈恢复。
  if (restorePending && localPresent) return "restore-upload";

  // 2) 本地彻底删除意图优先（删除压编辑）。
  if (localPurgeIntent && !localPresent && remotePresent) return "local-purge-wins";

  // 3) 基线缺失/两端新增。
  if (!basePresent) {
    if (localPresent && !remotePresent) return "upload";
    if (!localPresent && remotePresent) return "download";
    if (localPresent && remotePresent) {
      if (localHash && remoteHash && localHash === remoteHash) return "none";
      return "remote-wins-keep-history";
    }
    return "none";
  }

  // 4) 基线存在。
  if (localPresent && !remotePresent) return "remote-purged-move-to-trash";
  if (!localPresent && remotePresent) return "download"; // 无删除意图的本地缺失：按云端恢复
  if (!localPresent && !remotePresent) return "none";

  // 5) 两端都在：比较相对基线的变化。
  const localChanged = localHash !== baseHash;
  const remoteChanged = remoteHash !== baseHash;
  if (!localChanged && !remoteChanged) return "none";
  if (localChanged && !remoteChanged) return "upload";
  if (!localChanged && remoteChanged) return "download";
  return "remote-wins-keep-history"; // 先提交者胜：远端已发布
}
