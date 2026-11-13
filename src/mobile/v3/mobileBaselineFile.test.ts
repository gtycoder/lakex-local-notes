import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));

import { SqlJsAsyncDb, SqlJsDb, type MobileDb } from "../data/sqliteDb.js";
import { applyMobileSchema } from "../data/schema.js";
import { createNotebook } from "../data/treeRepository.js";
import { createNote } from "../data/noteRepository.js";
import { saveQuickNote } from "../data/quickNotesRepository.js";
import {
  ensureV3StateTable, savePersistedV3State, type MobileV3Baseline,
} from "../data/v3StateRepository.js";
import {
  MOBILE_BASELINE_FILE_PATH, readBaselineFile, writeBaselineFile, setBaselineGzipCodecForTest,
} from "../data/v3BaselineFile.js";
import { setBodyStoreBackendForTest, type BodyStoreBackend } from "../native/bodyStore.js";
import { sha256Hex } from "../../core/syncUtils.js";
import { MobileDeviceStore } from "./mobileDeviceStore.js";
import { runMobileV3PushQuickNote, runMobileV3Sync } from "./sync.js";
import type { RemoteObjectInfo, S3v3Remote } from "../../core/s3v3Ports.js";

/**
 * D1-C 护栏（261113）：移动端同步基线从 sync_v3_state 整行 JSON 搬到 gzip 文件。
 *
 * 钉住四件事：
 *  1. 往返一致（含 5000 文档规模的一次性断言）+ 落盘体积显著变小（行只写信封、文件 = 压缩后字节）；
 *  2. 旧行内嵌 baseline 只**一次性迁移**（第二次加载不再读行、不再写文件）；
 *  3. 文件损坏/丢失 = 同步硬失败（绝不把「基线缺失」当成「云端缺席 = 删除」，本机行原样保留）；
 *  4. saveBaseline 写文件失败 ⇒ 不标 synced（守卫式归位不先于基线落盘）。
 */

const ISO = "2026-01-01T00:00:00.000Z";
const H = (ch: string) => ch.repeat(64);

class CountingBodyStore implements BodyStoreBackend {
  readonly files = new Map<string, string>();
  reads = 0;
  writes = 0;
  removes = 0;
  failWrites = false;

  async readText(file: string): Promise<string | null> { this.reads += 1; return this.files.get(file) ?? null; }
  async writeText(file: string, text: string): Promise<number> {
    if (this.failWrites) throw new Error("磁盘已满（注入）");
    this.writes += 1;
    this.files.set(file, text);
    return new TextEncoder().encode(text).length;
  }
  async remove(file: string): Promise<void> { this.removes += 1; this.files.delete(file); }
  async stat(file: string): Promise<{ exists: boolean; size: number }> {
    const value = this.files.get(file);
    return { exists: value !== undefined, size: value === undefined ? 0 : value.length };
  }
  async readSnapshot(): Promise<string | null> { return null; }
  async writeSnapshot(): Promise<number> { return 0; }
}

function useBackend(): CountingBodyStore {
  const backend = new CountingBodyStore();
  setBodyStoreBackendForTest(backend);
  return backend;
}

afterEach(() => {
  setBodyStoreBackendForTest(null);
  setBaselineGzipCodecForTest(undefined);
});

const hashOf = (text: string): string => sha256Hex(new TextEncoder().encode(text));

/**
 * 5000 文档 + 500 小记规模的基线（≈ 线上大库的 5000 文档档）。
 * 哈希/标题/时间都按条目变化（避免全同值把 gzip 比压成不真实的 0.07），量级按真实落盘估。
 */
