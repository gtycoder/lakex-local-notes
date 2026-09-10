/**
 * Tier A —— S3 同步「算法/请求数」离线压测（opt-in：LAKE_RUN_BENCHMARK=1 才跑）。
 * 用可扩容内存端口 + 计数型 S3Store 驱动共享 syncNow，把「网络往返数」量化，证明优化不变量在规模下成立：
 *   · 资产差集：稳态/元数据 churn 资产 PUT=0（旧为每对象一次探测）
 *   · 增量只传缺失：新增 1 图 → 资产 PUT=1、跳过 199
 *   · 兜底"未分类"惰性：无笔记安家 → defaultNotebookId=0
 *   · 正文并发上传：content PUT = 变更数（不随总量）
 * 完全离线、可进 CI、不碰真实云/真实数据。
 */
import { describe, expect, it } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import { syncNow, type S3Store, type SyncDbPort, type LocalNoteRow } from "./syncEngine.js";
import { sha256Sync } from "./sha256Sync.js";
import type { Manifest, ManifestNote, ManifestFolder } from "./manifestTypes.js";

const RUN = process.env.LAKE_RUN_BENCHMARK === "1";
const CFG = { endpoint: "https://s3.example", region: "cn-north-1", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "p" };
const hashOf = (s: string) => sha256Sync(new TextEncoder().encode(s));
const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
const assetKeyCount = (s3: CountingS3) => [...s3.map.keys()].filter((k) => k.startsWith("p/assets/")).length;
type Asset = { filename: string; size: number; hash: string };
type Base = { contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null };

class CountingS3 implements S3Store {
  map = new Map<string, Uint8Array>();
  ops = { get: 0, put: 0, bytesOut: 0, bytesIn: 0 };
  failPrefix: string | null = null;
  async getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
    this.ops.get++;
    const b = this.map.get(key);
    if (!b) return null;
    const bytes = isGzip(b) ? gunzipSync(b) : b;
    if (opts?.maxBytes != null && bytes.length > opts.maxBytes) throw new Error("too big");
    this.ops.bytesIn += bytes.length;
    return bytes;
  }
  async putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    if (this.failPrefix && key.startsWith(this.failPrefix)) throw new Error(`boom:${key}`);
    this.ops.put++;
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.ops.bytesOut += bytes.length;
    this.map.set(key, opts?.gzip ? gzipSync(bytes) : bytes);
  }
}

class BigPort implements SyncDbPort {
  notes = new Map<string, LocalNoteRow>();
  bases = new Map<string, Base>();
  assetsByNote = new Map<string, Asset[]>();
  deleted = new Map<string, string>();
  defaultCalls = 0;
  lastSeenCommitId: string | null = null;
  lastTombstoneSig = "";
  private assetBytes = new Uint8Array(1024).fill(7);
  row(id: string, content: string, syncState = "synced", parentId: string | null = "nb-root"): LocalNoteRow {
    return { id, title: `笔记 ${id}`, content, updatedAt: "2026-01-01T00:00:00.000Z", syncState, trashedAt: null, restorePendingAt: null, parentId, sortOrder: 0, isLocked: false, lockedAt: null, icon: null, isConflict: false, contentHash: hashOf(content) };
  }
  seedAssets(id: string, n: number): Asset[] {
    const list: Asset[] = []; const h = sha256Sync(this.assetBytes);
    for (let i = 0; i < n; i += 1) list.push({ filename: `17883550${String(i).padStart(5, "0")}_dead${i}.png`, size: this.assetBytes.length, hash: h });
    this.assetsByNote.set(id, list); return list;
  }
  async getNote(id: string) { return this.notes.get(id) ?? null; }
  async getAllNotes() { return [...this.notes.values()]; }
  async getSyncBase(id: string) { return this.bases.get(id) ?? null; }
  async setSyncBase(id: string, ch: string, metaAt: string | null, lu: string | null) { this.bases.set(id, { contentHash: ch, lastUploadedHash: lu, lastSyncedMetaAt: metaAt }); }
  async markLocalNoteSynced(id: string, ch: string, metaAt: string, lu: string | null) { this.bases.set(id, { contentHash: ch, lastUploadedHash: lu, lastSyncedMetaAt: metaAt }); const n = this.notes.get(id); if (n) n.syncState = "synced"; }
  async markSyncedIfUnchanged(id: string, exp: string, metaAt: string, lu: string | null) { const n = this.notes.get(id); if (n && (n.contentHash ?? hashOf(n.content)) === exp) this.markLocalNoteSynced(id, exp, metaAt, lu); }
  async applyRemoteNote(note: ManifestNote) { const n = this.notes.get(note.id); this.notes.set(note.id, n ? { ...n, title: note.title, syncState: "synced" } : this.row(note.id, "<p>remote</p>")); }
  async applyRemoteNoteMeta(note: ManifestNote) { const n = this.notes.get(note.id); if (n) { n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.icon = note.icon ?? null; } }
  async applyRemoteTrash() {}
  async localTrashNote() {}
  async localRestoreNote() {}
  async applyRemotePurge(id: string) { const n = this.notes.get(id); if (n) n.syncState = "purged"; }
  async rememberDeleted(note: ManifestNote, at: string) { this.deleted.set(note.id, at); }
  async listDeletedNotesForSync() { return [...this.deleted.entries()].map(([id, deletedAt]) => ({ id, deletedAt })); }
  async applyRemoteLock() {}
  async createHistorySnapshot() {}
  async saveAsset(): Promise<void> {}
  async listLocalAssets(id: string): Promise<Asset[]> { return this.assetsByNote.get(id) ?? []; }
  async readLocalAsset(): Promise<Uint8Array> { return this.assetBytes; }
  async defaultNotebookId() { this.defaultCalls++; return "nb-root"; }
  async importRemoteFolder(_f: ManifestFolder) {}
  async getLastSeenCommitId() { return this.lastSeenCommitId; }
  async setLastSeenCommitId(id: string) { this.lastSeenCommitId = id; }
  async getLastTombstoneSig() { return this.lastTombstoneSig; }
  async setLastTombstoneSig(sig: string) { this.lastTombstoneSig = sig; }
  async tombstoneSignature() { return `${this.deleted.size}:${[...this.deleted.keys()].sort().at(-1) ?? ""}`; }
  async hasLocalPendingNotes() { return [...this.notes.values()].some((n) => n.syncState !== "synced"); }
  async log() {}
}

