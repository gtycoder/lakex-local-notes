/**
 * 261105 P1 第 4 项：同步记录账本 IPC（设备本地表；不进 S3/git）。
 *
 * 形状（与桌面 UI 对齐）：
 * - list_sync_conflicts() → { items: SyncConflictRow[], unacked }
 * - ack_sync_conflicts(ids?) → { acked, unacked }（不传 = 全部未读置读）
 * - restore_sync_conflict(id) → 成功 { ok:true, noteId, restoredFromHistory } / 失败 { ok:false, reason, message }
 *   **不抛错**：UI 按 reason 给明确文案。
 */
import type { IpcRegistrar } from "./registrar.js";
import { IpcInputError } from "../ipcLimits.js";
import type { Store } from "../store.js";
import type { QuickNotesStore } from "../quickNotes.js";

export interface SyncConflictIpcDeps {
  store: Store;
  quickNotes: QuickNotesStore;
}

type RestoreFailureReason = "not-found" | "history-missing" | "history-expired" | "not-in-trash" | "unsupported" | "internal";

export function registerSyncConflictIpc(ipc: IpcRegistrar, deps: SyncConflictIpcDeps): void {
  ipc.handle("list_sync_conflicts", () => deps.store.listSyncConflicts());

  ipc.handle("ack_sync_conflicts", (ids?: unknown) => {
    let acked = 0;
    if (ids === undefined || ids === null) {
      acked = deps.store.syncConflicts.ackAll();
    } else {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new IpcInputError("同步记录 id 列表无效");
      acked = deps.store.ackSyncConflicts(ids as string[]);
    }
    return { acked, unacked: deps.store.syncConflicts.list(1).unacked };
  });

  ipc.handle("restore_sync_conflict", (id: unknown) => {
    const fail = (reason: RestoreFailureReason, message: string) => ({ ok: false as const, reason, message });
    if (typeof id !== "string" || !id) return fail("not-found", "同步记录 ID 无效");
    const row = deps.store.getSyncConflict(id);
    if (!row) return fail("not-found", "同步记录不存在");
    // 幂等：已恢复过直接返回成功。
    if (row.resolvedAt) return { ok: true as const, noteId: row.noteId, restoredFromHistory: row.resolution === "restored" && row.kind === "remote_wins" };
    if (row.kind === "save_external_changed") return fail("unsupported", "外部改动是审计记录，没有可恢复的目标版本（可打开文档或查看历史）");
    if (row.space === "quickNotes") {
      if (row.kind !== "remote_purged") return fail("unsupported", "小记没有历史快照，暂不支持恢复");
      try { deps.quickNotes.restoreQuickNote(row.noteId); }
      catch (error) { return fail("not-in-trash", "小记副本已不在回收站，无法恢复：" + (error instanceof Error ? error.message : String(error))); }
      deps.store.syncConflicts.markResolved(id, "restored");
      return { ok: true as const, noteId: row.noteId, restoredFromHistory: false };
    }
    if (row.space !== "lake") return fail("unsupported", "未知空间，无法恢复");
    if (row.kind === "remote_wins" && !row.historyRef) return fail("history-missing", "该记录没有可用的历史快照，无法恢复本地版本");
    try {
      deps.store.restoreSyncConflict(id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason: RestoreFailureReason = /不存在/.test(message) && !/快照/.test(message)
        ? "not-found"
        : /历史|快照/.test(message)
          ? "history-expired"
          : /回收站/.test(message)
            ? "not-in-trash"
            : "internal";
      return fail(reason, message);
    }
    return { ok: true as const, noteId: row.noteId, restoredFromHistory: row.kind === "remote_wins" };
  });
}
