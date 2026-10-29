import { describe, expect, it } from "vitest";
import path from "node:path";
import { vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { EMPTY_MOBILE_V3_STATE, clearV3State, ensureV3StateTable, loadV3State, saveV3State, type MobileV3State } from "./v3StateRepository.js";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  await ensureV3StateTable(db);
  return db;
}

describe("移动端 v3 同步账本", () => {
  it("默认为空账本；保存后可读回 baseline/intents/pending/assetsHash", async () => {
    const db = await freshDb();
    expect(await loadV3State(db)).toEqual(EMPTY_MOBILE_V3_STATE);
    const state: MobileV3State = {
      baseline: { epoch: "e1", generation: 3, lakeCommit: "a".repeat(64), quickNotesCommit: "b".repeat(64), lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] } },
      intents: [{ noteId: "n1", targetEpoch: "e1", targetGeneration: 2, purgedAt: "2026-10-25T00:00:00.000Z" }],
      pending: [{ kind: "body", key: "objects/n1-" + "a".repeat(64) + ".lake", noteId: "n1", oldHash: "a".repeat(64), targetEpoch: "e1", targetGeneration: 2, targetCommit: "c".repeat(64), createdAt: "2026-10-25T00:00:00.000Z" }],
      remotePurged: ["n2"], restorePending: ["n3"], assetsHash: { n1: "d".repeat(64) }, quickPurgeTimes: { n4: "2026-10-25T00:00:00.000Z" },
      // 261027：待补资产账本也要能原样往返（跨重启自动重试依赖它）。
      pendingAssets: [{ space: "lake", id: "n1", filename: "a.png", size: 3, hash: "e".repeat(64), attempts: 1 }],
    };
    await saveV3State(db, state);
    expect(await loadV3State(db)).toEqual(state);
    await db.close();
  });

  it("clearV3State：清空同步账本（从云端恢复的前置），之后读回 EMPTY", async () => {
    const db = await freshDb();
    await saveV3State(db, { ...EMPTY_MOBILE_V3_STATE, remotePurged: ["n2"], restorePending: ["n3"], assetsHash: { n1: "d".repeat(64) } });
    expect(await loadV3State(db)).not.toEqual(EMPTY_MOBILE_V3_STATE);

    await clearV3State(db);

    expect(await loadV3State(db)).toEqual(EMPTY_MOBILE_V3_STATE);
    await db.close();
  });

  it("clearV3State 自带建表 / 幂等（未建过账本表、重复清空都不抛）", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    await expect(clearV3State(db)).resolves.toBeUndefined();
    await expect(clearV3State(db)).resolves.toBeUndefined();
    expect(await loadV3State(db)).toEqual(EMPTY_MOBILE_V3_STATE);
    await db.close();
  });

  it("落盘 = v3 类型化 records + baseline 同 JSON（旧 9 组字段不再是持久化形状）", async () => {
    const db = await freshDb();
    await saveV3State(db, {
      ...EMPTY_MOBILE_V3_STATE,
      baseline: { epoch: "e1", generation: 3, lakeCommit: "a".repeat(64), quickNotesCommit: "b".repeat(64), lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] } },
      remotePurged: ["n2"], restorePending: ["n3"], assetsHash: { n1: "d".repeat(64) },
    });
    const row = await db.prepare("SELECT json FROM sync_v3_state WHERE id='state'").get() as { json: string };
    const raw = JSON.parse(row.json) as Record<string, unknown> & {
      version?: number; baseline?: { epoch?: string }; records?: Array<{ kind: string; id?: string; noteId?: string }>;
      assets?: { lake?: Record<string, string> };
    };
    expect(raw.version).toBe(3);
    expect(raw.baseline?.epoch).toBe("e1"); // baseline 不动：仍随本行持久化
    expect(raw).not.toHaveProperty("remotePurged");
    expect(raw).not.toHaveProperty("restorePending");
    expect(raw).not.toHaveProperty("assetsHash");
    expect(raw.records?.filter((r) => r.kind === "cloud-deleted").map((r) => r.id)).toEqual(["n2"]);
    expect(raw.records?.filter((r) => r.kind === "restore").map((r) => r.noteId)).toEqual(["n3"]);
    expect(raw.assets?.lake).toEqual({ n1: "d".repeat(64) });
    await db.close();
  });

  it("旧格式（无 version 的 MobileV3State JSON）加载时迁移，下一次保存写成 v3 信封", async () => {
    const db = await freshDb();
    const legacy = {
      baseline: { epoch: "e1", generation: 3, lakeCommit: "a".repeat(64), quickNotesCommit: "b".repeat(64), lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] } },
      intents: [], pending: [], remotePurged: ["n2"], restorePending: ["n3"],
      assetsHash: { n1: "d".repeat(64) }, quickPurgeTimes: { q1: "2026-10-03T00:00:00.000Z" }, pendingAssets: [],
    };
    await db.prepare("INSERT INTO sync_v3_state (id, json) VALUES ('state', ?)").run(JSON.stringify(legacy));
    const loaded = await loadV3State(db);
    expect(loaded.baseline?.epoch).toBe("e1");
    expect(loaded.remotePurged).toEqual(["n2"]);
    expect(loaded.restorePending).toEqual(["n3"]);
    expect(loaded.assetsHash).toEqual({ n1: "d".repeat(64) });
    expect(loaded.quickPurgeTimes).toEqual({ q1: "2026-10-03T00:00:00.000Z" });

    await saveV3State(db, loaded);
    const row = await db.prepare("SELECT json FROM sync_v3_state WHERE id='state'").get() as { json: string };
    expect((JSON.parse(row.json) as { version?: number }).version).toBe(3);
    await db.close();
  });

  it("v2 信封按空间分开的资产投影：加载时合并回内存视图（合并 Map 形状不变）", async () => {
    const db = await freshDb();
    await db.prepare("INSERT INTO sync_v3_state (id, json) VALUES ('state', ?)").run(JSON.stringify({
      version: 2,
      intents: [], pending: [],
      quick: { deletes: [], purges: [], purgeTimes: {} },
      restore: { pending: [] }, cloudDeleted: { ids: [] },
      recovery: { bodyPending: [], assetRetries: [] },
      assets: { lake: { n1: "a".repeat(64) }, quickNotes: { q1: "b".repeat(64) } },
      baseline: null,
    }));
    expect((await loadV3State(db)).assetsHash).toEqual({ n1: "a".repeat(64), q1: "b".repeat(64) });
    await db.close();
  });

  it("损坏 JSON 返回空账本，不抛错", async () => {
    const db = await freshDb();
    await db.prepare("INSERT INTO sync_v3_state (id, json) VALUES ('state', ?)").run("{bad");
    expect(await loadV3State(db)).toEqual(EMPTY_MOBILE_V3_STATE);
    await db.close();
  });
});
