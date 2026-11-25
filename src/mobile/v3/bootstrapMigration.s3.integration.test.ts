/**
 * 便携包零基线迁移 → 真实 S3 首同步（261123 报障四步路径；设计 = docs/PORTABLE-TRANSFER.md §3.1）。
 *
 * 链路 = 移动端完整同步管线（runMobileV3Sync + sql.js 内存库 + 真实 S3 远端）：
 * 「手机导入零基线包」与修复后的 importPortable 输出**完全同构**（行数据 + 合成合并底稿基线）；
 * 「桌面端」= 同管线的另一实例（引擎共享 ⇒ 同步语义同源）。
 *
 * 门控/清理与 sync.s3.integration.test.ts 同口径：S3V3_IT=1 + S3V3_ENDPOINT/BUCKET/AK/SK（env 注入，
 * 凭据永不落仓库/日志）；唯一前缀 `<S3V3_PREFIX>/_bootstrap_mig/<uuid>`，收尾 deleteByPrefix("") 归零。
 * 不设 env 时整组跳过（CI 无凭据不跑）；「基线丢失安全闸」一组不依赖网络、常跑。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDbWeb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, listTrashed, readNote, saveNote, trashNote } from "../data/noteRepository.js";
import { deleteQuickNote, listQuickNoteTrash, readQuickNote, restoreQuickNote, saveQuickNote } from "../data/quickNotesRepository.js";
import { EMPTY_MOBILE_V3_STATE, ensureV3StateTable, loadSyncBaseline, saveV3State, SyncBaselineLostError } from "../data/v3StateRepository.js";
import { setBaselineFileForDbForTest } from "../data/v3BaselineFile.js";
import { setBodyStoreBackendForTest, type BodyStoreBackend } from "../native/bodyStore.js";
import { buildBootstrapBaseline } from "../../core/portable/bootstrapBaseline.js";
import type { LakeNoteEntry, QuickNoteEntry } from "../../core/s3v3/protocol/s3v3Index.js";
import { runMobileV3Sync } from "./sync.js";
import { createS3v3RemoteWithClient } from "./s3v3Remote.js";

type Row = Record<string, unknown>;

/** 从活库读行 → 合并底稿基线（与 importPortable.readBootstrapRowsFromDb 同构；content_hash 取行内现值）。 */
async function bootstrapBaseFromDb(db: SqlJsAsyncDb): Promise<ReturnType<typeof buildBootstrapBaseline>> {
  const all = async (sql: string): Promise<Row[]> => (await db.prepare(sql).all()) as unknown as Row[];
  const notes: LakeNoteEntry[] = (await all("SELECT id,title,parent_id,sort_order,updated_at,content_hash,is_conflict,is_locked,locked_at,doc_kind,trashed_at,deleted_from_parent_id FROM notes WHERE is_purged=0")).map((r) => ({
    id: String(r.id), title: String(r.title ?? "未命名"), parentId: (r.parent_id as string | null) ?? null, sortOrder: Number(r.sort_order) || 0,
    updatedAt: String(r.updated_at ?? ""), contentHash: String(r.content_hash ?? ""), kind: String(r.doc_kind ?? "doc"),
    isLocked: r.is_locked === 1, lockedAt: (r.locked_at as string | null) ?? null, isConflict: r.is_conflict === 1,
    trashedAt: (r.trashed_at as string | null) ?? null, deletedFromParentId: (r.deleted_from_parent_id as string | null) ?? null,
  }));
  const quickItems: QuickNoteEntry[] = (await all("SELECT id,created_at,updated_at,content_hash,is_conflict,tags_updated_at FROM quick_notes")).map((r) => ({
    id: String(r.id), createdAt: String(r.created_at ?? ""), updatedAt: String(r.updated_at ?? ""), contentHash: String(r.content_hash ?? ""),
    isConflict: r.is_conflict === 1, ...(r.tags_updated_at ? { tagsUpdatedAt: String(r.tags_updated_at) } : {}),
  }));
  return buildBootstrapBaseline({ notes, folders: [], quickItems, quickTags: [], quickPurged: [] });
}

/** 「零基线包导入后的手机」= 包内容行 + 合成合并底稿基线（修复后的 importPortable 输出同构）。 */
async function seedImportedPhone(baselinePath: string): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  setBaselineFileForDbForTest(db, baselinePath);
  await createNote(db, "n1", "不变", "doc-unchanged", null, new Map());
  await createNote(db, "n2", "桌面后来删了", "doc-deleted-later", null, new Map());
  await createNote(db, "n3", "手机端点收", "doc-keep", null, new Map());
  await saveQuickNote(db, "q1", "qn-keep", []);
  await saveQuickNote(db, "q2", "qn-deleted-later", []);
  await ensureV3StateTable(db);
  // ⚠️ saveV3State 的第 4 参必须显式传绑定路径：不传会写/删**默认**路径，绑定路径下读回必「lost」。
  await saveV3State(db, { ...EMPTY_MOBILE_V3_STATE, baseline: await bootstrapBaseFromDb(db) }, undefined, baselinePath);
  return db;
}