function bigBaseline(noteCount = 5000, quickCount = 500): MobileV3Baseline {
  const baseMs = Date.UTC(2026, 0, 1);
  const notes = Array.from({ length: noteCount }, (_, i) => ({
    id: "note-" + i,
    title: "文档标题 " + ((i * 7919) % 100003),
    parentId: i % 9 === 0 ? null : "nb-" + (i % 9),
    sortOrder: i,
    updatedAt: new Date(baseMs + i * 3_600_000).toISOString(),
    contentHash: hashOf("note-body-" + i),
    ...(i % 7 === 0 ? { assetsHash: hashOf("assets-" + i) } : {}),
  }));
  const items = Array.from({ length: quickCount }, (_, i) => ({
    id: "q-" + i,
    createdAt: new Date(baseMs + i * 60_000).toISOString(),
    updatedAt: new Date(baseMs + i * 3_600_000 + 1).toISOString(),
    contentHash: hashOf("quick-body-" + i),
    previewText: "小记预览 " + ((i * 104729) % 10007),
  }));
  const folders = Array.from({ length: 30 }, (_, i) => ({
    id: "nb-" + i, title: "笔记本 " + i, parentId: null, sortOrder: i,
    nodeType: "notebook", icon: null, updatedAt: ISO, space: null,
  }));
  return {
    epoch: "11111111-1111-4111-8111-111111111111",
    generation: 3,
    lakeCommit: hashOf("lake-index"),
    quickNotesCommit: hashOf("quick-index"),
    lake: { v: 3, space: "lake", notes, folders },
    quickNotes: { v: 3, space: "quickNotes", items },
  } as MobileV3Baseline;
}

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  await ensureV3StateTable(db);
  return db;
}

/** 计数包装：onPrepare(sql) 在 prepare 层统计（同步账本行读 / 行写次数）。 */
function countingDb(db: SqlJsAsyncDb, onPrepare: (sql: string) => void): MobileDb {
  const inner = db as unknown as MobileDb;
  return {
    prepare(sql: string) {
      onPrepare(sql);
      return inner.prepare(sql);
    },
    transaction: inner.transaction.bind(inner),
    pragma: inner.pragma.bind(inner),
    exec: inner.exec.bind(inner),
    databaseSizeBytes: inner.databaseSizeBytes.bind(inner),
    close: inner.close.bind(inner),
    ...(inner.executeSet ? { executeSet: inner.executeSet.bind(inner) } : {}),
  } as MobileDb;
}

/** 新落盘信封（行里不含 baseline）。 */
function envelope(): Record<string, unknown> {
  return {
    version: 3,
    records: [{ kind: "cloud-deleted", id: "n1" }, { kind: "delete-intent", noteId: "n2", targetEpoch: "e1", targetGeneration: 2 }],
    assets: { lake: { n1: H("f") }, quickNotes: {} },
  };
}

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, Uint8Array>();
  async get(key: string) { return this.objects.get(key) ?? null; }
  async put(key: string, bytes: Uint8Array) { this.objects.set(key, new Uint8Array(bytes)); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: this.objects.get(key)!.length })); }
  async deleteMany(keys: string[]) { keys.forEach((k) => this.objects.delete(k)); }
  async deleteByPrefix(prefix: string) { const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); keys.forEach((k) => this.objects.delete(k)); return keys.length; }
}
const SETTINGS = { endpoint: "https://example.com", region: "cn-north-1", bucket: "b", accessKeyId: "a", secretAccessKey: "s", prefix: "p" };

