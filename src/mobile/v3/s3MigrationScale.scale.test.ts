
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { S3Client } from "@aws-sdk/client-s3";
import { SqlJsAsyncDb, SqlJsDb } from "../data/sqliteDbWeb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNote, listTrashed, readNote, saveNote, trashNote } from "../data/noteRepository.js";
import { readQuickNote, saveQuickNote } from "../data/quickNotesRepository.js";
import { EMPTY_MOBILE_V3_STATE, ensureV3StateTable, saveV3State } from "../data/v3StateRepository.js";
import { setBaselineFileForDbForTest } from "../data/v3BaselineFile.js";
import { setBodyStoreBackendForTest, type BodyStoreBackend } from "../native/bodyStore.js";
import { buildBootstrapBaseline } from "../../core/portable/bootstrapBaseline.js";
import type { LakeNoteEntry, QuickNoteEntry } from "../../core/s3v3/protocol/s3v3Index.js";
import { runMobileV3Sync } from "./sync.js";
import { createS3v3RemoteWithClient } from "./s3v3Remote.js";

/**
 * 真桶百级压测档（261123 lead 点单；可选档）：迁移后同步在**真实七牛桶**上的百级对象规模，
 * 验证资产声明差集 / 并发传输在规模下正确。不做到千级对象（成本与配额）。
 * 门控：LLN_SCALE=1 + S3V3_IT=1 + S3V3_ENDPOINT/BUCKET/AK/SK（env 注入，凭据永不落仓库/日志/报告）。
 * 唯一子前缀 `<S3V3_PREFIX>/_scale_<uuid>`（默认 lakex-notes-dev3/_scale_…），afterAll deleteByPrefix 归零。
 * 跑法示例：
 *   LLN_SCALE=1 S3V3_IT=1 S3V3_ENDPOINT=… S3V3_BUCKET=… S3V3_AK=… S3V3_SK=… \
 *     npx vitest run src/mobile/v3/s3MigrationScale.scale.test.ts
 */

const memMb = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
const report = (tag: string, data: Record<string, unknown>): void => {
  console.log("SCALE-REPORT " + JSON.stringify({ tag, ...data }));
};

type Row = Record<string, unknown>;

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

const NOTES = 60;
const QUICK = 40;
const ASSETS_PER_NOTE = 1;
const CHANGED = 10;
const TRASHED = 5;
const PHONE_NEW_NOTES = 10;
const PHONE_NEW_QUICK = 20;

const noteId = (i: number) => "n" + String(i).padStart(4, "0");
const quickId = (i: number) => "q" + String(i).padStart(4, "0");
const assetOf = (i: number) => new Map([["f0.png", new Uint8Array([i % 256, 2, 3, 4])]]);

const enabled = process.env.LLN_SCALE === "1" && process.env.S3V3_IT === "1"
  && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const describeIt = enabled ? describe : describe.skip;

