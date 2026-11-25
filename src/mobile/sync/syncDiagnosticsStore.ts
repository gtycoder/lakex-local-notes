/**
 * 移动端「最近 3 轮同步诊断」存储（SD-13 的移动等价物）。
 *
 * 桌面落 `device_state.sync_v3_reports`；移动落**同一个键**（device_state 表，随 App 数据持久）。
 * 旧 localStorage 迁移/浏览器预览兜底已删（261125 裁决，AGENTS §3#7）。
 * 写入点唯一 = `bridge.syncNow()`（成功与失败各写一轮）。
 * 结构/格式化与桌面共用 `core/s3v3Report`，不另造口径。
 */
import type { MobileDb } from "../data/dbPortTypes.js";
import { parseS3v3DiagnosticReports, pushS3v3DiagnosticReport, type S3v3DiagnosticReport } from "../../core/s3v3Report";

export const SYNC_V3_REPORTS_KEY = "sync_v3_reports";

function decode(raw: string | null | undefined): S3v3DiagnosticReport[] {
  if (!raw) return [];
  try { return parseS3v3DiagnosticReports(JSON.parse(raw)); } catch { return []; }
}

export async function readSyncDiagnostics(db: MobileDb | null): Promise<S3v3DiagnosticReport[]> {
  if (!db) return [];
  try {
    const row = await db.prepare("SELECT value FROM device_state WHERE key=?").get(SYNC_V3_REPORTS_KEY) as { value?: string } | undefined;
    return decode(row?.value);
  } catch { return []; }
}

export async function appendSyncDiagnostic(db: MobileDb | null, report: S3v3DiagnosticReport): Promise<void> {
  if (!db) return;
  const next = pushS3v3DiagnosticReport(await readSyncDiagnostics(db), report);
  const json = JSON.stringify(next);
  try {
    await db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(SYNC_V3_REPORTS_KEY, json);
  } catch { /* 表异常丢一轮诊断，不影响同步结果 */ }
}