/**
 * 独立 BodyStore 后端（既有先例：conformance harness 同款）——全局 testSetup 的 beforeEach 会
 * `resetMemoryBodyStore()` 清共享内存映射，跨用例存活的基线文件必须放自己的 Map（261123 实测踩坑）。
 */
function makeIsolatedBodyStore(): BodyStoreBackend {
  const map = new Map<string, string>();
  return {
    async readText(path) { return map.get(path) ?? null; },
    async writeText(path, text) { map.set(path, text); return text.length; },
    async remove(path) { map.delete(path); },
    async stat(path) { return { exists: map.has(path), size: (map.get(path) ?? "").length }; },
    async readSnapshot(path) { return map.get(path) ?? null; },
    async writeSnapshot(path, text) { map.set(path, text); return text.length; },
  };
}

describe("基线丢失安全闸（261123 复现锚点，不依赖网络）", () => {
  it("旧导入状态（有信封、无基线文件）⇒ SyncBaselineLostError 安全中止语义不变", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    setBaselineFileForDbForTest(db, "sync-v3/test-lost-" + randomUUID() + ".json.gz.b64");
    await ensureV3StateTable(db);
    // 旧版零基线导入正是落成这个状态（= 用户 261123 看到的报错现场）。
    await saveV3State(db, { ...EMPTY_MOBILE_V3_STATE, baseline: null });
    await expect(loadSyncBaseline(db)).rejects.toBeInstanceOf(SyncBaselineLostError);
    await db.close();
  });

  it("合成合并底稿基线 ⇒ loadSyncBaseline 正常返回（报障消除）", async () => {
    const db = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(db);
    const bound = "sync-v3/test-boot-" + randomUUID() + ".json.gz.b64";
    setBaselineFileForDbForTest(db, bound);
    await createNote(db, "n1", "D", "hello", null, new Map());
    await ensureV3StateTable(db);
    await saveV3State(db, { ...EMPTY_MOBILE_V3_STATE, baseline: await bootstrapBaseFromDb(db) }, undefined, bound);
    const loaded = await loadSyncBaseline(db, bound);
    expect(loaded?.bootstrap).toBe(true);
    await db.close();
  });
});

const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;

