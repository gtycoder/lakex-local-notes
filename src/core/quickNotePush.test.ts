/**
 * 单条小记推送（「保存并同步」）护栏。
 *
 * 最关键的一条：**只 upsert 目标条目，其余条目逐字节不变** —— 覆盖式重建会让其他端
 * 把未声明的小记当"云端已删除"处理（墓碑/GC 误删）。此外覆盖两条退回完整同步的路径
 * （无远端清单 / 远端墓碑）与 I2 记账守卫。
 */
import { describe, it, expect } from "vitest";
import type { S3Store, SyncConfig } from "./syncEngine.js";
import type { ManifestItem, QuickNotesManifest } from "./manifestTypes.js";
import { pushQuickNote } from "./quickNotePush.js";
import type { QuickNoteSyncItem, QuickNoteSyncItemImage, QuickNotesSyncDbPort } from "./quickNotesSyncEngine.js";
import { sha256Sync } from "./sha256Sync.js";

const cfg: SyncConfig = { endpoint: "https://s3.test", region: "test", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "lake" };
const manifestKey = `${cfg.prefix}/quick-notes/manifests/latest.json`;

function createFakeS3(): S3Store & { bucket: Map<string, Uint8Array>; puts: string[] } {
  const bucket = new Map<string, Uint8Array>();
  const puts: string[] = [];
  return {
    bucket,
    puts,
    async getObject(key, opts) {
      const bytes = bucket.get(key);
      if (!bytes) return null;
      if (opts?.maxBytes && bytes.length > opts.maxBytes) throw new Error(`对象超限: ${key}`);
      return bytes;
    },
    async putObject(key, body, opts) {
      puts.push(key);
      void opts;
      bucket.set(key, typeof body === "string" ? new TextEncoder().encode(body) : body);
    },
  };
}

interface FakeNote {
  id: string; createdAt: string; updatedAt: string; syncState: string; isConflict: boolean;
  images: QuickNoteSyncItemImage[]; content: Uint8Array;
}

interface FakePort {
  port: QuickNotesSyncDbPort;
  notes: Map<string, FakeNote>;
  assets: Map<string, Uint8Array>;
  bases: Map<string, string>;
  syncedCalls: Array<{ id: string; expected: string }>;
  restorePending: Set<string>;
}

const bytesOf = (text: string) => new TextEncoder().encode(text);

function createFakePort(): FakePort {
  const notes = new Map<string, FakeNote>();
  const assets = new Map<string, Uint8Array>();
  const bases = new Map<string, string>();
  const syncedCalls: Array<{ id: string; expected: string }> = [];
  const restorePending = new Set<string>();
  const tombstones = new Map<string, { id: string; createdAt: string; updatedAt: string; deletedAt: string }>();
  const now = () => new Date().toISOString();
  const port: QuickNotesSyncDbPort = {
    async listLocalQuickNotes(): Promise<QuickNoteSyncItem[]> {
      return [...notes.values()].map((n) => ({
        id: n.id, createdAt: n.createdAt, updatedAt: n.updatedAt,
        contentHash: sha256Sync(n.content), syncState: n.syncState, isConflict: n.isConflict, images: n.images,
      }));
    },
    async readContent(id) { return notes.get(id)?.content ?? null; },
    async readAsset(id, filename) { return assets.get(`${id}/${filename}`) ?? null; },
    async applyRemoteQuickNote(item, content, incoming) {
      notes.set(item.id, {
        id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, syncState: "synced",
        isConflict: item.isConflict, content,
        images: item.assets.map((a) => ({ ...a })),
      });
      for (const a of incoming) assets.set(`${item.id}/${a.filename}`, a.bytes);
    },
    async applyTombstoneContent() { /* 本文件不覆盖墓碑落地 */ },
    async listDeletedQuickNoteAssets() { return []; },
    async applyTombstoneAssets() { /* noop */ },
    // 真实端口语义：软删会**记墓碑**（桌面 deleteSourceAndRemember / 移动端软删行）；
    // 不记的话完整同步的"墓碑重发"链路测不出来（这一条正是本文件要保的语义）。
    async deleteLocalQuickNote(id) {
      const note = notes.get(id);
      if (note) tombstones.set(id, { id, createdAt: note.createdAt, updatedAt: note.updatedAt, deletedAt: now() });
      notes.delete(id);
    },
    async archiveLocalQuickNoteToTrash(id) { notes.delete(id); },
    async listDeletedQuickNotes() { return [...tombstones.values()]; },
    async listAllDeletedQuickNotes() { return [...tombstones.values()]; },
    async listDeferredDeletedQuickNotes() { return []; },
    async rememberDeletedQuickNote(item) { tombstones.set(item.id, item); },
    async revokeLocalDeletion() { /* noop */ },
    async isRestorePending(id) { return restorePending.has(id); },
    async baseHash(id) { return bases.get(id) ?? null; },
    async setBaseHash(id, hash) { bases.set(id, hash); },
    async markSynced() { /* noop */ },
    async markSyncedIfUnchanged(id, expected) { syncedCalls.push({ id, expected }); },
    log() { /* 测试静音 */ },
  };
  return { port, notes, assets, bases, syncedCalls, restorePending };
}

