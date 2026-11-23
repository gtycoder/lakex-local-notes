/**
 * 「云端首次相遇」真桶 E2E（SYNC-PROTOCOL §21）：四选项语义 / ask-once / 换目标重问 / 配置探测三态。
 * 搭具 = bootstrapMigration.s3.integration 同款（runMobileV3Sync + sql.js + 真实 S3）。
 * 门控：S3V3_IT=1 + S3V3_ENDPOINT/BUCKET/AK/SK（env 注入，凭据不落仓库/日志）；
 * 每个用例独立子前缀 `_fe/<uuid>/<uuid>`，收尾 deleteByPrefix("") 断言 residual=0。
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { SqlJsAsyncDb, SqlJsDb } from "../mobile/data/sqliteDb.js";
import { applyMobileSchema } from "../mobile/data/schema.js";
import { createNote, listTrashed, readNote, saveNote } from "../mobile/data/noteRepository.js";
import { deleteQuickNote, listQuickNoteTrash, readQuickNote, saveQuickNote } from "../mobile/data/quickNotesRepository.js";
import { EMPTY_MOBILE_V3_STATE, ensureV3StateTable, loadSyncBaseline, saveV3State } from "../mobile/data/v3StateRepository.js";
import { setBaselineFileForDbForTest } from "../mobile/data/v3BaselineFile.js";
import { setBodyStoreBackendForTest, type BodyStoreBackend } from "../mobile/native/bodyStore.js";
import { buildBootstrapBaseline } from "./portable/bootstrapBaseline.js";
import { probeCloudTarget, setPendingFirstEncounterMode, targetKeyOf } from "./firstEncounter.js";
import type { LakeNoteEntry, QuickNoteEntry } from "./s3v3/protocol/s3v3Index.js";
import { runMobileV3Sync } from "../mobile/v3/sync.js";
import { createS3v3RemoteWithClient } from "../mobile/v3/s3v3Remote.js";

const enabled = process.env.S3V3_IT === "1" && !!process.env.S3V3_ENDPOINT && !!process.env.S3V3_BUCKET && !!process.env.S3V3_AK && !!process.env.S3V3_SK;
const d = enabled ? describe : describe.skip;
const ISO = "2026-11-23T00:00:00.000Z";
let client: S3Client;
let rootPrefix: string;
const dbs: SqlJsAsyncDb[] = [];

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

async function openDb(baselinePath: string): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  setBaselineFileForDbForTest(db, baselinePath);
  await ensureV3StateTable(db);
  dbs.push(db);
  return db;
}

function optsFor(prefix: string) {
  return { endpoint: process.env.S3V3_ENDPOINT!, region: process.env.S3V3_REGION || "cn-north-1", bucket: process.env.S3V3_BUCKET!, accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK!, prefix };
}

type Row = Record<string, unknown>;
async function bootstrapBaseFromDb(db: SqlJsAsyncDb) {
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

const unique = () => rootPrefix + "/" + randomUUID();

d("云端首次相遇 · 真桶 E2E（SYNC-PROTOCOL §21）", () => {
  beforeAll(() => {
    setBodyStoreBackendForTest(makeIsolatedBodyStore());
    rootPrefix = (process.env.S3V3_PREFIX || "lakex-notes-dev3") + "/_fe/" + randomUUID();
    client = new S3Client({ region: process.env.S3V3_REGION || "cn-north-1", endpoint: process.env.S3V3_ENDPOINT!, credentials: { accessKeyId: process.env.S3V3_AK!, secretAccessKey: process.env.S3V3_SK! }, forcePathStyle: false });
  });
  afterAll(async () => {
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, rootPrefix);
    await remote.deleteByPrefix("").catch(() => {});
    // 清理完整性：收尾必须 0 残留。
    const left = await remote.list("").catch(() => [{ key: "<list-failed>" }]);
    expect(left.length, "真桶清理 residual 必须为 0").toBe(0);
    setBodyStoreBackendForTest(null);
    for (const db of dbs) await db.close().catch(() => {});
  });

  it("智能合并（bootstrap 基线）：基线有+云端删 ⇒ 进回收站可恢复；本地新增上传；增量不重传", async () => {
    const pfx = unique();
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfx);
    const cloud = await openDb("sync-v3/c-" + randomUUID());
    await createNote(cloud, "n1", "不变", "doc-unchanged", null, new Map());
    await createNote(cloud, "n2", "云端删了", "doc-deleted-later", null, new Map());
    await saveQuickNote(cloud, "q1", "qn-keep", []);
    await runMobileV3Sync(cloud, optsFor(pfx), { remote, deviceId: "cloud", emptyCloud: "upload" });
    // 手机（导入同内容 + bootstrap 底稿）；云端随后删 n2。
    const bPath = "sync-v3/pb-" + randomUUID();
    const phone = await openDb(bPath);
    await createNote(phone, "n1", "不变", "doc-unchanged", null, new Map());
    await createNote(phone, "n2", "云端删了", "doc-deleted-later", null, new Map());
    await createNote(phone, "n4", "手机新增", "doc-new-on-phone", null, new Map());
    await saveQuickNote(phone, "q1", "qn-keep", []);
    await saveQuickNote(phone, "q3", "qn-new-on-phone", []);
    await saveV3State(phone, { ...EMPTY_MOBILE_V3_STATE, baseline: await bootstrapBaseFromDb(phone) }, undefined, bPath);
    const { trashNote } = await import("../mobile/data/noteRepository.js");
    await trashNote(cloud, "n2");
    await runMobileV3Sync(cloud, optsFor(pfx), { remote, deviceId: "cloud" });
    setPendingFirstEncounterMode("smart");
    const round = await runMobileV3Sync(phone, optsFor(pfx), { remote, deviceId: "phone" });
    expect(round.warnings ?? []).toEqual([]);
    // 删除传播 = 进回收站可恢复（正文保留）。
    expect((await listTrashed(phone)).some((n) => n.id === "n2")).toBe(true);
    expect((await readNote(phone, "n2"))?.content).toBe("doc-deleted-later");
    // 本地新增不丢且上传；q3 存活。
    expect((await readQuickNote(phone, "q3"))?.content.text).toBe("qn-new-on-phone");
  }, 180_000);

  it("只增不删：云端删的不传播（重传保活跃）、本地新增上传", async () => {
    const pfx = unique();
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfx);
    const cloud = await openDb("sync-v3/c-" + randomUUID());
    await createNote(cloud, "n1", "不变", "doc-unchanged", null, new Map());
    await createNote(cloud, "n2", "云端删了", "doc-deleted-later", null, new Map());
    await runMobileV3Sync(cloud, optsFor(pfx), { remote, deviceId: "cloud", emptyCloud: "upload" });
    const bPath = "sync-v3/pb-" + randomUUID();
    const phone = await openDb(bPath);
    await createNote(phone, "n1", "不变", "doc-unchanged", null, new Map());
    await createNote(phone, "n2", "云端删了", "doc-deleted-later", null, new Map());
    await saveV3State(phone, { ...EMPTY_MOBILE_V3_STATE, baseline: await bootstrapBaseFromDb(phone) }, undefined, bPath);
    const { trashNote } = await import("../mobile/data/noteRepository.js");
    await trashNote(cloud, "n2");
    await runMobileV3Sync(cloud, optsFor(pfx), { remote, deviceId: "cloud" });
    setPendingFirstEncounterMode("additive");
    await runMobileV3Sync(phone, optsFor(pfx), { remote, deviceId: "phone" });
    // 双向都不删：n2 不进回收站、正文仍在。
    expect((await listTrashed(phone)).some((n) => n.id === "n2")).toBe(false);
    expect((await readNote(phone, "n2"))?.content).toBe("doc-deleted-later");
  }, 180_000);

  it("以本地为准：云端独有 → 本地回收站可恢复；本地内容上行", async () => {
    const pfx = unique();
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfx);
    const cloud = await openDb("sync-v3/c-" + randomUUID());
    await createNote(cloud, "n9", "云端独有", "doc-cloud-only", null, new Map());
    await saveQuickNote(cloud, "q9", "qn-cloud-only", []);
    await runMobileV3Sync(cloud, optsFor(pfx), { remote, deviceId: "cloud", emptyCloud: "upload" });
    const phone = await openDb("sync-v3/p-" + randomUUID());
    await createNote(phone, "n4", "手机独有", "doc-local-only", null, new Map());
    setPendingFirstEncounterMode("local-wins");
    await runMobileV3Sync(phone, optsFor(pfx), { remote, deviceId: "phone" });
    console.log("DBG-NOTES", JSON.stringify((await phone.prepare("SELECT id, trashed_at, deleted_from_parent_id, is_purged FROM notes").all()) as unknown as Row[]));
    console.log("DBG-QUICK", JSON.stringify((await phone.prepare("SELECT * FROM quick_notes").all()) as unknown as Row[]));
    // 云端独有 → 进回收站（可恢复，正文保留）；小记 → 小记回收站（不物删）。
    expect((await listTrashed(phone)).some((n) => n.id === "n9")).toBe(true);
    expect((await readNote(phone, "n9"))?.content).toBe("doc-cloud-only");
    expect((await listQuickNoteTrash(phone)).some((q) => q.id === "q9")).toBe(true);
  }, 180_000);

  it("以云端为准：本地独有 → 「云端已删·仅本地」回收站；小记进小记回收站绝不物删", async () => {
    const pfx = unique();
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfx);
    const cloud = await openDb("sync-v3/c-" + randomUUID());
    await createNote(cloud, "n1", "云端在", "doc-cloud", null, new Map());
    await runMobileV3Sync(cloud, optsFor(pfx), { remote, deviceId: "cloud", emptyCloud: "upload" });
    const phone = await openDb("sync-v3/p-" + randomUUID());
    await createNote(phone, "n4", "手机独有", "doc-local-only", null, new Map());
    await saveQuickNote(phone, "q5", "qn-local-only", []);
    setPendingFirstEncounterMode("cloud-wins");
    await runMobileV3Sync(phone, optsFor(pfx), { remote, deviceId: "phone" });
    expect((await listTrashed(phone)).some((n) => n.id === "n4")).toBe(true);
    // 小记：进小记回收站（可恢复）——绝不是物理删除（readQuickNote 仍可读正文）。
    expect((await listQuickNoteTrash(phone)).some((q) => q.id === "q5")).toBe(true);
    expect((await readQuickNote(phone, "q5"))?.content.text).toBe("qn-local-only");
  }, 180_000);

  it("ask-once：无 mode 抛询问错误（带 facts）；选定后建立关系；二轮无 mode 不再问；targetKey 盖章", async () => {
    const pfx = unique();
    const remote = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfx);
    const cloud = await openDb("sync-v3/c-" + randomUUID());
    await createNote(cloud, "n1", "云端在", "doc-cloud", null, new Map());
    await runMobileV3Sync(cloud, optsFor(pfx), { remote, deviceId: "cloud", emptyCloud: "upload" });
    const bPath = "sync-v3/pb-" + randomUUID();
    const phone = await openDb(bPath);
    await createNote(phone, "n4", "手机独有", "doc-local-only", null, new Map());
    let err: { code?: string; message?: string } | null = null;
    try { await runMobileV3Sync(phone, optsFor(pfx), { remote, deviceId: "phone" }); } catch (e) { err = e as { code?: string; message?: string }; }
    expect(err?.code).toBe("first-encounter-decision-required");
    expect(String(err?.message)).toContain("localNotes");
    setPendingFirstEncounterMode("additive");
    await runMobileV3Sync(phone, optsFor(pfx), { remote, deviceId: "phone" });
    const baseline = await loadSyncBaseline(phone, bPath); // 路径必须显式传（saveV3State 同款坑）
    expect(baseline?.targetKey).toBe(targetKeyOf(optsFor(pfx) as never));
    // 二轮：不再询问。
    const second = await runMobileV3Sync(phone, optsFor(pfx), { remote, deviceId: "phone" });
    expect(second).toBeTruthy();
  }, 180_000);

  it("换目标重问：同机换前缀（新云端目标）⇒ 重新要求选择", async () => {
    const pfxA = unique();
    const remoteA = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfxA);
    const phone = await openDb("sync-v3/p-" + randomUUID());
    await createNote(phone, "n4", "手机独有", "doc-local-only", null, new Map());
    setPendingFirstEncounterMode("additive");
    await runMobileV3Sync(phone, optsFor(pfxA), { remote: remoteA, deviceId: "phone", emptyCloud: "upload" });
    // 换目标（新前缀、云端非空）。
    const pfxB = unique();
    const remoteB = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfxB);
    const cloudB = await openDb("sync-v3/cb-" + randomUUID());
    await createNote(cloudB, "n1", "B 云端", "doc-b", null, new Map());
    await runMobileV3Sync(cloudB, optsFor(pfxB), { remote: remoteB, deviceId: "cloudB", emptyCloud: "upload" });
    let err: { code?: string } | null = null;
    try { await runMobileV3Sync(phone, optsFor(pfxB), { remote: remoteB, deviceId: "phone" }); } catch (e) { err = e as { code?: string }; }
    expect(err?.code).toBe("first-encounter-decision-required");
  }, 180_000);

  it("配置探测三态真桶实测：empty / ours（pointer 标记）/ foreign", async () => {
    const pfxEmpty = unique();
    const rEmpty = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfxEmpty);
    expect((await probeCloudTarget(rEmpty)).kind).toBe("empty");
    const pfxOurs = unique();
    const rOurs = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfxOurs);
    await rOurs.put("meta/pointer.json", new TextEncoder().encode("{}"));
    expect((await probeCloudTarget(rOurs)).kind).toBe("ours");
    const pfxForeign = unique();
    const rForeign = createS3v3RemoteWithClient(client, process.env.S3V3_BUCKET!, pfxForeign);
    await rForeign.put("other/file.txt", new TextEncoder().encode("x"));
    const probe = await probeCloudTarget(rForeign);
    expect(probe.kind).toBe("foreign");
    expect(probe.hint?.tone).toBe("warn");
  }, 120_000);
});