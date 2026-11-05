/**
 * 261105 P1 第 4 项：同步记录账本（移动端，设备本地；不进 S3/git）。
 * 判据全部复用 core/syncConflictLog（selectConflictsToPrune / unackedConflictCount），这里只落库/轮转。
 */
import {
  selectConflictsToPrune,
  unackedConflictCount,
  type SyncConflictEvent,
} from "../../core/syncConflictLog.js";
import type { MobileDb } from "./sqliteDb.js";

export interface MobileSyncConflictRow {
  id: string;
  noteId: string;
  space: string;
  kind: string;
  at: string;
  title: string | null;
  localHash: string | null;
  remoteHash: string | null;
  historyRef: string | null;
  ackedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

function mapRow(row: Record<string, unknown>): MobileSyncConflictRow {
  const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
  return {
    id: String(row.id),
    noteId: String(row.note_id),
    space: String(row.space),
    kind: String(row.kind),
    at: String(row.at),
    title: str(row.title),
    localHash: str(row.local_hash),
    remoteHash: str(row.remote_hash),
    historyRef: str(row.history_ref),
    ackedAt: str(row.acked_at),
    resolvedAt: str(row.resolved_at),
    resolution: str(row.resolution),
  };
}

/** 落库（同一「未解决 note+space+kind」只留一条）+ core 轮转判据。 */
export async function insertSyncConflicts(d: MobileDb, events: readonly SyncConflictEvent[], now = new Date()): Promise<number> {
  if (events.length === 0) return 0;
  let inserted = 0;
  await d.transaction(async () => {
    for (const event of events) {
      const exists = await d.prepare("SELECT 1 FROM sync_conflicts WHERE note_id=? AND space=? AND kind=? AND resolved_at IS NULL LIMIT 1")
        .get(event.noteId, event.space, event.kind);
      if (exists) continue;
      const id = event.space + ":" + event.noteId + ":" + event.kind + ":" + event.at;
      await d.prepare(
        "INSERT OR IGNORE INTO sync_conflicts(id,note_id,space,kind,at,title,local_hash,remote_hash,history_ref) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(id, event.noteId, event.space, event.kind, event.at, event.title ?? null,
        event.localHash ?? null, event.remoteHash ?? null, event.historyRef ?? null);
      inserted += 1;
    }
  });
  await pruneSyncConflicts(d, now);
  return inserted;
}

export async function listSyncConflicts(d: MobileDb, limit = 200): Promise<{ items: MobileSyncConflictRow[]; unacked: number }> {
  const rows = await d.prepare("SELECT * FROM sync_conflicts ORDER BY at DESC, id DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
  const all = await d.prepare("SELECT acked_at FROM sync_conflicts").all() as Array<{ acked_at: string | null }>;
  return {
    items: rows.map(mapRow),
    unacked: unackedConflictCount(all.map((row) => ({ ackedAt: row.acked_at }))),
  };
}

export async function getSyncConflict(d: MobileDb, id: string): Promise<MobileSyncConflictRow | null> {
  const row = await d.prepare("SELECT * FROM sync_conflicts WHERE id=?").get(id) as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export async function ackSyncConflicts(d: MobileDb, ids?: readonly string[]): Promise<{ acked: number; unacked: number }> {
  const at = new Date().toISOString();
  let acked = 0;
  if (!ids) {
    acked = Number((await d.prepare("UPDATE sync_conflicts SET acked_at=? WHERE acked_at IS NULL").run(at)).changes ?? 0);
  } else {
    await d.transaction(async () => {
      for (const id of ids) {
        const changed = await d.prepare("UPDATE sync_conflicts SET acked_at=? WHERE id=? AND acked_at IS NULL").run(at, id);
        acked += Number(changed.changes ?? 0);
      }
    });
  }
  const { unacked } = await listSyncConflicts(d, 1);
  return { acked, unacked };
}

export async function markSyncConflictResolved(d: MobileDb, id: string, resolution: string): Promise<void> {
  const at = new Date().toISOString();
  await d.prepare("UPDATE sync_conflicts SET resolved_at=?, resolution=?, acked_at=COALESCE(acked_at, ?) WHERE id=?").run(at, resolution, at, id);
}

export async function pruneSyncConflicts(d: MobileDb, now = new Date()): Promise<number> {
  const rows = await d.prepare("SELECT id, at FROM sync_conflicts ORDER BY at DESC, id DESC").all() as Array<{ id: string; at: string }>;
  const drop = selectConflictsToPrune(rows, now);
  if (drop.length === 0) return 0;
  await d.transaction(async () => {
    for (const id of drop) await d.prepare("DELETE FROM sync_conflicts WHERE id=?").run(id);
  });
  return drop.length;
}
