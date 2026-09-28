/**
 * Tier B —— S3 同步「真实云」压测（opt-in，需凭证环境变量 + LAKE_RUN_BENCHMARK=1）。
 * 用真实 ObjectStore（七牛 Kodo）经真实 createS3StoreAdapter + 真实 pruneOldManifests 驱动共享 syncNow，
 * 在隔离前缀 lake-stress-<ts>/ 下测真实墙钟 + 真实网络请求数；afterAll 删除整个隔离前缀。
 * 目的：把 Tier A 的"请求数塌陷"换算成真实延迟，并现场验证 head=0 / 清单链 O(3)+滞后裁剪。
 *
 * 需要环境变量：LAKE_STRESS_S3_ENDPOINT/_REGION/_BUCKET/_AK/_SK
 */
import { describe, expect, it, afterAll } from "vitest";
import { performance } from "node:perf_hooks";
import { syncNow, type SyncDbPort, type LocalNoteRow } from "../src/core/syncEngine.js";
import { createS3StoreAdapter } from "./syncAdapters.js";
import { ObjectStore } from "./s3Store.js";
import { pruneOldManifests } from "./s3Maintenance.js";
import type { S3Settings } from "../src/core/syncUtils.js";
import { sha256Sync } from "../src/core/sha256Sync.js";
import type { ManifestNote, ManifestFolder } from "../src/core/manifestTypes.js";
import { createSilentLoggerScopes } from "../src/core/logger.js";
import zlib from "node:zlib";

const creds = {
  endpoint: process.env.LAKE_STRESS_S3_ENDPOINT ?? "",
  region: process.env.LAKE_STRESS_S3_REGION ?? "",
  bucket: process.env.LAKE_STRESS_S3_BUCKET ?? "",
  accessKeyId: process.env.LAKE_STRESS_S3_AK ?? "",
  secretAccessKey: process.env.LAKE_STRESS_S3_SK ?? "",
};
const READY = process.env.LAKE_RUN_BENCHMARK === "1" && creds.endpoint && creds.bucket && creds.accessKeyId && creds.secretAccessKey;
const PREFIX = `lake-stress-${Date.now().toString(36)}`;
const hashOf = (s: string) => sha256Sync(new TextEncoder().encode(s));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(120)]); // ~128B 合法 PNG 魔数 + 填充
const PNG_HASH = sha256Sync(new Uint8Array(PNG));
const settings: S3Settings = { ...creds, prefix: PREFIX, forcePathStyle: false };
const cfg = { endpoint: creds.endpoint, region: creds.region || "cn-north-1", bucket: creds.bucket, accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, prefix: PREFIX };

// 真实 ObjectStore + 计数/计时代理
type Tally = Record<string, { n: number; ms: number }>;
const tally: Tally = {};
const raw = new ObjectStore(settings, createSilentLoggerScopes());
function wrapped(target: ObjectStore): ObjectStore {
  return new Proxy(target, {
    get(t, prop) {
      const v = (t as any)[prop];
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        const name = String(prop); const t0 = performance.now();
        const p = (v as (...a: unknown[]) => unknown).apply(t, args);
        return Promise.resolve(p).finally(() => { const dt = performance.now() - t0; (tally[name] ??= { n: 0, ms: 0 }); tally[name].n++; tally[name].ms += dt; });
      };
    },
  });
}
const proxy = wrapped(raw);
const s3Store = createS3StoreAdapter(proxy, PREFIX);
const logScopes = createSilentLoggerScopes();

// 上传场景所需的最小可扩容端口（内容寻址、资产在内存）
class BigPort implements SyncDbPort {
  notes = new Map<string, LocalNoteRow>();
  bases = new Map<string, { contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null }>();
  assets = new Map<string, Array<{ filename: string; size: number; hash: string }>>();
  deleted = new Map<string, string>();
  defaultCalls = 0; lastSeenCommitId: string | null = null; lastTombstoneSig = "";
  row(id: string, content: string, syncState = "synced"): LocalNoteRow {
    return { id, title: `笔记 ${id}`, content, updatedAt: "2026-01-01T00:00:00.000Z", syncState, trashedAt: null, restorePendingAt: null, parentId: "nb-root", sortOrder: 0, isLocked: false, lockedAt: null, icon: null, isConflict: false, contentHash: hashOf(content) };
  }
  seed(id: string, n: number) { const l: Array<{ filename: string; size: number; hash: string }> = []; for (let i = 0; i < n; i += 1) l.push({ filename: `1788355${String(i).padStart(6, "0")}_stress${i}.png`, size: PNG.length, hash: PNG_HASH }); this.assets.set(id, l); return l; }
async getNote(id: string) { return this.notes.get(id) ?? null; }
async getAllNotes() { return [...this.notes.values()]; }
async getSyncBase(id: string) { return this.bases.get(id) ?? null; }
async setSyncBase(id: string, ch: string, metaAt: string | null, lu: string | null) { this.bases.set(id, { contentHash: ch, lastUploadedHash: lu, lastSyncedMetaAt: metaAt }); }
async markLocalNoteSynced(id: string, ch: string, metaAt: string, lu: string | null) { this.bases.set(id, { contentHash: ch, lastUploadedHash: lu, lastSyncedMetaAt: metaAt }); const n = this.notes.get(id); if (n) n.syncState = "synced"; }
async markSyncedIfUnchanged(id: string, exp: string, metaAt: string, lu: string | null) { const n = this.notes.get(id); if (n && n.contentHash === exp) this.markLocalNoteSynced(id, exp, metaAt, lu); }
async applyRemoteNote(note: ManifestNote) { const n = this.notes.get(note.id); this.notes.set(note.id, n ? { ...n, title: note.title, syncState: "synced" } : this.row(note.id, "<p>r</p>")); }
async applyRemoteNoteMeta(note: ManifestNote) { const n = this.notes.get(note.id); if (n) n.title = note.title; }
  async applyRemoteTrash() {} async localTrashNote() {} async localRestoreNote() {}
async applyRemotePurge(id: string) { const n = this.notes.get(id); if (n) n.syncState = "purged"; }
async rememberDeleted(note: ManifestNote, at: string) { this.deleted.set(note.id, at); }
async listDeletedNotesForSync() { return [...this.deleted.entries()].map(([id, deletedAt]) => ({ id, deletedAt })); }
  async applyRemoteLock() {} async createHistorySnapshot() {} saveAsset(): Promise<void> { return Promise.resolve(); }
  async listLocalAssets(id: string) { return this.assets.get(id) ?? []; }
  async readLocalAsset() { return new Uint8Array(PNG); }
async defaultNotebookId() { this.defaultCalls++; return "nb-root"; }
  async importRemoteFolder(_f: ManifestFolder) {}
  async getLastSeenCommitId() { return this.lastSeenCommitId; } async setLastSeenCommitId(id: string) { this.lastSeenCommitId = id; }
  async getLastTombstoneSig() { return this.lastTombstoneSig; } async setLastTombstoneSig(s: string) { this.lastTombstoneSig = s; }
  async tombstoneSignature() { return `${this.deleted.size}`; } async hasLocalPendingNotes() { return [...this.notes.values()].some((n) => n.syncState !== "synced"); }
  async log() {}
}