describeIt("真桶百级压测：迁后同步（声明差集 / 并发传输）", () => {
  let prefix = "";
  let client: S3Client;
  let syncOpts: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; prefix: string };
  let phone: SqlJsAsyncDb;
  let desk: SqlJsAsyncDb;

  beforeAll(async () => {
    setBodyStoreBackendForTest(makeIsolatedBodyStore());
    prefix = (process.env.S3V3_PREFIX || "lakex-notes-dev3") + "/_scale_" + randomUUID();
    client = new S3Client({ region: process.env.S3V3_REGION || "cn-north-1", endpoint: process.env.S3V3_ENDPOINT!, credentials: { accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK! }, forcePathStyle: false });
    syncOpts = { endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix };
    // 桌面 = 导出时刻世界（60 文档×1 资产 + 40 小记）。
    desk = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(desk);
    setBaselineFileForDbForTest(desk, "sync-v3/desk-" + randomUUID() + ".json.gz.b64");
    for (let i = 0; i < NOTES; i++) await createNote(desk, noteId(i), "Doc " + i, "body-" + noteId(i), null, assetOf(i));
    for (let i = 0; i < QUICK; i++) await saveQuickNote(desk, quickId(i), "qn-" + quickId(i), []);
    // 手机 = 导入同世界（含资产）+ 合并底稿 + 导入后本地新增。
    phone = new SqlJsAsyncDb(await SqlJsDb.open());
    await applyMobileSchema(phone);
    const phoneBaseline = "sync-v3/phone-" + randomUUID() + ".json.gz.b64";
    setBaselineFileForDbForTest(phone, phoneBaseline);
    for (let i = 0; i < NOTES; i++) await createNote(phone, noteId(i), "Doc " + i, "body-" + noteId(i), null, assetOf(i));
    for (let i = 0; i < QUICK; i++) await saveQuickNote(phone, quickId(i), "qn-" + quickId(i), []);
    await ensureV3StateTable(phone);
    // ⚠️ 合并底稿必须在「导入后新增」之前合成（= 真实时序：包内容→合成底稿→用户后续新增）；
    // 若把新增算进底稿，会按「导出时已有、云端缺席」走删除压编辑（实测踩过，别再犯）。
    await saveV3State(phone, { ...EMPTY_MOBILE_V3_STATE, baseline: await bootstrapBaseFromDb(phone) }, undefined, phoneBaseline);
    for (let i = 0; i < PHONE_NEW_NOTES; i++) await createNote(phone, "pn" + String(i).padStart(3, "0"), "手机新" + i, "phone-new-" + i, null, new Map([["p.png", new Uint8Array([9, 9])]]));
    for (let i = 0; i < PHONE_NEW_QUICK; i++) await saveQuickNote(phone, "pq" + String(i).padStart(3, "0"), "pq-body-" + i, []);
  }, 120_000);

  afterAll(async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    const removed = await remote.deleteByPrefix("").catch(() => -1);
    const residual = await remote.list("").then((l) => l.length).catch(() => -1);
    report("s3-scale-cleanup", { removed, residual });
    expect(residual).toBe(0);
    setBodyStoreBackendForTest(null);
    await phone?.close();
    await desk?.close();
  });

  it("百级对象：desk 首传 → phone 增量首同步 → 二轮零动作；声明差集正确", async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, prefix);
    const heap0 = memMb();

    // 步骤3（桌面）：改 CHANGED 篇、删 TRASHED 篇，配置 S3 首次上行（百级对象：正文+资产+声明+索引）。
    for (let i = 0; i < CHANGED; i++) await saveNote(desk, noteId(i), "Doc " + i, "body-" + noteId(i) + "-v2", null, assetOf(i));
    for (let i = CHANGED; i < CHANGED + TRASHED; i++) await trashNote(desk, noteId(i));
    const t0 = performance.now();
    const deskRound = await runMobileV3Sync(desk, syncOpts, { remote, deviceId: "desk", emptyCloud: "upload" });
    const deskMs = performance.now() - t0;
    expect(deskRound.published).toBe(true);

    // 步骤4（手机）：同 S3 首同步——不报错、增量、不误删、本地新增上传。
    const t1 = performance.now();
    const round = await runMobileV3Sync(phone, syncOpts, { remote, deviceId: "phone" });
    const phoneMs = performance.now() - t1;
    expect(round.warnings ?? []).toEqual([]);
    // 增量：改过的下载、未改零重传（下载数 = 改的 CHANGED 篇）
    expect(round.downloadedNotes ?? 0).toBe(CHANGED);
    expect((await readNote(phone, noteId(0)))?.content).toBe("body-" + noteId(0) + "-v2");
    expect((await readNote(phone, noteId(CHANGED + TRASHED + 1)))?.content).toBe("body-" + noteId(CHANGED + TRASHED + 1));
    // 删除传播：进回收站（可恢复、正文保留）
    expect((await listTrashed(phone)).some((n) => n.id === noteId(CHANGED))).toBe(true);
    expect((await readNote(phone, noteId(CHANGED)))?.content).toBe("body-" + noteId(CHANGED));
    // 本地新增存活并上传（以「对面拉得到」为证据；uploadedNotes 计数口径与引擎报告不同，只做测量上报）
    expect((await readQuickNote(phone, "pq000"))?.content.text).toBe("pq-body-0");
    await runMobileV3Sync(desk, syncOpts, { remote, deviceId: "desk" });
    expect((await readQuickNote(desk, "pq000"))?.content.text).toBe("pq-body-0");
    expect((await readNote(desk, "pn000"))?.content).toBe("phone-new-0");

    // 对象规模（百级、不上千）
    const objects = await remote.list("");
    expect(objects.length).toBeGreaterThan(100);
    expect(objects.length).toBeLessThan(1000);

    // 二轮零动作（基线已推进；资产声明差集 ⇒ 无重复传输）
    const t2 = performance.now();
    const round2 = await runMobileV3Sync(phone, syncOpts, { remote, deviceId: "phone" });
    const phone2Ms = performance.now() - t2;
    expect(round2.published ?? false).toBe(false);
    expect(round2.downloadedNotes ?? 0).toBe(0);
    expect(round2.uploadedNotes ?? 0).toBe(0);
    expect(round2.warnings ?? []).toEqual([]);

    report("s3-scale-rounds", {
      notes: NOTES, quick: QUICK, assetsPerNote: ASSETS_PER_NOTE,
      changed: CHANGED, trashed: TRASHED, phoneNew: PHONE_NEW_NOTES + PHONE_NEW_QUICK,
      deskFirstMs: Math.round(deskMs), phoneFirstMs: Math.round(phoneMs), phoneSecondMs: Math.round(phone2Ms),
      downloaded: round.downloadedNotes ?? 0, uploaded: round.uploadedNotes ?? 0,
      objects: objects.length, heapDeltaMb: memMb() - heap0,
    });
  }, 300_000);
});
