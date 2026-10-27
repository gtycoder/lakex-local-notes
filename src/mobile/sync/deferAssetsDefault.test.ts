import { beforeEach, describe, expect, it } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { saveV3State, ensureV3StateTable, EMPTY_MOBILE_V3_STATE, type MobileV3State } from "../data/v3StateRepository.js";
import { SYNC_STORAGE_KEY } from "../bridge/context.js";
import { isFreshDeviceState, resolveDeferAssets } from "./deferAssetsDefault.js";

/** 最小 localStorage 桩（node 环境没有 DOM）：只实现本模块用到的 get/set/remove。 */
function stubLocalStorage(): { data: Map<string, string> } {
  const data = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => { data.clear(); },
    key: () => null,
    get length() { return data.size; },
  } as unknown as Storage;
  return { data };
}

async function freshDb(initV3Table = true): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  if (initV3Table) await ensureV3StateTable(db);
  return db;
}

function withBaseline(): MobileV3State {
  return {
    ...EMPTY_MOBILE_V3_STATE,
    baseline: { epoch: "e1", generation: 3, lakeCommit: "c1", quickNotesCommit: "q1", lake: { notes: [], folders: [] } as never, quickNotes: { items: [], tags: [], deletes: [], purges: [] } as never },
    assetsHash: {},
  };
}

describe("按需下载附件默认值（261027 新设备默认开）", () => {
  let storage: { data: Map<string, string> };
  beforeEach(() => { storage = stubLocalStorage(); });

  it("账本判定：空账本 = 新设备；有 baseline 或资产哈希 = 老设备", () => {
    expect(isFreshDeviceState(EMPTY_MOBILE_V3_STATE)).toBe(true);
    expect(isFreshDeviceState({ baseline: withBaseline().baseline, assetsHash: {} })).toBe(false);
    expect(isFreshDeviceState({ baseline: null, assetsHash: { n1: "h1" } })).toBe(false);
  });

  it("全新库连 v3 账本表都还没建（真机新装路径）⇒ 也要能判定，不抛 no such table", async () => {
    const db = await freshDb(false);
    try {
      expect(await resolveDeferAssets(db)).toEqual({ deferAssets: true, defaulted: true });
    } finally { await db.close(); }
  });

  it("未存过设置 + 全新设备 ⇒ 默认开（defaulted=true，调用方固化）", async () => {
    const db = await freshDb();
    try {
      expect(await resolveDeferAssets(db)).toEqual({ deferAssets: true, defaulted: true });
    } finally { await db.close(); }
  });

  it("未存过设置 + 已同步过（baseline / 资产哈希）⇒ 维持全量，老用户行为不变", async () => {
    const db = await freshDb();
    try {
      await saveV3State(db, withBaseline());
      expect(await resolveDeferAssets(db)).toEqual({ deferAssets: false, defaulted: false });
      await saveV3State(db, { ...EMPTY_MOBILE_V3_STATE, assetsHash: { n1: "h1" } });
      expect(await resolveDeferAssets(db)).toEqual({ deferAssets: false, defaulted: false });
    } finally { await db.close(); }
  });

  it("存过设置 ⇒ 一律以用户值为准（不默认、不迁移）", async () => {
    const db = await freshDb();
    try {
      storage.data.set(SYNC_STORAGE_KEY, JSON.stringify({ enabled: true, autoMode: "manual", autoIntervalMinutes: 15, deferAssets: true }));
      expect(await resolveDeferAssets(db)).toEqual({ deferAssets: true, defaulted: false });

      storage.data.set(SYNC_STORAGE_KEY, JSON.stringify({ enabled: true, autoMode: "manual", autoIntervalMinutes: 15, deferAssets: false }));
      expect(await resolveDeferAssets(db)).toEqual({ deferAssets: false, defaulted: false });

      // 存过但没写 deferAssets（老版本存的设置）⇒ 视为用户没开过，保持 false
      storage.data.set(SYNC_STORAGE_KEY, JSON.stringify({ enabled: true, autoMode: "manual", autoIntervalMinutes: 15 }));
      expect(await resolveDeferAssets(db)).toEqual({ deferAssets: false, defaulted: false });
    } finally { await db.close(); }
  });
});
