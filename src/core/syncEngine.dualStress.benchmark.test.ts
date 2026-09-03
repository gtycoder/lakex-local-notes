/**
 * Tier C —— 双端 A/B 冲突与规模压力（opt-in：LAKE_RUN_BENCHMARK=1）。纯内存、确定性、可进 CI、零网络。
 * 严格建模产品使用原则（用户 2026-09-03 明确）：
 *   · 本地优先 + 云端备份；个人笔记多端但【无并发写】（定时同步 → 同步串行发生，本测也串行跑 A→B→A）
 *   · 冲突【先提交者为真】（先落到云端清单者胜），迟者【不解决冲突、用历史快照留档】并跟随远端
 *   · 回收站 = 【有笔记本行为的容器】（软删=移动，非 deleted:true；跨端传播为普通节点）
 * 规模：多篇带资源首传（含 P3-4 跨笔记并发）、K 篇双端真冲突、D 篇删除→回收站传播/恢复。
 */
import { describe, expect, it } from "vitest";
import { gzipSync, gunzipSync } from "node:zlib";
import { syncNow, type S3Store, type SyncDbPort, type LocalNoteRow } from "./syncEngine.js";
import { sha256Sync } from "./sha256Sync.js";
import { TRASH_NOTEBOOK_ID } from "./syncDecisions.js";
import type { Manifest, ManifestNote, ManifestFolder } from "./manifestTypes.js";

const RUN = process.env.LAKE_RUN_BENCHMARK === "1";
const CFG = { endpoint: "e", region: "cn-north-1", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "p" };
const hashOf = (s: string) => sha256Sync(new TextEncoder().encode(s));
const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

class SharedS3 implements S3Store {
  map = new Map<string, Uint8Array>();
  ops = { get: 0, put: 0 };
  async getObject(key: string): Promise<Uint8Array | null> {
    this.ops.get++;
    const b = this.map.get(key);
    if (!b) return null;
    return isGzip(b) ? gunzipSync(b) : b;
  }
  async putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    this.ops.put++;
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.map.set(key, opts?.gzip ? gzipSync(bytes) : bytes);
  }
}