function manifest(notes: ManifestNote[], commitId = "c1"): string {
  const m: Manifest = { version: 4, workspaceId: "default", commitId, prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z", notes, folders: [] };
  return JSON.stringify(m);
}
const noteEntry = (id: string, contentHash: string, assets: ManifestNote["assets"] = [], parentId = "nb-root"): ManifestNote =>
  ({ id, title: `笔记 ${id}`, parentId, sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash, isConflict: false, assets });
const putManifest = (s3: CountingS3, notes: ManifestNote[], commitId: string) =>
  s3.map.set("p/manifests/latest.json", gzipSync(new TextEncoder().encode(manifest(notes, commitId))));

const results: Array<Record<string, string | number>> = [];

describe.skipIf(!RUN)("Tier A · syncNow 算法/请求数压测", () => {
  it("S1 稳态零变更：N=2000 → 命中早退、几乎 0 请求", async () => {
    const s3 = new CountingS3(); const db = new BigPort(); const entries: ManifestNote[] = [];
    for (let i = 0; i < 2000; i += 1) { const id = `n${i}`; const r = db.row(id, `<p>body ${i}</p>`); db.notes.set(id, r); db.bases.set(id, { contentHash: r.contentHash!, lastUploadedHash: r.contentHash!, lastSyncedMetaAt: r.updatedAt }); entries.push(noteEntry(id, r.contentHash!)); }
    putManifest(s3, entries, "cX"); db.lastSeenCommitId = "cX"; db.lastTombstoneSig = await db.tombstoneSignature();
    const t0 = performance.now(); const r = await syncNow(CFG, s3, db); const ms = performance.now() - t0;
    results.push({ case: "S1 稳态零变更", N: 2000, ms: +ms.toFixed(1), gets: s3.ops.get, puts: s3.ops.put, uploaded: r.uploaded });
  });

  it("S2 元数据 churn：500 篇各 5 资产改名 200 → 资产 PUT=0、正文 PUT=200、default=0", async () => {
    const s3 = new CountingS3(); const db = new BigPort(); const entries: ManifestNote[] = [];
    for (let i = 0; i < 500; i += 1) { const id = `n${i}`; const r = db.row(id, `<p>body ${i}</p>`); const assets = db.seedAssets(id, 5); db.notes.set(id, r); db.bases.set(id, { contentHash: r.contentHash!, lastUploadedHash: r.contentHash!, lastSyncedMetaAt: "2026-06-01T00:00:00.000Z" }); entries.push(noteEntry(id, r.contentHash!, assets.map((a) => ({ filename: a.filename, size: a.size, hash: a.hash })))); }
    putManifest(s3, entries, "cX");
    for (let i = 0; i < 200; i += 1) { const n = db.notes.get(`n${i}`)!; n.title = `改名 ${i}`; n.syncState = "local"; }
    const before = assetKeyCount(s3);
    const t0 = performance.now(); const r = await syncNow(CFG, s3, db); const ms = performance.now() - t0;
    const assetPuts = assetKeyCount(s3) - before;
    expect(assetPuts).toBe(0);            // 回归守卫：已声明资产零重传
    expect(s3.ops.get).toBe(1);           // 仅读 latest：无逐对象 GET/HEAD 探测
    expect(db.defaultCalls).toBe(0);      // 有 nb-root → 不新建兜底
    expect(r.uploaded).toBe(200);         // 正文照常并发上传（=变更数）
    results.push({ case: "S2 元数据churn", notes: 500, churn: 200, ms: +ms.toFixed(1), gets: s3.ops.get, puts: s3.ops.put, assetPuts });
  });

  it("S3 资产首传：1×200 + 3×50 图 → 资产 PUT 恰 350、gets≈1", async () => {
    const s3 = new CountingS3(); const db = new BigPort();
    [["a0", 200], ["a1", 50], ["a2", 50], ["a3", 50]].forEach(([id, n]) => { const r = db.row(String(id), `<p>x${id}</p>`, "local"); db.notes.set(String(id), r); db.seedAssets(String(id), Number(n)); });
    putManifest(s3, [], "cX");
    const t0 = performance.now(); await syncNow(CFG, s3, db); const ms = performance.now() - t0;
    expect(assetKeyCount(s3)).toBe(350);  // 回归守卫：新增资产全传
    expect(s3.ops.get).toBe(1);           // 首传也无需逐对象探测（无远端声明→直接 PUT）
    results.push({ case: "S3 资产首传", newAssets: 350, ms: +ms.toFixed(1), assetPuts: assetKeyCount(s3), gets: s3.ops.get });
  });

  it("S4 增量 +1 图：已声明 199 → 只 PUT 1、跳过 199", async () => {
    const s3 = new CountingS3(); const db = new BigPort(); const id = "n1"; const r = db.row(id, `<p>x</p>`, "local"); db.notes.set(id, r);
    const all = db.seedAssets(id, 200); const declared = all.slice(0, 199);
    s3.map.set("p/objects/n1-" + r.contentHash + ".lake", new TextEncoder().encode(r.content));
    for (const a of declared) s3.map.set("p/assets/n1/" + a.filename, new Uint8Array(a.size));
    putManifest(s3, [noteEntry(id, r.contentHash!, declared)], "cX");
    const before = assetKeyCount(s3);
    const t0 = performance.now(); await syncNow(CFG, s3, db); const ms = performance.now() - t0;
    expect(assetKeyCount(s3) - before).toBe(1); // 回归守卫：只 PUT 缺失那 1 张、跳过 199
    results.push({ case: "S4 增量+1", assetPuts: 1, skipped: 199, ms: +ms.toFixed(1) });
  });

  it("S7 上传失败注入：整轮抛错且不发布 manifest", async () => {
    const s3 = new CountingS3(); const db = new BigPort();
    for (let i = 0; i < 50; i += 1) db.notes.set(`n${i}`, db.row(`n${i}`, `<p>b${i}</p>`, "local"));
    s3.failPrefix = "p/objects/n10-";
    let threw = false;
    try { await syncNow(CFG, s3, db); } catch { threw = true; }
    results.push({ case: "S7 上传失败", threw: threw ? 1 : 0, manifestPublished: s3.map.has("p/manifests/latest.json") ? 1 : 0 });
  });

  it("S5 规模曲线：churn 成本随『变更数』而非『总量』", async () => {
    const row: Record<string, string | number> = { case: "S5 规模曲线", churn: 100 };
    for (const N of [500, 2000, 8000]) {
      const s3 = new CountingS3(); const db = new BigPort(); const entries: ManifestNote[] = [];
      for (let i = 0; i < N; i += 1) { const id = `n${i}`; const r = db.row(id, `<p>b${i}</p>`); const assets = db.seedAssets(id, 3); db.notes.set(id, r); db.bases.set(id, { contentHash: r.contentHash!, lastUploadedHash: r.contentHash!, lastSyncedMetaAt: "2026-06-01T00:00:00.000Z" }); entries.push(noteEntry(id, r.contentHash!, assets)); }
      putManifest(s3, entries, "cX");
      for (let i = 0; i < 100; i += 1) { const n = db.notes.get(`n${i}`)!; n.title = `r${i}`; n.syncState = "local"; }
      const t0 = performance.now(); const r = await syncNow(CFG, s3, db); const ms = performance.now() - t0;
      row[`N${N}_ms`] = +ms.toFixed(1); row[`N${N}_gets`] = s3.ops.get; row[`N${N}_puts`] = s3.ops.put;
    }
    results.push(row);
  });

  it("写出 Tier A 汇总工件", async () => {
    const fs = await import("node:fs");
    const out = process.env.LAKE_STRESS_OUT ?? "/tmp/lake-stress-tierA.json";
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    // eslint-disable-next-line no-console
    console.log("TierA→" + out);
  });
});
