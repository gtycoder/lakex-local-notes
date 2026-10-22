/**
 * Step 4 等价测试：桌面 sync.ts vs 共享 syncEngine（SHARED-SYNC-PLAN §Step 4）。
 *
 * 目的：证明两端编排在**同一场景输入**下产生**语义等价的终态**（发布 manifest + 本地状态），
 * 为桌面收敛到 syncEngine（Step 5）提供安全网。
 *
 * 方法：每个场景 = 共享输入（远端 manifest + 本地初始状态），分别驱动
 *   A) 桌面：真实 Store + MockS3（ObjectStore）→ syncNow
 *   B) 引擎：MemDb + MemS3（S3Store）→ syncEngine.syncNow
 * 比较：latest manifest 的语义字段（id/title/parentId/sortOrder/trashedAt/deleted/assets/folders）
 *   + 本地终态（syncState/trashedAt/parentId）。updatedAt/contentHash 忽略（时间戳/实现差异）。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { syncNowViaEngine as desktopSync } from "./syncEngineController.js";
import type { ObjectStore } from "./s3Store.js";
import type { S3Settings } from "../src/core/syncUtils.js";
import { syncNow as engineSync, type S3Store, type SyncConfig, type SyncDbPort, type LocalNoteRow } from "../src/core/syncEngine.js";
import { sha256Sync } from "../src/core/sha256Sync.js";
import { isGzip } from "../src/core/syncUtils.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";

const decode = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);

// ===== 共享场景输入 =====
interface ScenarioNote {
  id: string; title: string; content: string;
  parentId?: string | null; sortOrder?: number; updatedAt?: string;
  syncState?: string; trashedAt?: string | null; restorePendingAt?: string | null;
  isLocked?: boolean; lockedAt?: string | null; icon?: string | null;
}
interface Scenario {
  name: string;
  /** 本地初始状态（两端同构构造） */
  localNotes: ScenarioNote[];
  /** 远端最新 manifest 的 notes（空 = 首次同步无远端） */
  remoteNotes?: Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; contentHash: string; trashedAt?: string; deleted?: boolean; deletedAt?: string; deletedFromParentId?: string | null; isLocked?: boolean; lockedAt?: string | null; icon?: string | null; assets?: Array<{ filename: string; size: number; hash: string }> }>;
  remoteFolders?: Array<{ id: string; title: string; parentId: string | null; sortOrder: number; nodeType: string; icon: string | null; updatedAt: string }>;
  /** 远端对象（正文）: key -> bytes */
  remoteObjects?: Record<string, Uint8Array>;
}

// ===== 语义归一化（比较基准） =====
interface ManifestSemantic {
  notes: Array<{ id: string; title: string; parentId: string | null; sortOrder: number; trashedAt: boolean; deleted: boolean; isLocked: boolean; icon: string | null; assets: number }>;
  folders: Array<{ id: string; title: string; parentId: string | null; nodeType: string }>;
}
function semanticManifest(m: any): ManifestSemantic {
  const notes = [...(m.notes ?? [])]
    .map((n: any) => ({
      id: n.id, title: n.title, parentId: n.parentId ?? null, sortOrder: n.sortOrder ?? 0,
      trashedAt: n.trashedAt != null, deleted: n.deleted === true,
      isLocked: !!n.isLocked, icon: n.icon ?? null, assets: (n.assets ?? []).length,
    }))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));
  const folders = [...(m.folders ?? [])]
    .map((f: any) => ({ id: f.id, title: f.title, parentId: f.parentId ?? null, nodeType: f.nodeType }))
    .sort((a: any, b: any) => a.id.localeCompare(b.id));
  return { notes, folders };
}