describeIt("零基线迁移 → 真实 S3 首同步（四步路径 261123）", () => {
  let prefix = "";
  let client: S3Client;
  let syncOpts: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string };
  let phone: SqlJsAsyncDb;   // 手机（导入零基线包）
  let desk: SqlJsAsyncDb;    // 桌面侧（同管线另一实例：导出源 → 配 S3 改动上行）

  beforeAll(async () => {
    setBodyStoreBackendForTest(makeIsolatedBodyStore()); // 隔离基线文件，防全局 beforeEach 清共享内存映射
    prefix = (process.env.S3V3_PREFIX || "lakex-notes-dev3") + "/_bootstrap_mig/" + randomUUID();
    client = new S3Client({ region: process.env.S3V3_REGION || "cn-north-1", endpoint: process.env.S3V3_ENDPOINT!, credentials: { accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK! }, forcePathStyle: false });
    syncOpts = { endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix };
    // 桌面 = 导出时刻世界的同一份内容（包的来源）。
    desk = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(desk);
    setBaselineFileForDbForTest(desk, "sync-v3/desk-" + randomUUID() + ".json.gz.b64");
    await createNote(desk, "n1", "不变", "doc-unchanged", null, new Map());
    await createNote(desk, "n2", "桌面后来删了", "doc-deleted-later", null, new Map());
    await createNote(desk, "n3", "手机端点收", "doc-keep", null, new Map());
    await saveQuickNote(desk, "q1", "qn-keep", []);
    await saveQuickNote(desk, "q2", "qn-deleted-later", []);
    phone = await seedImportedPhone("sync-v3/phone-" + randomUUID() + ".json.gz.b64");
  });

  afterAll(async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    await remote.deleteByPrefix("").catch(() => {});
    setBodyStoreBackendForTest(null);
    await phone?.close();
    await desk?.close();
  });

  it("① 桌面配 S3 并改/删上行；② 手机首同步：不报错、增量、不误删；③ 第二轮幂等", async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    // 手机在导入后又新增了一条小记（旧实现拉全轮会把它物理丢弃——安全不变量核心）。
    await saveQuickNote(phone, "q3", "qn-new-on-phone", []);

    // 步骤3（桌面）：改 n1、删 n2、（n3/q1/q2 不动），配置 S3 首次上行。
    await saveNote(desk, "n1", "不变", "doc-v2", null, new Map());
    await trashNote(desk, "n2");
    const deskRound = await runMobileV3Sync(desk, syncOpts, { remote, deviceId: "desk", emptyCloud: "upload" });
    expect(deskRound.published).toBe(true);

    // 步骤4（手机）：配置同一 S3 立即同步。
    const before = await readQuickNote(phone, "q3");
    expect(before?.content.text).toBe("qn-new-on-phone");
    // 成功 = 不抛错；旧实现这里抛 SyncBaselineLostError（「基线文件损坏或丢失」）。
    const round = await runMobileV3Sync(phone, syncOpts, { remote, deviceId: "phone" });
    expect(round.warnings ?? []).toEqual([]);
    // 增量：改过的下载、未改不重传。
    expect((await readNote(phone, "n1"))?.content).toBe("doc-v2");
    expect((await readNote(phone, "n3"))?.content).toBe("doc-keep");
    // 删除传播：n2 进回收站（可恢复、正文保留），不误删（readNote 对回收站行仍可读——正文不丢）。
    expect((await listTrashed(phone)).some((n) => n.id === "n2")).toBe(true);
    expect((await readNote(phone, "n2"))?.content).toBe("doc-deleted-later");
    // 本地新增小记存活并上传（不被丢弃）。
    expect((await readQuickNote(phone, "q3"))?.content.text).toBe("qn-new-on-phone");
    await runMobileV3Sync(desk, syncOpts, { remote, deviceId: "desk" });
    expect((await readQuickNote(desk, "q3"))?.content.text).toBe("qn-new-on-phone");

    // ③ 幂等：手机第二轮零动作（基线已推进，不重复下载/上传）。
    const round2 = await runMobileV3Sync(phone, syncOpts, { remote, deviceId: "phone" });
    expect(round2.published ?? false).toBe(false);
    expect(round2.downloadedNotes ?? 0).toBe(0);
    expect(round2.uploadedNotes ?? 0).toBe(0);
  }, 180_000);

  it("删除传播 + 恢复例外：桌面删 q1 → 手机进小记回收站；手机恢复 → 重新上行", async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    await deleteQuickNote(desk, "q1");
    await runMobileV3Sync(desk, syncOpts, { remote, deviceId: "desk" });
    await runMobileV3Sync(phone, syncOpts, { remote, deviceId: "phone" });
    expect((await listQuickNoteTrash(phone)).some((q) => q.id === "q1")).toBe(true);
    // 恢复是唯一显式例外：恢复后重新上传、对端拉回。
    await restoreQuickNote(phone, "q1");
    const restored = await runMobileV3Sync(phone, syncOpts, { remote, deviceId: "phone" });
    expect(restored.published ?? false).toBe(true);
    await runMobileV3Sync(desk, syncOpts, { remote, deviceId: "desk" });
    expect((await listQuickNoteTrash(desk)).some((q) => q.id === "q1")).toBe(false);
  }, 180_000);

  it("二次迁移幂等：重导同包（重建导入态）后首同步收敛、不误删", async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    // 另一台「刚重导过同一零基线包」的手机（已中招设备重导 = 修复路径）。
    const phone2 = await seedImportedPhone("sync-v3/phone2-" + randomUUID() + ".json.gz.b64");
    try {
      const dbg = await runMobileV3Sync(phone2, syncOpts, { remote, deviceId: "phone2" });
      const dbgBase = await (await import("../data/v3StateRepository.js")).loadSyncBaseline(phone2, (await import("../data/v3BaselineFile.js")).baselineFileForDb(phone2) ?? undefined).catch((err) => ({ error: String(err) }));
      // 成功 = 不抛错；与云端收敛：n1=桌面改后的 v2；n2 在回收站（删除传播）；n3 保留；q3 同步回来。
      expect((await readNote(phone2, "n1"))?.content, "round=" + JSON.stringify({ p: dbg.published, d: dbg.downloadedNotes, u: dbg.uploadedNotes, w: dbg.warnings, base: (dbgBase as { bootstrap?: boolean }).bootstrap ?? (dbgBase as { error?: string }).error })).toBe("doc-v2");
      expect((await listTrashed(phone2)).some((n) => n.id === "n2")).toBe(true);
      expect((await readNote(phone2, "n3"))?.content).toBe("doc-keep");
      expect((await readQuickNote(phone2, "q3"))?.content.text).toBe("qn-new-on-phone");
      const round2 = await runMobileV3Sync(phone2, syncOpts, { remote, deviceId: "phone2" });
      expect(round2.published ?? false).toBe(false);
    } finally {
      await phone2.close();
    }
  }, 180_000);
});
