import { describe, expect, it } from "vitest";
import { buildSyncStatusModel } from "./syncStatusModel";

const base = { phase: "idle" as const, message: "仅本地保存", lastSyncedAt: null, pendingChanges: 0 };

describe("buildSyncStatusModel", () => {
  it("defaults to local saved and exposes pending counts", () => {
    expect(buildSyncStatusModel({ sync: base, pendingDocuments: 0, cloudEnabled: true })).toMatchObject({ statusLabel: "仅本地保存", statusClass: "local", pendingTotal: 0 });
    expect(buildSyncStatusModel({ sync: base, pendingDocuments: 2, pendingFolders: 1, pendingQuickNotes: 1, cloudEnabled: true })).toMatchObject({ statusLabel: "待同步", statusClass: "pending", pendingTotal: 4 });
  });

  it("preserves syncing, error, and conflict snapshot semantics", () => {
    expect(buildSyncStatusModel({ sync: { ...base, phase: "syncing" }, pendingDocuments: 0, cloudEnabled: true })).toMatchObject({ statusLabel: "同步中", statusClass: "syncing" });
    expect(buildSyncStatusModel({ sync: { ...base, phase: "error" }, pendingDocuments: 0, cloudEnabled: true })).toMatchObject({ statusLabel: "同步失败", statusClass: "error" });
    expect(buildSyncStatusModel({ sync: base, pendingDocuments: 0, cloudEnabled: true, conflictSnapshotCount: 1 })).toMatchObject({ hasConflictSnapshot: true, accessibleLabel: expect.stringContaining("历史快照") });
  });

  it("shows combined cloud-check after sync completes (aligned with SiYuan)", () => {
    expect(buildSyncStatusModel({ sync: { ...base, phase: "success", lastSyncedAt: "2026-08-31T10:00:00Z", message: "同步完成" }, pendingDocuments: 0, cloudEnabled: true })).toMatchObject({ statusLabel: "已同步", statusClass: "synced" });
  });
});
