import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { SYNC_V3_REPORTS_KEY, appendSyncDiagnostic, readSyncDiagnostics } from "./syncDiagnosticsStore.js";
import { buildS3v3DiagnosticReport } from "../../core/s3v3Report.js";

/** SD-13 移动端：最近 3 轮同步诊断落 device_state（与桌面同键/同结构），坏数据不抛错。 */

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

const report = (at: string) => buildS3v3DiagnosticReport({ at, ok: true, durationMs: 12, uploaded: 1, downloaded: 2, phases: [{ phase: "bodies", ms: 10 }] });

describe("移动端同步诊断存储（SD-13）", () => {
  it("环形保留最近 3 轮，键/结构跨重启可读回", async () => {
    const db = await freshDb();
    for (const at of ["a", "b", "c", "d"]) await appendSyncDiagnostic(db, report(at));
    expect((await readSyncDiagnostics(db)).map((r) => r.at)).toEqual(["b", "c", "d"]);
    const row = await db.prepare("SELECT value FROM device_state WHERE key=?").get(SYNC_V3_REPORTS_KEY) as { value?: string } | undefined;
    expect(JSON.parse(row!.value!)).toHaveLength(3);
    await db.close();
  });

  it("损坏 JSON 当空列表；无 db 时走 localStorage 兜底（此处为空）", async () => {
    const db = await freshDb();
    await db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(SYNC_V3_REPORTS_KEY, "{bad");
    expect(await readSyncDiagnostics(db)).toEqual([]);
    expect(await readSyncDiagnostics(null)).toEqual([]);
    await db.close();
  });
});
