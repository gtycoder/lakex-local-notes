/**
 * 261105 P1 第 4 项：同步记录账本（设备本地表，不进 S3/git）。
 *
 * 判据全部复用 `src/core/syncConflictLog.ts`（Lead 定稿）：selectConflictEvents / selectConflictsToPrune /
 * unackedConflictCount；本文件只做**落库与轮转执行**，不另造事件语义。
 *
 * 表：sync_conflicts(id PK, note_id, space, kind, at, title, local_hash, remote_hash, history_ref,
 *                 acked_at, resolved_at, resolution)；索引 at。
 * - ack 只影响角标，不删数据；
 * - resolved = 已用恢复动作挽回（resolution='restored'），同时算 ack（角标下降）；
 * - 轮转：500 条 / 90 天（core 判据），超限/过期最旧优先删。
 */
import type { DbLike } from "./dbLike.js";
import {
  selectConflictsToPrune,
  unackedConflictCount,
  type SyncConflictEvent,
} from "../src/core/syncConflictLog.js";

export interface SyncConflictRow {
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

function nowIso(): string { return new Date().toISOString(); }

export class SyncConflictsRepository {
  constructor(private readonly db: DbLike) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        space TEXT NOT NULL,
        kind TEXT NOT NULL,
        at TEXT NOT NULL,
        title TEXT,
        local_hash TEXT,
        remote_hash TEXT,
        history_ref TEXT,
        acked_at TEXT,
        resolved_at TEXT,
        resolution TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_at ON sync_conflicts(at DESC);
    `);
  }

  /** 落库（同一「未解决 note+space+kind」只留一条，避免每轮重复刷屏）+ 轮转。 */
  insert(events: readonly SyncConflictEvent[]): number {
    if (events.length === 0) return 0;
    let inserted = 0;
    const tx = this.db.transaction(() => {
      for (const event of events) {
        const exists = this.db.prepare(
          "SELECT 1 FROM sync_conflicts WHERE note_id=? AND space=? AND kind=? AND resolved_at IS NULL LIMIT 1",
        ).get(event.noteId, event.space, event.kind);
        if (exists) continue;
        const id = event.space + ":" + event.noteId + ":" + event.kind + ":" + event.at;
        this.db.prepare(
          "INSERT OR IGNORE INTO sync_conflicts(id,note_id,space,kind,at,title,local_hash,remote_hash,history_ref) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(id, event.noteId, event.space, event.kind, event.at, event.title ?? null,
          event.localHash ?? null, event.remoteHash ?? null, event.historyRef ?? null);
        inserted += 1;
      }
    });
    tx();
    this.prune();
    return inserted;
  }

  /** 最近 N 条（at 倒序）+ 未读角标数。 */
  list(limit = 200): { rows: SyncConflictRow[]; unacked: number } {
    const rows = (this.db.prepare("SELECT * FROM sync_conflicts ORDER BY at DESC, id DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>)
      .map((row) => this.mapRow(row));
    const allUnacked = (this.db.prepare("SELECT acked_at FROM sync_conflicts").all() as Array<{ acked_at: string | null }>);
    return { rows, unacked: unackedConflictCount(allUnacked.map((row) => ({ ackedAt: row.acked_at }))) };
  }

  get(id: string): SyncConflictRow | null {
    const row = this.db.prepare("SELECT * FROM sync_conflicts WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  /** 标记已读（不删数据）；返回受影响条数。 */
  ack(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    const at = nowIso();
    let changed = 0;
    const tx = this.db.transaction(() => {
      for (const id of ids) {
        changed += this.db.prepare("UPDATE sync_conflicts SET acked_at=? WHERE id=? AND acked_at IS NULL").run(at, id).changes > 0 ? 1 : 0;
      }
    });
    tx();
    return changed;
  }

  /** 全部未读置读（角标归零）：「全部标记已读」。 */
  ackAll(): number {
    return this.db.prepare("UPDATE sync_conflicts SET acked_at=? WHERE acked_at IS NULL").run(nowIso()).changes;
  }

  /** 恢复动作结算：标 resolved + resolution，并同时算 ack（角标下降）。 */
  markResolved(id: string, resolution: string): void {
    const at = nowIso();
    this.db.prepare("UPDATE sync_conflicts SET resolved_at=?, resolution=?, acked_at=COALESCE(acked_at, ?) WHERE id=?").run(at, resolution, at, id);
  }

  /** 轮转（core 判据：500 条 / 90 天）：返回删除条数。 */
  prune(now = new Date()): number {
    const rows = this.db.prepare("SELECT id, at FROM sync_conflicts ORDER BY at DESC, id DESC").all() as Array<{ id: string; at: string }>;
    const drop = selectConflictsToPrune(rows, now);
    if (drop.length === 0) return 0;
    const tx = this.db.transaction(() => {
      for (const id of drop) this.db.prepare("DELETE FROM sync_conflicts WHERE id=?").run(id);
    });
    tx();
    return drop.length;
  }

  private mapRow(row: Record<string, unknown>): SyncConflictRow {
    return {
      id: String(row.id),
      noteId: String(row.note_id),
      space: String(row.space),
      kind: String(row.kind),
      at: String(row.at),
      title: row.title === null || row.title === undefined ? null : String(row.title),
      localHash: row.local_hash === null || row.local_hash === undefined ? null : String(row.local_hash),
      remoteHash: row.remote_hash === null || row.remote_hash === undefined ? null : String(row.remote_hash),
      historyRef: row.history_ref === null || row.history_ref === undefined ? null : String(row.history_ref),
      ackedAt: row.acked_at === null || row.acked_at === undefined ? null : String(row.acked_at),
      resolvedAt: row.resolved_at === null || row.resolved_at === undefined ? null : String(row.resolved_at),
      resolution: row.resolution === null || row.resolution === undefined ? null : String(row.resolution),
    };
  }
}
