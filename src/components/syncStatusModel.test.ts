import { describe, expect, it } from "vitest";
import { buildSyncStatusModel } from "./syncStatusModel";

const base = { phase: "idle" as const, message: "仅本地保存", lastSyncedAt: null, pendingChanges: 0 };

describe("buildSyncStatusModel", () => {
  it("defaults to local saved and exposes pending counts", () => {
    expect(buildSyncStatusModel({ sync: base, saveState: "saved", saveLabel: "已保存", pendingDocuments: 0, pendingResources: 0, dirtyTabCount: 0, lastSavedAt: "2026-08-19T10:00:00Z", cloudEnabled: true })).toMatchObject({ localLabel: "本地已保存", statusLabel: "仅本地保存", statusClass: "local", pendingTotal: 0 });
    expect(buildSyncStatusModel({ sync: base, saveState: "saved", saveLabel: "已保存", pendingDocuments: 2, pendingResources: 3, pendingQuickNotes: 1, dirtyTabCount: 0, lastSavedAt: null, cloudEnabled: true })).toMatchObject({ statusLabel: "待上传 6", statusClass: "pending", pendingTotal: 6 });
  });

  it("preserves syncing, error, and conflict snapshot semantics", () => {
    expect(buildSyncStatusModel({ sync: { ...base, phase: "syncing" }, saveState: "saved", saveLabel: "已保存", pendingDocuments: 0, pendingResources: 0, dirtyTabCount: 0, lastSavedAt: null, cloudEnabled: true })).toMatchObject({ statusLabel: "同步中", statusClass: "syncing" });
    expect(buildSyncStatusModel({ sync: { ...base, phase: "error" }, saveState: "saved", saveLabel: "已保存", pendingDocuments: 0, pendingResources: 0, dirtyTabCount: 0, lastSavedAt: null, cloudEnabled: true })).toMatchObject({ statusLabel: "同步失败", statusClass: "error" });
    expect(buildSyncStatusModel({ sync: base, saveState: "saved", saveLabel: "已保存", pendingDocuments: 0, pendingResources: 0, dirtyTabCount: 0, lastSavedAt: null, cloudEnabled: true, conflictSnapshotCount: 1 })).toMatchObject({ hasConflictSnapshot: true, accessibleLabel: expect.stringContaining("历史快照") });
  });
});