class Port implements SyncDbPort {
  notes = new Map<string, LocalNoteRow>();
  bases = new Map<string, { contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null }>();
  assets = new Map<string, Array<{ filename: string; size: number; hash: string }>>();
  folders = new Map<string, ManifestFolder>();
  deleted = new Map<string, string>();
  history: Array<{ noteId: string; content: string }> = [];
  lastSeenCommitId: string | null = null;
  lastTombstoneSig = "";
  private asset = new Uint8Array(256).fill(9);
  private assetHash = sha256Sync(this.asset);
  create(id: string, content: string, withAsset = false): LocalNoteRow {
    const n: LocalNoteRow = { id, title: `笔记 ${id}`, content, updatedAt: "2026-01-01T00:00:00.000Z", syncState: "local", trashedAt: null, restorePendingAt: null, parentId: "nb-main", sortOrder: 0, isLocked: false, lockedAt: null, icon: null, isConflict: false, contentHash: hashOf(content) };
    this.notes.set(id, n);
    if (withAsset) this.assets.set(id, [{ filename: `17883560${id.replace(/\D/g, "").padStart(4, "0")}_c0ffee.png`, size: this.asset.length, hash: this.assetHash }]);
    return n;
  }
  edit(id: string, content: string, at: string) { const n = this.notes.get(id)!; n.content = content; n.contentHash = hashOf(content); n.updatedAt = at; n.syncState = "local"; }
  trash(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = "2026-03-01T00:00:00.000Z"; n.syncState = "local"; } }
  restore(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = null; n.restorePendingAt = "2026-03-05T00:00:00.000Z"; n.updatedAt = "2026-03-05T00:00:00.000Z"; n.syncState = "local"; } }
  content(id: string) { return this.notes.get(id)?.content ?? null; }
  synced() { return this.notes.size > 0 && [...this.notes.values()].every((n) => n.syncState === "synced"); }
  getNote(id: string): LocalNoteRow | null { return this.notes.get(id) ?? null; }
  getAllNotes(): LocalNoteRow[] { return [...this.notes.values()]; }
  getSyncBase(id: string) { return this.bases.get(id) ?? null; }
  setSyncBase(id: string, ch: string, metaAt: string | null, lu: string | null) { this.bases.set(id, { contentHash: ch, lastUploadedHash: lu, lastSyncedMetaAt: metaAt }); }
  markLocalNoteSynced(id: string, ch: string, metaAt: string, lu: string | null) { this.bases.set(id, { contentHash: ch, lastUploadedHash: lu, lastSyncedMetaAt: metaAt }); const n = this.notes.get(id); if (n) n.syncState = "synced"; }
  markSyncedIfUnchanged(id: string, exp: string, metaAt: string, lu: string | null) { const n = this.notes.get(id); if (n && n.contentHash === exp) { n.syncState = "synced"; this.bases.set(id, { contentHash: exp, lastUploadedHash: lu, lastSyncedMetaAt: metaAt }); } }
  applyRemoteNote(note: ManifestNote, content: string) { const ex = this.notes.get(note.id); const row: LocalNoteRow = { id: note.id, title: note.title, content, updatedAt: note.updatedAt, syncState: "synced", trashedAt: note.trashedAt ?? null, restorePendingAt: null, parentId: note.parentId ?? null, sortOrder: note.sortOrder ?? 0, isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null, isConflict: !!note.isConflict, contentHash: note.contentHash }; this.notes.set(note.id, row); if (ex) this.bases.set(note.id, { contentHash: note.contentHash, lastUploadedHash: null, lastSyncedMetaAt: note.updatedAt }); else this.bases.set(note.id, { contentHash: note.contentHash, lastUploadedHash: null, lastSyncedMetaAt: note.updatedAt }); }
  applyRemoteNoteMeta(note: ManifestNote) { const n = this.notes.get(note.id); if (n) { n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = !!note.isConflict; n.icon = note.icon ?? null; n.isLocked = !!note.isLocked; n.lockedAt = note.lockedAt ?? null; } }
  applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, _dfp: string | null, parentId: string | null, sortOrder: number) { const n: LocalNoteRow = { id, title, content, updatedAt: trashedAt, syncState: "synced", trashedAt, restorePendingAt: null, parentId, sortOrder, isLocked: false, lockedAt: null, icon: null, isConflict: false, contentHash: hashOf(content) }; this.notes.set(id, n); this.bases.set(id, { contentHash: n.contentHash!, lastUploadedHash: null, lastSyncedMetaAt: trashedAt }); }
  localTrashNote(id: string) { this.trash(id); }
  localRestoreNote(id: string) { this.restore(id); }
  applyRemotePurge(id: string) { const n = this.notes.get(id); if (n) { n.syncState = "purged"; n.parentId = TRASH_NOTEBOOK_ID; n.trashedAt = "2026-03-01T00:00:00.000Z"; } }
  rememberDeleted(note: ManifestNote, at: string) { this.deleted.set(note.id, at); }
  listDeletedNotesForSync() { return [...this.deleted.entries()].map(([id, deletedAt]) => ({ id, deletedAt })); }
  applyRemoteLock(id: string, locked: boolean, at: string | null) { const n = this.notes.get(id); if (n) { n.isLocked = locked; n.lockedAt = at; } }
  createHistorySnapshot(noteId: string, content: string) { this.history.push({ noteId, content }); }
  saveAsset(): Promise<void> { return Promise.resolve(); }
  async listLocalAssets(id: string) { return this.assets.get(id) ?? []; }
  async readLocalAsset() { return this.asset; }
  defaultNotebookId() { return "nb-main"; }
  importRemoteFolder(f: ManifestFolder) { this.folders.set(f.id, f); }
  listFoldersForSync() { return [...this.folders.values()].filter((f) => f.id !== TRASH_NOTEBOOK_ID).map((f) => ({ id: f.id, title: f.title, parentId: f.parentId, sortOrder: f.sortOrder, nodeType: f.nodeType, icon: f.icon, updatedAt: f.updatedAt })); }
  getLastSeenCommitId(): string | null { return this.lastSeenCommitId; } setLastSeenCommitId(id: string) { this.lastSeenCommitId = id; }
  getLastTombstoneSig(): string { return this.lastTombstoneSig; } setLastTombstoneSig(s: string) { this.lastTombstoneSig = s; }
  tombstoneSignature(): string { return `${this.deleted.size}:${[...this.deleted.keys()].sort().at(-1) ?? ""}`; }
  hasLocalPendingNotes(): boolean { return [...this.notes.values()].some((n) => n.syncState !== "synced"); }
  log() {}
}

