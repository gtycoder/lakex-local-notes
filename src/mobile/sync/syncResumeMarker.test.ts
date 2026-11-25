import { describe, expect, it, vi } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDbWeb.js";
import { applyMobileSchema } from "../data/schema.js";
import { clearSyncInterrupted, hasInterruptedSync, markSyncInterrupted, readSyncInterruptedAt } from "./syncResumeMarker.js";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

describe("移动端断点续传标记（device_state 持久化）", () => {
  it("写标记/读标记/成功清除；值落 device_state", async () => {
    const db = await freshDb();
    expect(await hasInterruptedSync(db)).toBe(false);
    await markSyncInterrupted(db, "2026-10-26T12:00:00.000Z");
    expect(await readSyncInterruptedAt(db)).toBe("2026-10-26T12:00:00.000Z");
    expect(await hasInterruptedSync(db)).toBe(true);
    const row = await db.prepare("SELECT value FROM device_state WHERE key='sync_interrupted_at'").get() as { value?: string } | undefined;
    expect(row?.value).toBe("2026-10-26T12:00:00.000Z");
    await clearSyncInterrupted(db);
    expect(await hasInterruptedSync(db)).toBe(false);
  });

  it("localStorage 旧值不再读（迁移兜底已删，261125 裁决）", async () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => { data.set(k, v); },
      removeItem: (k: string) => { data.delete(k); },
      clear: () => data.clear(),
    });
    try {
      const db = await freshDb();
      localStorage.setItem("lakex-local-notes-mobile.syncInterruptedAt", "2026-10-26T11:00:00.000Z");
      expect(await readSyncInterruptedAt(db)).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });

  it("没有数据库时静默 no-op（丢一次续传标记 = 多补一次同步，用户已接受）", async () => {
    await expect(markSyncInterrupted(null, "x")).resolves.toBeUndefined();
    expect(await readSyncInterruptedAt(null)).toBeNull();
    await expect(clearSyncInterrupted(null)).resolves.toBeUndefined();
  });
});
