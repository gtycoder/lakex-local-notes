import { describe, expect, it } from "vitest";
import path from "node:path";
import { vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { EMPTY_MOBILE_V3_STATE, ensureV3StateTable, loadV3State, saveV3State, type MobileV3State } from "./v3StateRepository.js";

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

  it("损坏 JSON 返回空账本，不抛错", async () => {
    const db = await freshDb();
    await db.prepare("INSERT INTO sync_v3_state (id, json) VALUES ('state', ?)").run("{bad");
    expect(await loadV3State(db)).toEqual(EMPTY_MOBILE_V3_STATE);
    await db.close();
  });
});