// ===== A) 桌面侧 =====
const S3_CFG: S3Settings = {
  endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "test-bucket",
  prefix: "local-lakex-notes", accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: false,
};
class MockS3 {
  map = new Map<string, Buffer>();
  async test(): Promise<void> {}
  async getOptional(key: string, opts?: { maxBytes?: number }): Promise<Buffer | null> {
    let b = this.map.get(key);
    if (!b) return null;
    if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
    if (opts?.maxBytes && b.length > opts.maxBytes) return null;
    return b;
  }
  async put(key: string, bytes: Buffer, _ct: string, opts?: { gzip?: boolean }): Promise<void> {
    this.map.set(key, opts?.gzip ? zlib.gzipSync(bytes) : bytes);
  }
  async list(prefix: string): Promise<Array<{ key: string; lastModified: string }>> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, lastModified: new Date().toISOString() }));
  }
  async delete(key: string): Promise<void> { this.map.delete(key); }
  async deleteMany(keys: string[]): Promise<void> { for (const k of keys) this.map.delete(k); }
  async deletePrefix(prefix: string): Promise<number> {
    const keys = [...this.map.keys()].filter((k) => k.startsWith(prefix));
    for (const k of keys) this.map.delete(k);
    return keys.length;
  }
}
// ===== B) 引擎侧 =====
class MemS3 implements S3Store {
  map = new Map<string, Uint8Array>();
  async getObject(key: string, opts?: { maxBytes?: number }): Promise<Uint8Array | null> {
    const b = this.map.get(key);
    if (!b) return null;
    const bytes = isGzip(b) ? (await import("node:zlib")).gunzipSync(b) : b;
    if (opts?.maxBytes != null && bytes.length > opts.maxBytes) throw new Error(`对象过大`);
    return bytes;
  }
  async putObject(key: string, body: string | Uint8Array, opts?: { gzip?: boolean }): Promise<void> {
    let bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    if (opts?.gzip) bytes = (await import("node:zlib")).gzipSync(bytes);
    this.map.set(key, bytes);
  }
}

class MemDb implements SyncDbPort {
  notes = new Map<string, LocalNoteRow>();
  bases = new Map<string, { contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null }>();
  folders = new Map<string, any>();
  deletedNotes = new Set<string>();
  history: Array<{ noteId: string; content: string }> = [];
  assets = new Map<string, Uint8Array>();
  lastSeenCommitId: string | null = null;
  lastTombstoneSig = "";
  logs: string[] = [];
  async log(msg: string): Promise<void> { this.logs.push(msg); }
async getNote(id: string) { return this.notes.get(id) ?? null; }
async getAllNotes() { return [...this.notes.values()]; }
async getSyncBase(id: string) { return this.bases.get(id) ?? null; }
async applyRemoteNote(note: any, content: string) {
    this.notes.set(note.id, {
      id: note.id, title: note.title, content, updatedAt: note.updatedAt, syncState: "synced",
      trashedAt: note.trashedAt ?? null, restorePendingAt: null, parentId: note.parentId ?? null, sortOrder: note.sortOrder ?? 0,
      isLocked: !!note.isLocked, lockedAt: note.lockedAt ?? null, icon: note.icon ?? null, isConflict: !!note.isConflict,
    });
  }
async applyRemoteTrash(id: string, content: string, title: string, trashedAt: string, _dfp: string | null, _pid: string | null, _so: number) {
    this.notes.set(id, { id, title, content, updatedAt: trashedAt, syncState: "synced", trashedAt, restorePendingAt: null, parentId: null, sortOrder: 0, isLocked: false, lockedAt: null, icon: null, isConflict: false });
  }
async localTrashNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = new Date().toISOString(); n.syncState = "local"; } }
async localRestoreNote(id: string) { const n = this.notes.get(id); if (n) { n.trashedAt = null; n.restorePendingAt = new Date().toISOString(); n.syncState = "local"; } }
async applyRemotePurge(id: string) { const n = this.notes.get(id); if (n) { n.syncState = "purged"; n.parentId = TRASH_NOTEBOOK_ID; n.trashedAt = new Date().toISOString(); } }
async rememberDeleted(note: any, deletedAt: string) { this.deletedNotes.add(note.id); this.deletedAtMap.set(note.id, deletedAt); }
  deletedAtMap = new Map<string, string>();