async function gunzipBase64(text: string): Promise<string> {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

describe("D1-C：移动端 baseline 落 gzip 文件（不再随 sync_v3_state 整行过桥）", () => {
  it("往返一致（5000 文档 + 500 小记一次性断言）+ 落盘体积对比（记录实测字节）", async () => {
    const backend = useBackend();
    const baseline = bigBaseline(5000, 500);
    const writeStart = performance.now();
    const stats = await writeBaselineFile(baseline);
    const writeMs = performance.now() - writeStart;

    // 逐字节等价：文件 = base64(gzip(JSON.stringify(baseline)))，解压回同一串。
    const fileText = backend.files.get(MOBILE_BASELINE_FILE_PATH);
    expect(fileText).toBeTruthy();
    expect(await gunzipBase64(fileText!)).toBe(JSON.stringify(baseline));

    const readStart = performance.now();
    const read = await readBaselineFile();
    const readMs = performance.now() - readStart;
    expect(read.status).toBe("ok");
    if (read.status !== "ok") throw new Error("unreachable");
    expect(read.baseline).toEqual(baseline);
    expect(read.gzipped).toBe(true);

    // 二次写同一基线 = 同一字节（确定性编码，跨设备 diff 友好）。
    const again = await writeBaselineFile(read.baseline);
    expect(again.jsonBytes).toBe(stats.jsonBytes);
    expect(again.fileBytes).toBe(stats.fileBytes);

    const rowBytes = JSON.stringify(envelope()).length;
    console.log("[D1-C] baseline JSON=" + stats.jsonBytes + "B / 文件(base64 gzip)=" + stats.fileBytes
      + "B / 压缩比=" + (stats.fileBytes / stats.jsonBytes).toFixed(3)
      + " / 行(信封)=" + rowBytes + "B / 编码(gzip+b64)=" + writeMs.toFixed(1) + "ms / 解码=" + readMs.toFixed(1) + "ms");
    expect(stats.fileBytes).toBeLessThan(stats.jsonBytes);
  }, 30_000);

  it("行体积显著变小：baseline 从行里移出（同一份数据，before/after 实测）", async () => {
    useBackend();
    const db = await freshDb();
    const baseline = bigBaseline(5000, 500);
    const persisted = envelope();
    // before = D1-C 之前的落盘形状（信封 + baseline 同 JSON）
    const beforeJson = JSON.stringify({ ...persisted, baseline });
    await savePersistedV3State(db, persisted as never);
    const afterJson = (await db.prepare("SELECT json FROM sync_v3_state WHERE id='state'").get() as { json: string }).json;
    // 文件侧体积（同样数据）
    const fileStats = await writeBaselineFile(baseline);
    console.log("[D1-C] 行体积 before=" + beforeJson.length + "B after=" + afterJson.length + "B（"
      + (100 - (afterJson.length / beforeJson.length) * 100).toFixed(1) + "% 更小）；baseline 文件=" + fileStats.fileBytes + "B");
    expect(afterJson).not.toContain('"baseline"');
    expect(afterJson.length).toBeLessThan(beforeJson.length / 10);
    expect(beforeJson.length).toBeGreaterThan(1_000_000); // 确实是 2.28MB 量级的真实形状
    await db.close();
  }, 30_000);

  it("旧行内嵌 baseline ⇒ 一次性迁移：第一次写文件、第二次只读文件（0 行读 / 0 再写）", async () => {
    const backend = useBackend();
    const db = await freshDb();
    const baseline = bigBaseline(50, 5);
    // 旧落盘形状：信封 + baseline 同 JSON
    await db.prepare("INSERT INTO sync_v3_state (id,json) VALUES ('state',?)").run(JSON.stringify({ ...envelope(), baseline }));

    let rowReads = 0;
    const store = new MobileDeviceStore(countingDb(db, (sql) => {
      if (/FROM\s+sync_v3_state/i.test(sql)) rowReads += 1;
    }));

    const first = await store.loadBaseline();
    expect(first).toEqual(baseline);
    expect(backend.writes, "第一次加载 = 迁移写一次文件").toBe(1);
    expect(rowReads).toBe(1);
    expect((await readBaselineFile()).status).toBe("ok");

    // 模拟「下一次信封写入已剔除行内 baseline」（core saveState 的落盘形状）。
    await savePersistedV3State(db, envelope() as never);
    rowReads = 0;
    const second = await store.loadBaseline();
    expect(second).toEqual(baseline);
    expect(backend.writes, "第二次加载不再迁移/不再写文件").toBe(1);
    expect(rowReads, "文件优先 ⇒ 第二次加载 0 次 state 行读").toBe(0);
    await db.close();
  }, 30_000);

  it("文件损坏：同步硬失败（不当无基线），本机文档/小记行原样保留", async () => {
    const backend = useBackend();
    const db = await freshDb();
    const nb = await createNotebook(db, { title: "NB", icon: null });
    await createNote(db, "n1", "Doc", "hello", nb.id, new Map());
    await saveQuickNote(db, "q1", "one");
    await savePersistedV3State(db, envelope() as never);
    // 损坏文件（非 base64 / 非 gzip / 非 JSON）
    backend.files.set(MOBILE_BASELINE_FILE_PATH, "!!!corrupted!!!");
    const store = new MobileDeviceStore(db);

    await expect(store.loadBaseline()).rejects.toThrow(/基线/);
    // 单条快路径 / 整轮都必须在出网前中止：绝不走 pull-all（那会物理丢弃「从未同步过的小记」）。
    const remote = new MemoryRemote();
    await expect(runMobileV3PushQuickNote(db, SETTINGS, "q1", { remote, deviceId: "M" })).rejects.toThrow(/基线/);
    await expect(runMobileV3Sync(db, SETTINGS, { remote, deviceId: "M" })).rejects.toThrow(/基线/);
    expect(remote.objects.size, "失败路径不得产生任何云端写入").toBe(0);
    const noteRows = await db.prepare("SELECT COUNT(*) AS n FROM notes WHERE id='n1'").get() as { n: number };
    const quickRows = await db.prepare("SELECT COUNT(*) AS n FROM quick_notes WHERE id='q1'").get() as { n: number };
    expect(noteRows.n).toBe(1);
    expect(quickRows.n, "基线缺失绝不能被当成云端缺席而删本地小记").toBe(1);
    await db.close();
  }, 30_000);

  it("文件缺失：全新设备（无信封行）= 无基线（安全返回 null）；已有信封但文件丢了 = 硬失败", async () => {
    useBackend();
    const fresh = await freshDb();
    const freshStore = new MobileDeviceStore(fresh);
    expect(await freshStore.loadBaseline()).toBeNull();
    await fresh.close();

    const db = await freshDb();
    await savePersistedV3State(db, envelope() as never);
    const store = new MobileDeviceStore(db);
    await expect(store.loadBaseline()).rejects.toThrow(/基线/);
    await db.close();
  }, 30_000);

  it("损坏文件 + 旧行内嵌 baseline ⇒ 自动修复（迁移写文件），不硬失败", async () => {
    const backend = useBackend();
    const db = await freshDb();
    const baseline = bigBaseline(20, 2);
    await db.prepare("INSERT INTO sync_v3_state (id,json) VALUES ('state',?)").run(JSON.stringify({ ...envelope(), baseline }));
    backend.files.set(MOBILE_BASELINE_FILE_PATH, "!!!corrupted!!!");
    const store = new MobileDeviceStore(db);
    expect(await store.loadBaseline()).toEqual(baseline);
    expect((await readBaselineFile()).status).toBe("ok");
    await db.close();
  }, 30_000);

  it("saveBaseline：写文件一次、不写信封行；写失败 ⇒ 不标 synced（失败安全）", async () => {
    const backend = useBackend();
    const db = await freshDb();
    const nb = await createNotebook(db, { title: "NB", icon: null });
    await createNote(db, "n1", "Doc", "hello", nb.id, new Map());
    const updatedAt = (await db.prepare("SELECT updated_at FROM notes WHERE id='n1'").get() as { updated_at: string }).updated_at;
    const baseline = {
      epoch: "e1", generation: 1, lakeCommit: "c1", quickNotesCommit: "q1",
      lake: { v: 3, space: "lake", notes: [{ id: "n1", title: "Doc", parentId: null, sortOrder: 0, updatedAt, contentHash: "h" }], folders: [] },
      quickNotes: { v: 3, space: "quickNotes", items: [] },
    };

    let rowStatements = 0;
    const store = new MobileDeviceStore(countingDb(db, (sql) => {
      if (sql.includes("sync_v3_state")) rowStatements += 1;
    }));
    backend.writes = 0; // createNote 写过正文文件；这里只统计 saveBaseline 的写入
    await store.saveBaseline(baseline as never);
    expect(backend.writes).toBe(1);
    expect(rowStatements, "saveBaseline 不再读/写 sync_v3_state 行").toBe(0);
    expect((await db.prepare("SELECT is_dirty FROM notes WHERE id='n1'").get() as { is_dirty: number }).is_dirty).toBe(0);
    expect(await store.loadBaseline()).toEqual(baseline);

    // 写文件失败：守卫式归位不得先发生（行仍 dirty，下一轮重试）。
    await db.prepare("UPDATE notes SET is_dirty=1 WHERE id='n1'").run();
    backend.failWrites = true;
    await expect(store.saveBaseline(baseline as never)).rejects.toThrow(/磁盘已满/);
    expect((await db.prepare("SELECT is_dirty FROM notes WHERE id='n1'").get() as { is_dirty: number }).is_dirty).toBe(1);
    await db.close();
  }, 30_000);
});
