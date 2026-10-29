import { afterEach, describe, expect, it, vi } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import {
  HISTORY_CLEANUP_LS_KEY,
  markHistoryCleanupAt,
  readLastHistoryCleanupAt,
  runScheduledHistoryCleanup,
  shouldRunHistoryCleanup,
} from "./historyCleanupScheduler.js";

const HOUR = 3600 * 1000;

function stubLocalStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  });
  return data;
}

const settings = (cleanupIntervalHours: number) => ({ maxSnapshots: 100, retentionDays: 30, cleanupIntervalHours, snapshotIntervalMinutes: 15 });

describe("历史快照定期清理调度（MOB-09）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("按间隔判到期：0=关闭、从未清理=到期、未到间隔不跑", () => {
    const now = Date.parse("2026-10-28T12:00:00.000Z");
    expect(shouldRunHistoryCleanup({ now, lastAt: null, intervalHours: 24 })).toBe(true);
    expect(shouldRunHistoryCleanup({ now, lastAt: now - 23 * HOUR, intervalHours: 24 })).toBe(false);
    expect(shouldRunHistoryCleanup({ now, lastAt: now - 24 * HOUR, intervalHours: 24 })).toBe(true);
    expect(shouldRunHistoryCleanup({ now, lastAt: null, intervalHours: 0 })).toBe(false);
  });

  it("到期跑一次并记时间；下一个间隔内不再跑（不是每次启动都清）", async () => {
    stubLocalStorage();
    const now = Date.parse("2026-10-28T12:00:00.000Z");
    const cleanup = vi.fn(async () => ({ deleted: 3 }));
    const deps = {
      readSettings: async () => settings(24),
      cleanup,
      db: async () => null,
      now,
    };
    await expect(runScheduledHistoryCleanup(deps)).resolves.toEqual({ ran: true, deleted: 3 });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(HISTORY_CLEANUP_LS_KEY)).toBe(new Date(now).toISOString());

    await expect(runScheduledHistoryCleanup({ ...deps, now: now + HOUR })).resolves.toEqual({ ran: false, deleted: 0 });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("关闭自动清理（interval=0）时不读库、不清理；上次时间落 device_state", async () => {
    stubLocalStorage();
    const cleanup = vi.fn(async () => ({ deleted: 0 }));
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    await expect(runScheduledHistoryCleanup({
      readSettings: async () => settings(0),
      cleanup,
      db: async () => db,
    })).resolves.toEqual({ ran: false, deleted: 0 });
    expect(cleanup).not.toHaveBeenCalled();

    const at = new Date("2026-10-27T00:00:00.000Z");
    await markHistoryCleanupAt(db, at);
    expect(await readLastHistoryCleanupAt(db)).toBe(at.getTime());
    const row = await db.prepare("SELECT value FROM device_state WHERE key='history_cleanup_at'").get() as { value?: string } | undefined;
    expect(row?.value).toBe(at.toISOString());
    // db 传 null 时退化为 localStorage，不抛错
    await expect(readLastHistoryCleanupAt(null)).resolves.toBe(at.getTime());
  });
});