async listDeletedNotesForSync() { return [...this.deletedAtMap.entries()].map(([id, deletedAt]) => ({ id, deletedAt })); }
async revokeLocalDeletion(id: string) { this.deletedNotes.delete(id); this.deletedAtMap.delete(id); }
async markFolderSynced() { return true; }
async applyRemoteNoteMeta(note: any) {
    const n = this.notes.get(note.id);
    if (n) { n.title = note.title; n.parentId = note.parentId; n.sortOrder = note.sortOrder; n.updatedAt = note.updatedAt; n.isConflict = !!note.isConflict; n.icon = note.icon ?? null; n.isLocked = !!note.isLocked; n.lockedAt = note.lockedAt ?? null; }
  }
async applyRemoteLock(id: string, locked: boolean, lockedAt: string | null) { const n = this.notes.get(id); if (n) { n.isLocked = locked; n.lockedAt = lockedAt; } }
async markLocalNoteSynced(id: string, contentHash: string, metaAt: string, lastUploadedHash: string | null) {
    const n = this.notes.get(id); if (n) n.syncState = "synced";
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
async markSyncedIfUnchanged(id: string, expectedContentHash: string, metaAt: string, lastUploadedHash: string) {
    const n = this.notes.get(id); if (!n) return;
    const current = sha256Sync(new TextEncoder().encode(n.content));
    if (current !== expectedContentHash) return;
    n.syncState = "synced";
    this.bases.set(id, { contentHash: expectedContentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
async setSyncBase(id: string, contentHash: string, metaAt: string | null, lastUploadedHash: string | null) {
    this.bases.set(id, { contentHash, lastUploadedHash, lastSyncedMetaAt: metaAt });
  }
async defaultNotebookId() { return "notebook-personal"; }
async importRemoteFolder(folder: any) { this.folders.set(folder.id, folder); }
async listFoldersForSync() {
    return [...this.folders.values()]
      .filter((f) => f.id !== TRASH_NOTEBOOK_ID)
      .map((f) => ({ id: f.id, title: f.title, parentId: f.parentId ?? null, sortOrder: f.sortOrder ?? 0, nodeType: f.nodeType ?? "group", icon: f.icon ?? null, updatedAt: f.updatedAt ?? "2026-01-01T00:00:00.000Z" }));
  }
async createHistorySnapshot(noteId: string, content: string) { this.history.push({ noteId, content }); }
  async saveAsset(noteId: string, filename: string, bytes: Uint8Array) { this.assets.set(noteId + "/" + filename, bytes); }
  async listLocalAssets(noteId: string) {
    const out: Array<{ filename: string; size: number; hash: string }> = [];
    const prefix = noteId + "/";
    for (const [key, bytes] of this.assets) {
      if (!key.startsWith(prefix)) continue;
      out.push({ filename: key.slice(prefix.length), size: bytes.length, hash: sha256Sync(bytes) });
    }
    return out;
  }
  async readLocalAsset(noteId: string, filename: string) { return this.assets.get(noteId + "/" + filename) ?? null; }
async getLastSeenCommitId() { return this.lastSeenCommitId; }
async setLastSeenCommitId(id: string) { this.lastSeenCommitId = id; }
async getLastTombstoneSig() { return this.lastTombstoneSig; }
async setLastTombstoneSig(sig: string) { this.lastTombstoneSig = sig; }
async tombstoneSignature() { return `${this.deletedNotes.size}:${[...this.deletedNotes].sort().at(-1) ?? ""}`; }
async hasLocalPendingNotes() { return [...this.notes.values()].some((n) => n.syncState !== "synced"); }
}

const CFG: SyncConfig = { endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "b", accessKeyId: "ak", secretAccessKey: "sk", prefix: "p" };
const hashOf = (s: string) => sha256Sync(new TextEncoder().encode(s));
/** 桌面种子 welcome-note 的真实内容（store.ts seed()）——场景构造两端必须一致，否则本地 hash 不同走不同分支。 */
const WELCOME_CONTENT = `<h1 id="welcome" class="ne-h1">欢迎来到 LocalLakexNotes</h1><p id="welcome-body" class="ne-p">这是一个基于 Lake 编辑器的本地优先笔记应用（Electron 桌面端）。</p>`;

// ===== 场景驱动：两端同构构造 → 同步 → 比较终态 =====
async function runScenarioDesktop(sc: Scenario): Promise<{ manifest: ManifestSemantic; notes: Array<{ id: string; syncState: string; trashedAt: boolean; title: string }> }> {
  const dir = mkdtempSync(path.join(tmpdir(), "lake-equiv-desk-"));
  try {
    const store = new Store(dir);
    store.saveS3Settings(S3_CFG);
    const s3 = new MockS3();
    // 本地初始状态：与引擎侧同构（桌面种子 welcome-note 默认已建，这里额外建场景笔记）
    for (const n of sc.localNotes) {
      if (n.id === "welcome-note") continue; // 种子已存在
      store.createNoteInAtTopWithContent(n.parentId ?? store.defaultNotebookId(), n.title, n.content, [], n.id);
      if (n.syncState === "synced") {
        const h = crypto.createHash("sha256").update(n.content).digest("hex");
        store.setBaseHash(n.id, h);
        store.setLastUploadedHash(n.id, h);
        const row = store.listNotesForSync().find((x) => x.id === n.id);
        if (row) store.markSyncedIfUnchanged(n.id, {
          contentHash: h, updatedAt: row.updatedAt, title: row.title, parentId: row.parentId ?? null,
          sortOrder: row.sortOrder, isLocked: !!row.isLocked, lockedAt: row.lockedAt ?? null, icon: row.icon ?? null,
        });
      }
      if (n.restorePendingAt) {
        // 恢复例外：软删→恢复（restoreTrashItem 写 restore_pending_at + trashed_at=NULL + sync_state=local）
        store.deleteTreeNode(n.id);
        store.restoreTrashItem(n.id);
      } else if (n.trashedAt) {
        store.deleteTreeNode(n.id);
      }
      if (n.isLocked) { /* 锁设置 API 待查 */ }
    }
    // 远端预置
    if (sc.remoteNotes || sc.remoteFolders) {
      const manifest = {
        version: 1, workspaceId: "default", commitId: "remote-c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
        notes: sc.remoteNotes ?? [],
        folders: sc.remoteFolders ?? [],
      };
      s3.map.set("manifests/latest.json", zlib.gzipSync(Buffer.from(JSON.stringify(manifest))));
      for (const [k, v] of Object.entries(sc.remoteObjects ?? {})) s3.map.set(k, Buffer.from(v));
    }
    const remote = () => s3 as unknown as ObjectStore;
    await desktopSync(store, undefined, remote);
    // 收集终态
    const latestRaw = s3.map.get("manifests/latest.json");
    const latest = latestRaw ? JSON.parse(decode(latestRaw[0] === 0x1f ? zlib.gunzipSync(latestRaw) : latestRaw)) : null;
    const notes = store.listNotesForSync().map((n) => ({ id: n.id, syncState: n.syncState ?? "", trashedAt: n.trashedAt != null, title: n.title }));

      return { manifest: latest ? semanticManifest(latest) : { notes: [], folders: [] }, notes };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function runScenarioEngine(sc: Scenario): Promise<{ manifest: ManifestSemantic; notes: Array<{ id: string; syncState: string; trashedAt: boolean; title: string }> }> {
  const s3 = new MemS3();
  const db = new MemDb();
  // 本地初始状态（与桌面种子同构：welcome-note + 默认笔记本）
  for (const n of sc.localNotes) {
    db.notes.set(n.id, {
      id: n.id, title: n.title, content: n.content, updatedAt: n.updatedAt ?? "2026-01-01T00:00:00.000Z",
      syncState: n.syncState ?? "local",
      trashedAt: n.trashedAt ?? null, restorePendingAt: n.restorePendingAt ?? null,
      parentId: n.parentId ?? null, sortOrder: n.sortOrder ?? 0,
      isLocked: n.isLocked ?? false, lockedAt: n.lockedAt ?? null, icon: n.icon ?? null, isConflict: false,
    });
  }
  db.folders.set("notebook-personal", { id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" });
  // 远端预置
  if (sc.remoteNotes || sc.remoteFolders) {
    const manifest = {
      version: 1, workspaceId: "default", commitId: "remote-c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
      notes: sc.remoteNotes ?? [],
      folders: sc.remoteFolders ?? [],
    };
    await s3.putObject("p/manifests/latest.json", JSON.stringify(manifest), { gzip: true });
    for (const [k, v] of Object.entries(sc.remoteObjects ?? {})) await s3.putObject("p/" + k, v);
  }
  await engineSync(CFG, s3, db);
  const latestRaw = await s3.getObject("p/manifests/latest.json");
  const latest = latestRaw ? JSON.parse(decode(latestRaw)) : null;
  const notes = [...db.notes.values()].map((n) => ({ id: n.id, syncState: n.syncState, trashedAt: n.trashedAt != null, title: n.title }));
  return { manifest: latest ? semanticManifest(latest) : { notes: [], folders: [] }, notes };
}

async function assertEquivalent(sc: Scenario) {
  const desk = await runScenarioDesktop(sc);
  const eng = await runScenarioEngine(sc);
  expect(eng.manifest).toEqual(desk.manifest);
  expect(eng.notes.sort((a, b) => a.id.localeCompare(b.id))).toEqual(desk.notes.sort((a, b) => a.id.localeCompare(b.id)));
}

describe("Step 4 等价测试（桌面 sync.ts vs 共享 syncEngine）", () => {
  it("场景1：首次同步——本地有笔记 + 无远端 → 上传发布", async () => {
    await assertEquivalent({
      name: "first-upload",
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 1, syncState: "local" },
        { id: "n1", title: "笔记1", content: "<p>content-1</p>", parentId: "notebook-personal", sortOrder: 0, syncState: "local" },
      ],
    });
  });

  it("场景2：远端下载——本地无此笔记 + 远端有 → 拉到本地（含元数据）", async () => {
    const h = hashOf("<p>remote-content</p>");
    await assertEquivalent({
      name: "remote-download",
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 0, syncState: "synced" },
      ],
      remoteNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf(WELCOME_CONTENT) },
        { id: "r1", title: "远端笔记", parentId: "notebook-personal", sortOrder: 1, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, isLocked: true, lockedAt: "2026-01-02T00:00:00.000Z", icon: "star" },
      ],
      remoteFolders: [
        { id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      remoteObjects: { [`objects/r1-${h}.lake`]: new TextEncoder().encode("<p>remote-content</p>") },
    });
  });

  it("场景3：远端墓碑——本地有 active + 远端 trashed → 跟随删除", async () => {
    const h = hashOf("<p>content</p>");
    await assertEquivalent({
      name: "remote-trash",
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 1, syncState: "local" },
        { id: "n1", title: "将被删", content: "<p>content</p>", parentId: "notebook-personal", sortOrder: 0, syncState: "synced" },
      ],
      remoteNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf(WELCOME_CONTENT) },
        { id: "n1", title: "将被删", parentId: TRASH_NOTEBOOK_ID, sortOrder: 1, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, trashedAt: "2026-01-02T00:00:00.000Z", deletedFromParentId: "notebook-personal" },
      ],
      remoteFolders: [
        { id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      remoteObjects: { [`objects/n1-${h}.lake`]: new TextEncoder().encode("<p>content</p>") },
    });
  });

  it("场景4：正文冲突——两端各改 + 远端先提交 → 远端胜 + 本地留档 superseded", async () => {
    const H2 = hashOf("<p>remote-edit</p>");
    await assertEquivalent({
      name: "conflict-remote-wins",
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 1, syncState: "local" },
        { id: "n1", title: "冲突笔记", content: "<p>local-edit</p>", parentId: "notebook-personal", sortOrder: 0, syncState: "local" },
      ],
      remoteNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf(WELCOME_CONTENT) },
        { id: "n1", title: "冲突笔记", parentId: "notebook-personal", sortOrder: 1, updatedAt: "2026-01-03T00:00:00.000Z", contentHash: H2 },
      ],
      remoteFolders: [
        { id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      remoteObjects: { [`objects/n1-${H2}.lake`]: new TextEncoder().encode("<p>remote-edit</p>") },
    });
  });

  it("场景5：远端 purge（deleted:true）——本地有副本 → 标 purged 不上传；无副本 → 记住删除", async () => {
    const h = hashOf("<p>purge-content</p>");
    await assertEquivalent({
      name: "remote-purge",
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 0, syncState: "synced" },
        { id: "p1", title: "将被永久删除", content: "<p>purge-content</p>", parentId: "notebook-personal", sortOrder: 1, syncState: "synced" },
      ],
      remoteNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf(WELCOME_CONTENT) },
        { id: "p1", title: "将被永久删除", parentId: TRASH_NOTEBOOK_ID, sortOrder: 1, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, deleted: true, deletedAt: "2026-01-02T00:00:00.000Z" },
      ],
      remoteFolders: [
        { id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      remoteObjects: { [`objects/p1-${h}.lake`]: new TextEncoder().encode("<p>purge-content</p>") },
    });
  });

  it("场景6：恢复例外——本地显式恢复（restore_pending）→ 上传 active 覆盖远端墓碑", async () => {
    const h = hashOf("<p>restored-content</p>");
    await assertEquivalent({
      name: "restore-exception",
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 0, syncState: "synced" },
        { id: "r1", title: "恢复的笔记", content: "<p>restored-content</p>", parentId: "notebook-personal", sortOrder: 0, syncState: "local", restorePendingAt: "2026-01-03T00:00:00.000Z" },
      ],
      remoteNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf(WELCOME_CONTENT) },
        { id: "r1", title: "恢复的笔记", parentId: TRASH_NOTEBOOK_ID, sortOrder: 1, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, trashedAt: "2026-01-02T00:00:00.000Z", deletedFromParentId: "notebook-personal" },
      ],
      remoteFolders: [
        { id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      remoteObjects: { [`objects/r1-${h}.lake`]: new TextEncoder().encode("<p>restored-content</p>") },
    });
  });

  it("场景7：零变更早退——二次同步无变化 → 两端都跳过（无新 manifest）", async () => {
    const h = hashOf("<p>content-1</p>");
    // 先构造"已同步"状态：远端已含本地笔记（commitId 一致）
    await assertEquivalent({
      name: "zero-change-skip",
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 0, syncState: "synced" },
        { id: "z1", title: "已同步", content: "<p>content-1</p>", parentId: "notebook-personal", sortOrder: 1, syncState: "synced" },
      ],
      remoteNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakexNotes", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf(WELCOME_CONTENT) },
        { id: "z1", title: "已同步", parentId: "notebook-personal", sortOrder: 1, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: h },
      ],
      remoteFolders: [
        { id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
      remoteObjects: { [`objects/z1-${h}.lake`]: new TextEncoder().encode("<p>content-1</p>") },
    });
  });
});
