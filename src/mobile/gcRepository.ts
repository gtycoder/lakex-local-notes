import { sqlParameterBatches } from "../core/sqlParameterBatch.js";
import type { DbLike } from "./sqliteDb";

export interface S3GcPendingKey {
  key: string;
  markedAt: string;
}

export function addS3GcPending(d: DbLike, key: string): void {
  d.prepare("INSERT INTO s3_gc_pending(key,marked_at) VALUES(?,?) ON CONFLICT(key) DO NOTHING")
    .run(key, new Date().toISOString());
}

export function removeS3GcPending(d: DbLike, keys: string[]): void {
  if (keys.length === 0) return;
  for (const batch of sqlParameterBatches(keys)) {
    const placeholders = batch.map(() => "?").join(",");
    d.prepare(`DELETE FROM s3_gc_pending WHERE key IN (${placeholders})`).run(...batch);
  }
}

export function listS3GcPending(d: DbLike): S3GcPendingKey[] {
  const rows = d.prepare("SELECT key, marked_at AS markedAt FROM s3_gc_pending ORDER BY marked_at").all() as Array<{
    key: string;
    markedAt: string;
  }>;
  return rows.map((row) => ({ key: row.key, markedAt: row.markedAt }));
}

export function recordS3GcLog(
  d: DbLike,
  action: string,
  key: string,
  reason: string,
  ok: boolean,
): void {
  d.prepare("INSERT INTO s3_gc_log(ts,action,key,reason,commit_id,device_id,ok) VALUES(?,?,?,?,?,?,?)")
    .run(new Date().toISOString(), action, key, reason, null, "local", ok ? 1 : 0);
}
