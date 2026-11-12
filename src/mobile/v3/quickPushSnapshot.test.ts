import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async () => undefined,
  loadAssetBytesFs: async () => null,
  removeAssetBytesFs: async () => undefined,
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
}));

import { SqlJsAsyncDb, SqlJsDb, type MobileDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { ensureV3StateTable, savePersistedV3State } from "../data/v3StateRepository.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import type { DeviceBaseline } from "../../core/s3v3DeviceStore.js";

/**
 * task-83 护栏：移动端「单条快路径合并读」必须与逐次读取逐字段一致，且真的只读一次 state 行。
 */

const ISO = "2026-01-01T00:00:00.000Z";

/** 只在 prepare 层统计 `SELECT ... FROM sync_v3_state`（合并读唯一可见指标：整行 JSON 过桥次数）。 */
function countingDb(db: MobileDb): { db: MobileDb; stateReads: () => number; reset: () => void } {
  let reads = 0;
  const wrapped = {
    prepare(sql: string) {
      if (/FROM\s+sync_v3_state/i.test(sql)) reads += 1;
      return db.prepare(sql);
    },
    transaction: db.transaction.bind(db),
    pragma: db.pragma.bind(db),
    exec: db.exec.bind(db),
    databaseSizeBytes: db.databaseSizeBytes.bind(db),
    close: db.close.bind(db),
    ...(db.executeSet ? { executeSet: db.executeSet.bind(db) } : {}),
  } as MobileDb;
  return { db: wrapped, stateReads: () => reads, reset: () => { reads = 0; } };
}

const baseline: DeviceBaseline = {
  epoch: "11111111-1111-4111-8111-111111111111",
  generation: 3,
  lakeCommit: "lake-commit",
  quickNotesCommit: "quick-commit",
  lake: {
    v: 3, space: "lake",
    notes: [{ id: "doc-1", title: "Doc", parentId: null, sortOrder: 0, updatedAt: ISO, contentHash: "doc-hash", assetsHash: "doc-asset-hash" }],
    folders: [],
  },
  quickNotes: {
    v: 3, space: "quickNotes",
    items: [
      {
        id: "q-1", createdAt: ISO, updatedAt: ISO, contentHash: "q-hash",
        tagIds: ["t1"], tagsUpdatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  },
};

/** 真实落盘形状：信封 records（cloud-deleted/restore/quick-purge）+ baseline + 两空间 assets。 */
async function seeded(): Promise<{ db: MobileDb; stateReads: () => number; reset: () => void }> {
  const raw = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(raw);
  await ensureV3StateTable(raw);
  // 小记行 + 标签关系（getQuickNoteSyncRow 联表读 tags_updated_at）
  await raw.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,content_hash,is_dirty) VALUES ('q-1',?,?,?,?,1)").run(ISO, ISO, "hello", "q-hash");
  await raw.prepare("INSERT OR REPLACE INTO tags (id,name,created_at,updated_at) VALUES ('t1','Tag',?,?)").run(ISO, ISO);
  await raw.prepare("INSERT OR REPLACE INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote','q-1','t1',0)").run();
  await raw.prepare("INSERT OR REPLACE INTO tag_link_versions (target_kind,target_id,links_updated_at) VALUES ('quickNote','q-1',?)").run("2026-01-02T00:00:00.000Z");
  // DB 投影标记（cloud_deleted / restore_pending / purged tombstone）
  await raw.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,content_hash,cloud_deleted) VALUES ('q-cd',?,?,?,?,1)").run(ISO, ISO, "cd", "cd-hash");
  await raw.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,content_hash,restore_pending_at) VALUES ('q-rp',?,?,?,?,?)").run(ISO, ISO, "rp", "rp-hash", ISO);
  await raw.prepare("INSERT INTO notes (id,title,updated_at,content_hash,cloud_deleted) VALUES ('doc-cd','CD',?,?,1)").run(ISO, "doc-cd-hash");
  await raw.prepare("INSERT INTO notes (id,title,updated_at,content_hash,restore_pending_at) VALUES ('doc-rp','RP',?,?,?)").run(ISO, "doc-rp-hash", ISO);
  await raw.prepare("INSERT INTO folders (id,title,sort_order,node_type,updated_at,cloud_deleted) VALUES ('f-cd','F',0,'notebook',?,1)").run(ISO);
  await raw.prepare("INSERT INTO quick_note_deleted (id,created_at,updated_at,deleted_at,purged_at) VALUES ('qp-1',?,?,?,?)").run(ISO, ISO, ISO, ISO);
  await savePersistedV3State(raw, {
    version: 3,
    records: [
      { kind: "cloud-deleted", id: "q-cd" },
      { kind: "cloud-deleted", id: "doc-cd" },
      { kind: "cloud-deleted", id: "f-cd" },
      { kind: "restore", noteId: "q-rp" },
      { kind: "restore", noteId: "doc-rp" },
      { kind: "quick-purge", id: "qp-1", at: ISO },
    ],
    assets: { lake: { "doc-1": "doc-asset-hash" }, quickNotes: { "q-1": "quick-envelope-asset-hash" } },
  }, baseline);
  const c = countingDb(raw);
  return { db: c.db, stateReads: c.stateReads, reset: c.reset };
}

