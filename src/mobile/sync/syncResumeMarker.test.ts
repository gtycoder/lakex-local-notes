import { afterEach, describe, expect, it, vi } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { clearSyncInterrupted, hasInterruptedSync, markSyncInterrupted, readSyncInterruptedAt } from "./syncResumeMarker.js";

function stubLocalStorage(): void {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  });
}

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

describe("移动端断点续传标记（device_state 持久化）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("写标记/读标记/成功清除；值落 device_state", async () => {
    stubLocalStorage();
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

  it("迁移兼容：只有 localStorage 旧值时也能读到；清除会同时清两份", async () => {
    stubLocalStorage();
    const db = await freshDb();
    localStorage.setItem("local-lakex-notes-mobile.syncInterruptedAt", "2026-10-26T11:00:00.000Z");
    expect(await readSyncInterruptedAt(db)).toBe("2026-10-26T11:00:00.000Z");
    await clearSyncInterrupted(db);
    expect(localStorage.getItem("local-lakex-notes-mobile.syncInterruptedAt")).toBeNull();
  });

  it("没有数据库（极端环境）时退化为 localStorage，不抛错", async () => {
    stubLocalStorage();
    await expect(markSyncInterrupted(null, "x")).resolves.toBeUndefined();
    expect(await readSyncInterruptedAt(null)).toBe("x");
    await clearSyncInterrupted(null);
    expect(await readSyncInterruptedAt(null)).toBeNull();
  });
});
