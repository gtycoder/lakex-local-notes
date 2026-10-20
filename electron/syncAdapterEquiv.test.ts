/**
 * Step 5 前置验证：桌面 Store + adapter + syncEngine 与桌面 sync.ts 输出一致（第三路径）。
 * 复用 Step 4 场景输入，额外断言 adapter 驱动 syncEngine 的终态 == 桌面 sync.ts 终态。
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
import { syncNowViaEngine } from "./syncEngineController.js";
import { sha256Sync } from "../src/core/sha256Sync.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";

const decode = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
const hashOf = (s: string) => sha256Sync(new TextEncoder().encode(s));
const WELCOME_CONTENT = `<h1 id="welcome" class="ne-h1">欢迎来到 LocalLakeNotes</h1><p id="welcome-body" class="ne-p">这是一个基于 Lake 编辑器的本地优先笔记应用（Electron 桌面端）。</p>`;

const S3_CFG: S3Settings = {
  endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "test-bucket",
  prefix: "lake-notes", accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: false,
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

interface Scenario {
  localNotes: Array<{ id: string; title: string; content: string; parentId?: string | null; sortOrder?: number; syncState?: string; trashedAt?: string | null; restorePendingAt?: string | null }>;
  remoteNotes?: Array<any>;
  remoteFolders?: Array<any>;
  remoteObjects?: Record<string, Uint8Array>;
}

interface ManifestSemantic {
  notes: Array<{ id: string; title: string; parentId: string | null; sortOrder: number; trashedAt: boolean; deleted: boolean; isLocked: boolean; icon: string | null; assets: number }>;
  folders: Array<{ id: string; title: string; parentId: string | null; nodeType: string }>;
}
function semanticManifest(m: any): ManifestSemantic {
  const notes = [...(m.notes ?? [])].map((n: any) => ({
    id: n.id, title: n.title, parentId: n.parentId ?? null, sortOrder: n.sortOrder ?? 0,
    trashedAt: n.trashedAt != null, deleted: n.deleted === true, isLocked: !!n.isLocked, icon: n.icon ?? null, assets: (n.assets ?? []).length,
  })).sort((a: any, b: any) => a.id.localeCompare(b.id));
  const folders = [...(m.folders ?? [])].map((f: any) => ({ id: f.id, title: f.title, parentId: f.parentId ?? null, nodeType: f.nodeType })).sort((a: any, b: any) => a.id.localeCompare(b.id));
  return { notes, folders };
}

async function runDesktop(sc: Scenario) {
  const dir = mkdtempSync(path.join(tmpdir(), "lake-adap-desk-"));
  try {
    const store = new Store(dir);
    store.saveS3Settings(S3_CFG);
    const s3 = new MockS3();
    for (const n of sc.localNotes) {
      if (n.id === "welcome-note") continue;
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
      if (n.restorePendingAt) { store.deleteTreeNode(n.id); store.restoreTrashItem(n.id); }
      else if (n.trashedAt) { store.deleteTreeNode(n.id); }
    }
    if (sc.remoteNotes || sc.remoteFolders) {
      s3.map.set("manifests/latest.json", zlib.gzipSync(Buffer.from(JSON.stringify({
        version: 1, workspaceId: "default", commitId: "remote-c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
        notes: sc.remoteNotes ?? [], folders: sc.remoteFolders ?? [],
      }))));
      for (const [k, v] of Object.entries(sc.remoteObjects ?? {})) s3.map.set(k, Buffer.from(v));
    }
    const remote = () => s3 as unknown as ObjectStore;
    await desktopSync(store, undefined, remote);
    const raw = s3.map.get("manifests/latest.json");
    const latest = raw ? JSON.parse(decode(raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw)) : null;
    const notes = store.listNotesForSync().map((n) => ({ id: n.id, syncState: n.syncState ?? "", trashedAt: n.trashedAt != null, title: n.title }));
    return { manifest: latest ? semanticManifest(latest) : { notes: [], folders: [] }, notes };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function runDesktopViaAdapter(sc: Scenario) {
  const dir = mkdtempSync(path.join(tmpdir(), "lake-adap-eng-"));
  try {
    const store = new Store(dir);
    store.saveS3Settings(S3_CFG);
    const s3 = new MockS3();
    for (const n of sc.localNotes) {
      if (n.id === "welcome-note") continue;
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
      if (n.restorePendingAt) { store.deleteTreeNode(n.id); store.restoreTrashItem(n.id); }
      else if (n.trashedAt) { store.deleteTreeNode(n.id); }
    }
    if (sc.remoteNotes || sc.remoteFolders) {
      s3.map.set("manifests/latest.json", zlib.gzipSync(Buffer.from(JSON.stringify({
        version: 1, workspaceId: "default", commitId: "remote-c1", prevCommitId: null, createdAt: "2026-01-01T00:00:00.000Z",
        notes: sc.remoteNotes ?? [], folders: sc.remoteFolders ?? [],
      }))));
      for (const [k, v] of Object.entries(sc.remoteObjects ?? {})) s3.map.set(k, Buffer.from(v));
    }
    await syncNowViaEngine(store, undefined, () => s3 as unknown as ObjectStore);
    const raw = s3.map.get("manifests/latest.json");
    const latest = raw ? JSON.parse(decode(raw[0] === 0x1f ? zlib.gunzipSync(raw) : raw)) : null;
    const notes = store.listNotesForSync().map((n) => ({ id: n.id, syncState: n.syncState ?? "", trashedAt: n.trashedAt != null, title: n.title }));
    return { manifest: latest ? semanticManifest(latest) : { notes: [], folders: [] }, notes };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function assertAdapterEquiv(sc: Scenario) {
  const desk = await runDesktop(sc);
  const adap = await runDesktopViaAdapter(sc);
  expect(adap.manifest).toEqual(desk.manifest);
  expect(adap.notes.sort((a, b) => a.id.localeCompare(b.id))).toEqual(desk.notes.sort((a, b) => a.id.localeCompare(b.id)));
}

describe("Step 5 adapter 等价（桌面 Store + adapter + syncEngine vs 桌面 sync.ts）", () => {
  it("场景A：首次上传", async () => {
    await assertAdapterEquiv({
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakeNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 0, syncState: "local" },
        { id: "n1", title: "笔记1", content: "<p>content-1</p>", parentId: "notebook-personal", sortOrder: 0, syncState: "local" },
      ],
    });
  });

  it("场景B：远端下载", async () => {
    const h = hashOf("<p>remote-content</p>");
    await assertAdapterEquiv({
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakeNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 0, syncState: "synced" },
      ],
      remoteNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakeNotes", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf(WELCOME_CONTENT) },
        { id: "r1", title: "远端笔记", parentId: "notebook-personal", sortOrder: 1, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, isLocked: true, lockedAt: "2026-01-02T00:00:00.000Z", icon: "star" },
      ],
      remoteFolders: [{ id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" }],
      remoteObjects: { [`objects/r1-${h}.lake`]: new TextEncoder().encode("<p>remote-content</p>") },
    });
  });

  it("场景C：远端墓碑", async () => {
    const h = hashOf("<p>content</p>");
    await assertAdapterEquiv({
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakeNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 1, syncState: "local" },
        { id: "n1", title: "将被删", content: "<p>content</p>", parentId: "notebook-personal", sortOrder: 0, syncState: "synced" },
      ],
      remoteNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakeNotes", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf(WELCOME_CONTENT) },
        { id: "n1", title: "将被删", parentId: TRASH_NOTEBOOK_ID, sortOrder: 1, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, trashedAt: "2026-01-02T00:00:00.000Z", deletedFromParentId: "notebook-personal" },
      ],
      remoteFolders: [{ id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" }],
      remoteObjects: { [`objects/n1-${h}.lake`]: new TextEncoder().encode("<p>content</p>") },
    });
  });

  it("场景D：purge", async () => {
    const h = hashOf("<p>purge-content</p>");
    await assertAdapterEquiv({
      localNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakeNotes", content: WELCOME_CONTENT, parentId: "notebook-personal", sortOrder: 0, syncState: "synced" },
        { id: "p1", title: "将被永久删除", content: "<p>purge-content</p>", parentId: "notebook-personal", sortOrder: 1, syncState: "synced" },
      ],
      remoteNotes: [
        { id: "welcome-note", title: "欢迎来到 LocalLakeNotes", parentId: "notebook-personal", sortOrder: 0, updatedAt: "2026-01-01T00:00:00.000Z", contentHash: hashOf(WELCOME_CONTENT) },
        { id: "p1", title: "将被永久删除", parentId: TRASH_NOTEBOOK_ID, sortOrder: 1, updatedAt: "2026-01-02T00:00:00.000Z", contentHash: h, deleted: true, deletedAt: "2026-01-02T00:00:00.000Z" },
      ],
      remoteFolders: [{ id: "notebook-personal", title: "个人笔记", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "2026-01-01T00:00:00.000Z" }],
      remoteObjects: { [`objects/p1-${h}.lake`]: new TextEncoder().encode("<p>purge-content</p>") },
    });
  });
});