describe("单条快路径合并读（task-83）：字段与逐次读取一致 + 只读一次 state 行", () => {
  it("合并读的 baseline/light 与 loadBaseline()+loadQuickPushState() 逐字段相等，且 state 行只读 1 次", async () => {
    const { db, stateReads } = await seeded();
    const merged = await new MobileDeviceStore(db).loadQuickPushSnapshot("q-1");
    expect(stateReads()).toBe(1);
    expect(merged.baseline).toEqual(baseline);
    // 单行 + 标签 + 资产 hash 兜底（信封 assets 优先）
    expect(merged.light?.quickNote?.id).toBe("q-1");
    expect(merged.light?.quickNote?.tagIds).toEqual(["t1"]);
    expect(merged.light?.quickNote?.tagsUpdatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(merged.light?.quickNote?.assetsHash).toBe("quick-envelope-asset-hash");
    expect(merged.light?.remotePurged?.slice().sort()).toEqual(["doc-cd", "f-cd", "q-cd"]);
    expect(merged.light?.restorePending?.slice().sort()).toEqual(["doc-rp", "q-rp"]);
    expect(merged.light?.quickPurges).toEqual(["qp-1"]);

    // 对照组（同一份落盘、独立 store 实例）：逐次读取 = loadBaseline 1 次 + loadQuickPushState 2 次
    const { db: db2, stateReads: reads2 } = await seeded();
    const store = new MobileDeviceStore(db2);
    const baselineAgain = await store.loadBaseline();
    const lightAgain = await store.loadQuickPushState("q-1");
    expect(reads2()).toBe(3);
    expect(baselineAgain).toEqual(merged.baseline);
    expect(lightAgain).toEqual(merged.light);
  });

  it("没有 state 行：合并读按空账本处理（baseline=null），与逐次读取一致", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    await ensureV3StateTable(db);
    const store = new MobileDeviceStore(db);
    const merged = await store.loadQuickPushSnapshot("q-missing");
    expect(merged.baseline).toBeNull();
    expect(merged.light).toEqual(await store.loadQuickPushState("q-missing"));
  });

  it("落盘无法识别（未知形状）：合并读把 baseline 视为 null（与 loadV3State 的 EMPTY 分支同口径）", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    await ensureV3StateTable(db);
    await db.prepare("INSERT INTO sync_v3_state (id,json) VALUES ('state','{\"foo\":1}')").run();
    const store = new MobileDeviceStore(db);
    const merged = await store.loadQuickPushSnapshot("q-missing");
    expect(merged.baseline).toBeNull();
    expect(merged.light).toEqual(await store.loadQuickPushState("q-missing"));
  });
});
