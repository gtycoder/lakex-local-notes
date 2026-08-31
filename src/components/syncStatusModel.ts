import type { SyncStatus } from "../lib/types";

export interface SyncStatusModelInput {
  sync: SyncStatus;
  pendingDocuments: number;
  pendingFolders?: number;
  pendingQuickNotes?: number;
  cloudEnabled: boolean;
  conflictSnapshotCount?: number;
}

export interface SyncStatusModel {
  pendingTotal: number;
  statusLabel: string;
  statusClass: "local" | "pending" | "syncing" | "synced" | "error" | "disabled";
  accessibleLabel: string;
  hasConflictSnapshot: boolean;
}

export function buildSyncStatusModel(input: SyncStatusModelInput): SyncStatusModel {
  const pendingTotal = Math.max(0, input.pendingDocuments + (input.pendingFolders ?? 0) + (input.pendingQuickNotes ?? 0));
  let statusClass: SyncStatusModel["statusClass"] = "local";
  let statusLabel = "仅本地保存";
  if (!input.cloudEnabled) {
    statusClass = "disabled";
    statusLabel = "云同步未配置";
  } else if (input.sync.phase === "syncing") {
    statusClass = "syncing";
    statusLabel = "同步中";
  } else if (input.sync.phase === "error") {
    statusClass = "error";
    statusLabel = "同步失败";
  } else if (pendingTotal > 0 || input.sync.pendingChanges > 0) {
    statusClass = "pending";
    statusLabel = "待同步";
  } else if (input.sync.lastSyncedAt) {
    // 对齐思源：同步完成后按钮为"云+对钩"组合图标（默认色、不变绿），仅文字标注"已同步"
    statusClass = "synced";
    statusLabel = "已同步";
  }
  const accessibleLabel = `${statusLabel}${input.conflictSnapshotCount ? `，${input.conflictSnapshotCount} 个历史快照提醒` : ""}`;
  return { pendingTotal, statusLabel, statusClass, accessibleLabel, hasConflictSnapshot: Boolean(input.conflictSnapshotCount) };
}