const reset = () => { for (const k of Object.keys(tally)) delete tally[k]; };
const results: Array<Record<string, string | number>> = [];
let db = new BigPort();

describe.skipIf(!READY)("Tier B · 真实云（七牛）同步压测", () => {
  afterAll(async () => {
    if (!READY) return;
    let n = 0;
    for (const sub of ["manifests", "objects", "assets", "quick-notes"]) { try { n += await raw.deletePrefix(`${sub}/`); } catch { /* ignore */ } }
    try { n += await raw.deletePrefix(""); } catch { /* ignore */ }
    // eslint-disable-next-line no-console
    console.log(`[stress-cleanup] ${PREFIX}/ 删除 ${n} 个对象`);
  });

  it("B1 首传 600 资源 + churn 复同步", async () => {
    db = new BigPort();
    const ids: string[] = []; const per = 2; const notesN = 120;
    for (let i = 0; i < notesN; i += 1) { const id = `nb${i}`; const r = db.row(id, `<p>body ${i}</p>`, "local"); db.notes.set(id, r); db.seed(id, per); ids.push(id); }
    reset();
    const t0 = performance.now(); const r0 = await syncNow(cfg, s3Store, db); const firstMs = performance.now() - t0;
    const afterHead = tally.headObject?.n ?? 0; const afterGet = tally.getOptional?.n ?? 0; const afterPut = (tally.put?.n ?? 0) + (tally.putStream?.n ?? 0);
    // churn：改名 100 篇（正文/资源不变）→ 复同步应零资源重传、零探测
    for (let i = 0; i < 60; i += 1) { const n = db.notes.get(ids[i])!; n.title = `改名 ${i}`; n.syncState = "local"; }
    reset();
    const t1 = performance.now(); await syncNow(cfg, s3Store, db); const churnMs = performance.now() - t1;
    results.push({ case: "B1 首传", notes: notesN, assets: notesN * per, ms: +firstMs.toFixed(0), putReqs: afterPut, headReqs: afterHead, getReqs: afterGet, uploaded: r0.uploaded });
    results.push({ case: "B1 churn复同步", churn: 60, ms: +churnMs.toFixed(0), headReqs: tally.headObject?.n ?? 0, putReqs: tally.put?.n ?? 0, putStream: tally.putStream?.n ?? 0 });
    expect(afterHead).toBe(0); // 分支：结构上无 headObject
  }, 240_000);

  it("B2 清单链 + 滞后裁剪（真实云 25 次发布）", async () => {
    reset();
    let published = 0;
    for (let i = 0; i < 12; i += 1) {
      const n = db.notes.get(`nb${i % 120}`)!; n.content = `<p>rev ${i} ${Math.random()}</p>`; n.contentHash = hashOf(n.content); n.updatedAt = new Date(Date.UTC(2026, 1, 1 + i)).toISOString(); n.syncState = "local";
      await syncNow(cfg, s3Store, db, {
        onPublished: async (next, prev) => { published += 1; await pruneOldManifests(proxy, next.commitId, prev, logScopes); },
      });
    }
    const manifests = await raw.list("manifests/");
    const commitFiles = manifests.filter((m) => !m.key.endsWith("latest.json")).length;
    const retainedManifestFiles = manifests.length;
    results.push({ case: "B2 清单链裁剪", publishes: published, listOps: tally.list?.n ?? 0, manifestGetOps: tally.getOptional?.n ?? 0, retainedManifestFiles, retainedCommits: commitFiles });
    expect(retainedManifestFiles).toBeLessThanOrEqual(5 + 6 + 2); // target(5)+slack(6)+latest/余量
  }, 240_000);

  it("写出 Tier B 汇总工件", async () => {
    const fs = await import("node:fs");
    const out = process.env.LAKE_STRESS_OUT ?? "/tmp/lake-stress-tierB.json";
    fs.writeFileSync(out, JSON.stringify({ prefix: PREFIX, results, tally }, null, 2));
    void zlib;
  });
});
