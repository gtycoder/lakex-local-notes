import type { SyncStatus } from "../lib/types";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface SyncStatusModelInput {
  sync: SyncStatus;
  saveState: SaveState;
  saveLabel: string;
  pendingDocuments: number;
  pendingResources: number;
  pendingQuickNotes?: number;
  dirtyTabCount: number;
  lastSavedAt: string | null;
  cloudEnabled: boolean;
  conflictSnapshotCount?: number;
}

export interface SyncStatusModel {
  localLabel: string;
  pendingTotal: number;
  statusLabel: string;
  statusClass: "local" | "pending" | "syncing" | "synced" | "error" | "disabled";
  accessibleLabel: string;
  hasConflictSnapshot: boolean;
}

export function buildSyncStatusModel(input: SyncStatusModelInput): SyncStatusModel {
  const pendingTotal = Math.max(0, input.pendingDocuments + input.pendingResources + (input.pendingQuickNotes ?? 0));
  const localLabel = input.saveState === "saving" ? "本地保存中" : input.saveState === "dirty" ? "有未保存更改" : input.saveState === "error" ? "本地保存失败" : "本地已保存";
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
    statusLabel = `待上传 ${pendingTotal || input.sync.pendingChanges}`;
  } else if (input.sync.phase === "success" && input.sync.lastSyncedAt) {
    statusClass = "synced";
    statusLabel = "已同步";
  }
  const accessibleLabel = `${localLabel}，${statusLabel}${input.conflictSnapshotCount ? `，${input.conflictSnapshotCount} 个历史快照提醒` : ""}`;
  return { localLabel, pendingTotal, statusLabel, statusClass, accessibleLabel, hasConflictSnapshot: Boolean(input.conflictSnapshotCount) };
}