function manifest(notes: ManifestNote[]): string {
  const m: Manifest = { version: 4, workspaceId: "default", commitId: "c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z", notes, folders: [{ id: "nb-main", title: "主", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" }] };
  return JSON.stringify(m);
}
const results: Array<Record<string, string | number>> = [];

describe.skipIf(!RUN)("Tier C · 双端冲突/规模压力", () => {
  it("C1 双端 disjoint 收敛 + 大量带资源首传（P3-4 跨笔记并发）", async () => {
    const s3 = new SharedS3(); const A = new Port(); const B = new Port();
    const N = 2000;
    for (let i = 0; i < N; i += 1) A.create(`a${i}`, `<p>A${i}</p>`, i % 2 === 0); // 一半带资源
    for (let i = 0; i < N; i += 1) B.create(`b${i}`, `<p>B${i}</p>`, i % 2 === 0);
    A.folders.set("nb-main", { id: "nb-main", title: "主", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    B.folders.set("nb-main", { id: "nb-main", title: "主", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    const t0 = performance.now(); await syncNow(CFG, s3, A); const aMs = performance.now() - t0;
    const t1 = performance.now(); await syncNow(CFG, s3, B); const bMs = performance.now() - t1;
    await syncNow(CFG, s3, A);
    // 收敛：两端都应有 2N 篇，内容一致
    expect(A.notes.size).toBe(2 * N); expect(B.notes.size).toBe(2 * N);
    for (const id of ["a0", "a10", "b0", "b10"]) expect(A.content(id)).toBe(B.content(id));
    expect(A.synced() && B.synced()).toBe(true);
    results.push({ case: "C1 双端收敛+首传", notes: 2 * N, assets: N, A_first_sync_ms: +aMs.toFixed(1), B_sync_ms: +bMs.toFixed(1), puts: s3.ops.put, gets: s3.ops.get });
  }, 120_000);

  it("C2 K 篇双端真冲突：A 先提交=胜，B 迟同步被 superseded→历史快照", async () => {
    const s3 = new SharedS3(); const A = new Port(); const B = new Port();
    const K = 600;
    for (let i = 0; i < K; i += 1) { const c = `<p>seed${i}</p>`; A.create(`d${i}`, c); B.create(`d${i}`, c); }
    A.folders.set("nb-main", { id: "nb-main", title: "主", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    await syncNow(CFG, s3, A); await syncNow(CFG, s3, B); // 基线：两端一致已同步
    // 双端分叉：A 先改先提交，B 也改（未同步）
    for (let i = 0; i < K; i += 1) A.edit(`d${i}`, `<p>A版${i}</p>`, "2026-02-01T00:00:00.000Z");
    for (let i = 0; i < K; i += 1) B.edit(`d${i}`, `<p>B版${i}</p>`, "2026-02-02T00:00:00.000Z");
    await syncNow(CFG, s3, A);           // A 先提交 → 云端 = A版
    const rB = await syncNow(CFG, s3, B); // B 迟同步 → 跟随远端(A)，本地 B版 留档
    expect(rB.supersededNotes.length).toBe(K);          // 不解决冲突：K 篇被覆盖
    expect(B.history.length).toBeGreaterThanOrEqual(K); // 每篇留历史快照
    for (let i = 0; i < K; i += 1) expect(B.content(`d${i}`)).toBe(`<p>A版${i}</p>`); // 先提交者(A)为真
    // B 的历史里应能找到它被覆盖的 B版
    expect(B.history.some((h) => h.content === `<p>B版0</p>`)).toBe(true);
    results.push({ case: "C2 双端冲突", K, superseded: rB.supersededNotes.length, historySnapshots: B.history.length, winner: "A(先提交)" });
  }, 120_000);

  it("C3 D 篇删除→回收站容器跨端传播 + 部分恢复", async () => {
    const s3 = new SharedS3(); const A = new Port(); const B = new Port();
    const D = 1000;
    for (let i = 0; i < D; i += 1) { const c = `<p>doc${i}</p>`; A.create(`t${i}`, c); B.create(`t${i}`, c); }
    A.folders.set("nb-main", { id: "nb-main", title: "主", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    await syncNow(CFG, s3, A); await syncNow(CFG, s3, B);
    for (let i = 0; i < D; i += 1) A.trash(`t${i}`); // A 把 D 篇移入回收站（笔记本容器）
    await syncNow(CFG, s3, A);
    const rB = await syncNow(CFG, s3, B);            // B 跟随：D 篇进回收站（非硬删）
    const trashedInB = [...B.notes.values()].filter((n) => n.trashedAt != null).length;
    expect(trashedInB).toBe(D);
    // 回收站是容器：软删条目 parentId=TRASH，非 deleted:true（B 端仍持有内容可恢复）
    expect(B.content("t0")).toBe(`<p>doc0</p>`);
    // B 恢复 1 篇 → 走 active 覆盖墓碑传播
    B.restore("t0"); await syncNow(CFG, s3, B); await syncNow(CFG, s3, A);
    expect(A.notes.get("t0")!.trashedAt).toBeNull();
    void rB;
    results.push({ case: "C3 回收站容器传播", D, trashedInB, restored: "t0(回 active)" });
  }, 120_000);

  it("写出 Tier C 汇总工件", async () => {
    const fs = await import("node:fs");
    fs.writeFileSync(process.env.LAKE_STRESS_OUT ?? "/tmp/lake-stress-tierC.json", JSON.stringify(results, null, 2));
  });
});
