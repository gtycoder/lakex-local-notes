import { sqlParameterBatches } from "../core/sqlParameterBatch.js";
import type { MobileDb } from "./sqliteDb";

export interface S3GcPendingKey {
  key: string;
  markedAt: string;
}

export async function addS3GcPending(d: MobileDb, key: string): Promise<void> {
  await d.prepare("INSERT INTO s3_gc_pending(key,marked_at) VALUES(?,?) ON CONFLICT(key) DO NOTHING")
    .run(key, new Date().toISOString());
}

export async function removeS3GcPending(d: MobileDb, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  for (const batch of sqlParameterBatches(keys)) {
    const placeholders = batch.map(() => "?").join(",");
    await d.prepare(`DELETE FROM s3_gc_pending WHERE key IN (${placeholders})`).run(...batch);
  }
}

export async function listS3GcPending(d: MobileDb): Promise<S3GcPendingKey[]> {
  const rows = await d.prepare("SELECT key, marked_at AS markedAt FROM s3_gc_pending ORDER BY marked_at").all() as Array<{
    key: string;
    markedAt: string;
  }>;
  return rows.map((row) => ({ key: row.key, markedAt: row.markedAt }));
}

export async function recordS3GcLog(
  d: MobileDb,
  action: string,
  key: string,
  reason: string,
  ok: boolean,
): Promise<void> {
  await d.prepare("INSERT INTO s3_gc_log(ts,action,key,reason,commit_id,device_id,ok) VALUES(?,?,?,?,?,?,?)")
    .run(new Date().toISOString(), action, key, reason, null, "local", ok ? 1 : 0);
}
