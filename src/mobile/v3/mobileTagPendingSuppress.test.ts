/**
 * 本机待删（device_state `tag_deleted`）→ 核心 plan 的**抑制**闭环（移动端边界护栏）。
 * 场景：本机已删标签、远端索引还带着它（他端尚未同步到删除）⇒
 * ① 目录合并不得把它复活；② 本轮必须发布一次「它缺席」；③ 远端仍带着 ⇒ 不结算抑制记录。
 * 移动端职责 = 从这个 key 读出 pending 交给核心（不自己判删除语义）。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => {}, loadAssetBytesFs: async () => null, removeAssetBytesFs: async () => {},
  listNoteAssetKeysFs: async () => [], listQuickNoteAssetKeysFs: async () => [], listAssetKeysFs: async () => [],
  removeNoteAssetsDirFs: async () => {}, removeQuickNoteAssetsDirFs: async () => {},
}));
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { PENDING_TAG_DELETES_KEY } from "../data/quickNoteTagsRepository.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { planSync } from "../../core/s3v3/plan/plan.js";
import type { PlanWorld } from "../../core/s3v3/plan/plan.js";

const TAG_ID = "t_0000000000000001";
const T1 = "2026-11-01T00:00:00.000Z";

async function freshDevice() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  const store = new MobileDeviceStore(db);
  await store.init();
  return { db, store };
}

const tagEntry = { id: TAG_ID, name: "工作", createdAt: T1, updatedAt: T1 };

function world(tags: typeof tagEntry[]): PlanWorld {
  return {
    lake: { v: 3, space: "lake", notes: [], folders: [] },
    quickNotes: { v: 3, space: "quickNotes", items: [], tags },
    folders: [],
  };
}

describe("本机待删标签抑制远端重发（移动端 → 核心 plan）", () => {
  it("远端还带着已删标签：不复活、必须发布缺席、暂不结算", async () => {
    const { db, store } = await freshDevice();
    try {
      await db.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(PENDING_TAG_DELETES_KEY, JSON.stringify([TAG_ID]));
      const state = await store.loadState();
      expect(state?.pendingTagDeletes).toEqual([TAG_ID]);

      const plan = planSync({
        local: world([]),
        base: world([tagEntry]),
        remote: world([tagEntry]),
        state: { restorePending: [], purgeIntents: [], folderPurgeIntents: [], pendingTagDeletes: state?.pendingTagDeletes },
      });
      // ① 不复活
      expect(plan.quickTags).toEqual([]);
      // ② 远端或基线还带着 ⇒ 必须发布一次把缺席写出去
      expect(plan.publish?.quickNotes.tags).toEqual([]);
      // ③ 远端仍带着 ⇒ 不是「已确认缺席」，抑制记录保留
      expect(plan.quickTagSettled).toEqual([]);
    } finally { await db.close(); }
  });

  it("远端已缺席：可结算抑制记录（下一轮 saveState 清 pending）", async () => {
    const { db, store } = await freshDevice();
    try {
      await db.prepare("INSERT INTO device_state(key,value) VALUES(?,?)").run(PENDING_TAG_DELETES_KEY, JSON.stringify([TAG_ID]));
      const state = await store.loadState();
      const plan = planSync({
        local: world([]),
        base: world([tagEntry]),
        remote: world([]),
        state: { restorePending: [], purgeIntents: [], folderPurgeIntents: [], pendingTagDeletes: state?.pendingTagDeletes },
      });
      expect(plan.quickTagSettled).toEqual([TAG_ID]);
      expect(plan.quickTags).toEqual([]);
    } finally { await db.close(); }
  });
});
