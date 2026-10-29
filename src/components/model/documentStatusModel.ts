export type LocalSaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type DocumentSyncKind = "local-only" | "pending" | "synced" | "synced-history" | "conflict";

export interface DocumentStatusInput {
  /** 云同步是否**处于启用状态**（已配置 S3 且开关打开）——不是「S3 是否配置过」。
   *  用 cloudState 的 UI 判据 isCloudActive()；关掉开关/没配置都应显示「仅本地」（regression 261029）。 */
  cloudEnabled: boolean;
  /** UI 待同步标记（is_dirty；替代 sync_state='local'）。 */
  isDirty?: boolean;
  isConflict?: boolean;
  /** v3：云端已彻底删除、本机仅保留回收站副本（「云端已删除 · 仅本地」）。 */
  isCloudDeleted?: boolean;
  saveState: LocalSaveState;
  historyCount?: number;
}

export interface DocumentStatusModel {
  kind: DocumentSyncKind | "saving" | "dirty" | "save-error" | "cloud-deleted";
  label: string;
  historyCount: number;
}

export function getDocumentStatus(input: DocumentStatusInput): DocumentStatusModel {
  const historyCount = Math.max(0, input.historyCount ?? 0);
  if (input.saveState === "saving") return { kind: "saving", label: "保存中", historyCount };
  if (input.saveState === "dirty") return { kind: "dirty", label: "待保存", historyCount };
  if (input.saveState === "error") return { kind: "save-error", label: "保存失败", historyCount };
  // 云端已彻底删除、本机仅保留回收站副本：不限制恢复，恢复并重新上传成功后该标记会自动消失。
  if (input.isCloudDeleted) return { kind: "cloud-deleted", label: "云端已删除（仅本地）", historyCount };
  if (!input.cloudEnabled) return { kind: "local-only", label: "仅本地", historyCount };
  if (input.isConflict) {
    if (historyCount > 0) return { kind: "synced-history", label: `已同步，历史 ${historyCount}`, historyCount };
    return { kind: "conflict", label: "有冲突", historyCount };
  }
  if (input.isDirty) return { kind: "pending", label: "待同步", historyCount };
  return { kind: historyCount > 0 ? "synced-history" : "synced", label: historyCount > 0 ? `已同步，历史 ${historyCount}` : "已同步", historyCount };
}