function addNote(f: FakePort, id: string, text: string, images: QuickNoteSyncItemImage[] = []): FakeNote {
  const note: FakeNote = { id, createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z", syncState: "local", isConflict: false, images, content: bytesOf(text) };
  f.notes.set(id, note);
  return note;
}

function seedManifest(s3: ReturnType<typeof createFakeS3>, items: ManifestItem[], commitId = "seed-commit"): QuickNotesManifest {
  const manifest: QuickNotesManifest = { version: 1, workspaceId: "default", commitId, createdAt: "2026-10-12T00:00:00.000Z", items };
  s3.bucket.set(manifestKey, bytesOf(JSON.stringify(manifest, null, 2)));
  return manifest;
}

const readManifest = (s3: ReturnType<typeof createFakeS3>): QuickNotesManifest =>
  JSON.parse(new TextDecoder().decode(s3.bucket.get(manifestKey)!)) as QuickNotesManifest;

const remoteItem = (id: string, contentHash: string, extra: Partial<ManifestItem> = {}): ManifestItem => ({
  id, createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z",
  contentHash, isConflict: false, assets: [], ...extra,
});

describe("单条小记推送（保存并同步）", () => {
  it("只 upsert 目标条目：其余条目（含墓碑）逐字节不变", async () => {
    const s3 = createFakeS3();
    const f = createFakePort();
    const otherActive = remoteItem("note-other", sha256Sync(bytesOf("other")));
    const otherTomb = remoteItem("note-gone", "deadbeef", { deleted: true, deletedAt: "2026-10-10T00:00:00.000Z" });
    const target = remoteItem("note-target", sha256Sync(bytesOf("v1")));
    seedManifest(s3, [otherActive, otherTomb, target]);
    addNote(f, "note-target", "v2"); // 本地改了正文 ⇒ 需要 upsert

    const outcome = await pushQuickNote(cfg, s3, f.port, "note-target");

    expect(outcome.status).toBe("pushed");
    const after = readManifest(s3);
    expect(after.items).toHaveLength(3);
    const unchanged = after.items.filter((i) => i.id !== "note-target");
    expect(JSON.stringify(unchanged)).toBe(JSON.stringify([otherActive, otherTomb]));
    const pushed = after.items.find((i) => i.id === "note-target")!;
    expect(pushed.contentHash).toBe(sha256Sync(bytesOf("v2")));
    expect(after.commitId).not.toBe("seed-commit");
  });

  it("内容与图片都没变 ⇒ 不写清单、不重复上传正文", async () => {
    const s3 = createFakeS3();
    const f = createFakePort();
    const hash = sha256Sync(bytesOf("same"));
    seedManifest(s3, [remoteItem("note-a", hash)]);
    addNote(f, "note-a", "same");
    s3.bucket.set(`${cfg.prefix}/quick-notes/objects/${hash}.qnote`, bytesOf("same"));
    s3.puts.length = 0;

    const outcome = await pushQuickNote(cfg, s3, f.port, "note-a");

    expect(outcome).toMatchObject({ status: "pushed", unchanged: true, uploadedContent: false, manifestId: null });
    expect(s3.puts).toHaveLength(0);
    expect(readManifest(s3).commitId).toBe("seed-commit");
  });

  it("云端还没有清单 ⇒ 退回一次完整同步（不写「只有这一条」的清单）", async () => {
    const s3 = createFakeS3();
    const f = createFakePort();
    addNote(f, "note-a", "a");
    addNote(f, "note-b", "b");

    const outcome = await pushQuickNote(cfg, s3, f.port, "note-a");

    expect(outcome.status).toBe("full-sync");
    if (outcome.status !== "full-sync") throw new Error("unreachable");
    expect(outcome.reason).toBe("no-remote-manifest");
    const after = readManifest(s3);
    expect(after.items.map((i) => i.id).sort()).toEqual(["note-a", "note-b"]);
  });

  it("远端是墓碑且无恢复标记 ⇒ 不复活，退回完整同步", async () => {
    const s3 = createFakeS3();
    const f = createFakePort();
    seedManifest(s3, [remoteItem("note-a", "deadbeef", { deleted: true, deletedAt: "2026-10-10T00:00:00.000Z" })]);
    addNote(f, "note-a", "edited after remote delete");

    const outcome = await pushQuickNote(cfg, s3, f.port, "note-a");

    expect(outcome.status).toBe("full-sync");
    if (outcome.status !== "full-sync") throw new Error("unreachable");
    expect(outcome.reason).toBe("remote-deleted");
    // 不允许把远端墓碑改回 active
    expect(readManifest(s3).items.find((i) => i.id === "note-a")?.deleted).toBe(true);
  });

  it("图片按内容哈希补传，已同 hash 的不重复上传", async () => {
    const s3 = createFakeS3();
    const f = createFakePort();
    const kept: QuickNoteSyncItemImage = { id: "img-1", filename: "kept.png", mimeType: "image/png", width: 1, height: 1, size: 4, hash: sha256Sync(bytesOf("kept")) };
    const fresh: QuickNoteSyncItemImage = { id: "img-2", filename: "fresh.png", mimeType: "image/png", width: 1, height: 1, size: 4, hash: sha256Sync(bytesOf("new!")) };
    seedManifest(s3, [remoteItem("note-a", sha256Sync(bytesOf("body")), { assets: [kept] })]);
    addNote(f, "note-a", "body", [kept, fresh]);
    f.assets.set("note-a/kept.png", bytesOf("kept"));
    f.assets.set("note-a/fresh.png", bytesOf("new!"));
    s3.puts.length = 0;

    const outcome = await pushQuickNote(cfg, s3, f.port, "note-a");

    expect(outcome).toMatchObject({ status: "pushed", uploadedAssets: 1, uploadedContent: false });
    expect(s3.puts).toEqual([`${cfg.prefix}/quick-notes/assets/note-a/fresh.png`, manifestKey]);
  });

  it("本地没有这条 ⇒ not-found（不写任何对象）", async () => {
    const s3 = createFakeS3();
    const f = createFakePort();
    s3.puts.length = 0;
    const outcome = await pushQuickNote(cfg, s3, f.port, "missing");
    expect(outcome.status).toBe("not-found");
    expect(s3.puts).toHaveLength(0);
  });

  // 高优先域的"推送后回核"守的就是这一条：单条推送与整轮同步**可并行**（不同互斥域），
  // 整轮同步若拿"读到本地清单快照"之后的旧快照落地，会把刚推的条目覆盖掉 —— 回核（再推一次）必须补回来。
  it("并发防覆盖：整轮同步用旧快照覆盖后，回核能把这一条补回来且不扰动其他条目", async () => {
    const s3 = createFakeS3();
    const f = createFakePort();
    const otherActive = remoteItem("note-other", sha256Sync(bytesOf("other")));
    const otherTomb = remoteItem("note-gone", "deadbeef", { deleted: true, deletedAt: "2026-10-10T00:00:00.000Z" });
    const snapshot = [otherActive, otherTomb]; // ← 整轮同步在"我们保存之前"读到的本地快照
    seedManifest(s3, snapshot, "sync-snapshot");
    addNote(f, "note-target", "fresh");

    // ① 用户点「保存并同步」：条目进了云端清单
    await pushQuickNote(cfg, s3, f.port, "note-target");
    expect(readManifest(s3).items.some((i) => i.id === "note-target")).toBe(true);

    // ② 在途的整轮同步随后用它的旧快照落地 ⇒ 覆盖掉刚推的条目（这就是要兜的竞态）
    seedManifest(s3, snapshot, "sync-stale-write");
    expect(readManifest(s3).items.some((i) => i.id === "note-target")).toBe(false);

    // ③ 回核 = 再推一次（幂等）：条目补回来，其他条目仍逐字节不变
    const repair = await pushQuickNote(cfg, s3, f.port, "note-target");
    expect(repair.status).toBe("pushed");
    const after = readManifest(s3);
    expect(after.items.some((i) => i.id === "note-target")).toBe(true);
    expect(JSON.stringify(after.items.filter((i) => i.id !== "note-target"))).toBe(JSON.stringify(snapshot));
  });

  it("记账：setBaseHash + markSyncedIfUnchanged(期望 hash)（I2 守卫必须走到）", async () => {
    const s3 = createFakeS3();
    const f = createFakePort();
    seedManifest(s3, [remoteItem("note-a", sha256Sync(bytesOf("old")))]);
    addNote(f, "note-a", "new");
    const expected = sha256Sync(bytesOf("new"));

    await pushQuickNote(cfg, s3, f.port, "note-a");

    expect(f.bases.get("note-a")).toBe(expected);
    expect(f.syncedCalls).toEqual([{ id: "note-a", expected }]);
  });
});
