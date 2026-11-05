import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 「同步记录」UI 接线护栏（P1 第 4 项）：账本读数/入口/面板在 SyncStatusPopover 内自洽
 * （不依赖桌面壳新增 props：角标要常显，所以由 popover 自己按 visible 拉取），
 * 通道类型在 src/lib/native.ts + types.ts 单一来源。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const POPOVER = read("./SyncStatusPopover.tsx");
const CONTROLLER = read("./useSyncConflicts.ts");
const PANEL = read("./SyncConflictsPanel.tsx");
const TYPES = read("../../lib/types.ts");
const NATIVE = read("../../lib/native.ts");
const PRELOAD = read("../../../electron/preload.cjs");
const WEB = read("../../../electron/webApiServer.ts");

describe("同步记录 UI 接线（P1 第 4 项）", () => {
  it("角标：同步按钮上有未读小圆点 + 隐藏文案（a11y）；只有可见那份顶栏拉账本", () => {
    expect(POPOVER).toContain("<SyncConflictBadge count={conflicts.unacked} />");
    expect(POPOVER).toContain("条未读同步记录");
    expect(POPOVER).toContain("useSyncConflicts({ enabled: visible, syncToken: sync.lastSyncedAt })");
    expect(CONTROLLER).toContain("if (!options.enabled || !syncConflictBridgeAvailable()) return;");
  });

  it("入口：not open 时也拉（角标常显）；浮层内一行「最近同步有 N 处覆盖/删除 → 查看」", () => {
    expect(POPOVER).toContain("data-sync-conflicts-entry");
    expect(POPOVER).toContain("最近同步有 {conflicts.unacked} 处覆盖/删除");
    expect(POPOVER).toContain("查看同步记录");
    expect(POPOVER).toContain("sync.lastSyncedAt");
  });

  it("页面：独立浮层（不打断同步），恢复走二次确认 + 成功/失败文案", () => {
    expect(POPOVER).toContain("<SyncConflictsPanel");
    expect(PANEL).toContain("useConfirm");
    expect(PANEL).toContain("按本机版本重新上传");
    expect(PANEL).toContain("最近没有同步覆盖");
    expect(PANEL).toContain("全部标记已读");
    // 只对可恢复类型给恢复按钮（save_external_changed 是审计事件）
    expect(PANEL).toContain("canRestoreSyncConflict(row)");
  });

  it("类型与通道单一来源：SyncConflictRow/Snapshot + 三个 IPC 封装", () => {
    expect(TYPES).toContain("export interface SyncConflictRow");
    expect(TYPES).toContain("export interface SyncConflictsSnapshot");
    expect(TYPES).toContain('export type SyncConflictKind = "remote_wins" | "remote_purged" | "save_external_changed"');
    expect(NATIVE).toContain("listSyncConflicts: () => api().listSyncConflicts()");
    expect(NATIVE).toContain("ackSyncConflicts: (ids?: string[]) => api().ackSyncConflicts(ids)");
    expect(NATIVE).toContain("restoreSyncConflict: (id: string) => api().restoreSyncConflict(id)");
    // 三处同步（task-36 落地；通道一致性由 ipcChannelParity.test.ts 统一校验）
    expect(PRELOAD).toContain('listSyncConflicts: () => invoke("list_sync_conflicts")');
    expect(PRELOAD).toContain('ackSyncConflicts: (ids) => invoke("ack_sync_conflicts", ids)');
    expect(PRELOAD).toContain('restoreSyncConflict: (id) => invoke("restore_sync_conflict", id)');
    expect(WEB).toContain('listSyncConflicts: "list_sync_conflicts"');
    expect(WEB).toContain('restoreSyncConflict: "restore_sync_conflict"');
  });
});
