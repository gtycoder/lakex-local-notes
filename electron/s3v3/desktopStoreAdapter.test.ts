import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "../store.js";
import { sha256Hex } from "../../src/core/syncUtils.js";
import { DesktopStoreDevice } from "./desktopStoreAdapter.js";
import { FileDeviceStore, type DeviceState } from "./fileDeviceStore.js";
import { S3v3SyncEngine } from "./syncEngine.js";
import type { RemoteObjectInfo, S3v3Remote } from "./ports.js";

class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}
const emptyState = (): DeviceState => ({ lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [], intents: [], pending: [], remotePurged: [], restorePending: [] });
async function fileDevice() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-b-")); const store = new FileDeviceStore(root); await store.init(); return { root, store }; }
async function addB(store: FileDeviceStore, id: string, body: string, parentId: string | null) {
  const state = (await store.loadState()) ?? emptyState();
  const bytes = new TextEncoder().encode(body);
  await store.writeBody(id, bytes);
  state.lake.notes.push({ id, title: id, parentId, sortOrder: 0, updatedAt: new Date().toISOString(), contentHash: sha256Hex(bytes) });
  await store.saveState(state);
}

describe("DesktopStoreDevice（真实 Store）", () => {
  it("loadState 映射 + 引擎初始化上传 + 双端增量 + 远端新文档落库", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-a-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    // 带附件的文档：先写临时源文件再导入
    const assetSrc = path.join(root, "asset-src.png");
    await fs.writeFile(assetSrc, "PNG-DATA");
    store.createNoteInAtTopWithContent(nb.id, "Doc1", "hello", [{ filename: "a.png", sourcePath: assetSrc }], "n1");
    store.createNoteInAtTopWithContent(nb.id, "Doc2", "second", [], "n2");

    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const loaded = (await adapter.loadState())!;
    expect(loaded.lake.notes.map((n) => n.id)).toEqual(expect.arrayContaining(["n1", "n2"]));
    expect(loaded.lake.folders.map((f) => f.id)).toEqual(expect.arrayContaining([nb.id]));
    expect(loaded.lake.notes.find((n) => n.id === "n1")!.contentHash).toBe(sha256Hex(new TextEncoder().encode("hello")));

    const remote = new MemoryRemote();
    const engineA = new S3v3SyncEngine({ remote, device: adapter, deviceId: "A" });
    const r1 = await engineA.sync({ onEmptyCloud: "upload" });
    expect(r1.published).toBe(true);
    const b = await fileDevice();
    await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
    expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("hello");
    expect(new TextDecoder().decode((await b.store.readAsset("n1", "a.png"))!)).toBe("PNG-DATA");

    // 本机改正文 → 上传 → 对端拉取
    store.saveNote("n1", "Doc1", "hello-v2");
    await engineA.sync();
    await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
    expect(new TextDecoder().decode((await b.store.readBody("n1"))!)).toBe("hello-v2");

    // 远端新文档 → 本机同步后应创建到 Store
    await addB(b.store, "n3", "from-b", nb.id);
    await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync();
    await engineA.sync();
    expect(store.hasNote("n3")).toBe(true);
    expect(store.readNote("n3").content).toBe("from-b");
  }, 60_000);

  it("远端墓碑应用到桌面回收站（B15 回归）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-trash-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "TrashMe", "content", [], "t1");
    const remote = new MemoryRemote();
    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const engineA = new S3v3SyncEngine({ remote, device: adapter, deviceId: "A" });
    await engineA.sync({ onEmptyCloud: "upload" });
    const b = await fileDevice();
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await engineB.sync();
    const st = (await b.store.loadState())!;
    const note = st.lake.notes.find((x) => x.id === "t1")!;
    note.parentId = "trash";
    note.trashedAt = new Date().toISOString();
    note.updatedAt = new Date(Date.now() + 2000).toISOString();
    await b.store.saveState(st);
    await engineB.sync();
    await engineA.sync();
    const mapped = store.listNotesForSync().find((x) => x.id === "t1");
    expect(mapped?.trashedAt).toBeTruthy();
  }, 60_000);

  it("远端恢复（restore）应用到桌面回收站（B15 恢复路径回归）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-restore-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "RestoreMe", "content", [], "r1");
    const remote = new MemoryRemote();
    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const engineA = new S3v3SyncEngine({ remote, device: adapter, deviceId: "A" });
    await engineA.sync({ onEmptyCloud: "upload" });
    const b = await fileDevice();
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await engineB.sync();
    // B 先删（trash）→ A 收到回收站
    let st = (await b.store.loadState())!;
    let note = st.lake.notes.find((x) => x.id === "r1")!;
    note.parentId = "trash"; note.trashedAt = new Date().toISOString(); note.updatedAt = new Date(Date.now() + 1000).toISOString();
    await b.store.saveState(st); await engineB.sync(); await engineA.sync();
    expect(store.listNotesForSync().find((x) => x.id === "r1")?.trashedAt).toBeTruthy();
    // B 恢复 → A 应 restoreTrashItem 并移回原目录
    st = (await b.store.loadState())!;
    note = st.lake.notes.find((x) => x.id === "r1")!;
    note.parentId = nb.id; delete note.trashedAt; note.updatedAt = new Date(Date.now() + 2000).toISOString();
    st.restorePending = ["r1"];
    await b.store.saveState(st); await engineB.sync(); await engineA.sync();
    const mapped = store.listNotesForSync().find((x) => x.id === "r1");
    expect(mapped?.trashedAt ?? null).toBeNull();
    expect(mapped?.parentId).toBe(nb.id);
  }, 60_000);

  it("远端彻底删除（purge）应用到桌面 Store：删除 + 写墓碑", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-purge-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "PurgeMe", "content", [], "p1");
    const remote = new MemoryRemote();
    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const engineA = new S3v3SyncEngine({ remote, device: adapter, deviceId: "A" });
    await engineA.sync({ onEmptyCloud: "upload" });
    const b = await fileDevice();
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await engineB.sync();
    const ptr = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { epoch: string; generation: number };
    const st = (await b.store.loadState())!;
    st.lake.notes = st.lake.notes.filter((x) => x.id !== "p1");
    st.intents = [{ noteId: "p1", targetEpoch: ptr.epoch, targetGeneration: ptr.generation, purgedAt: new Date().toISOString() }];
    await b.store.saveState(st);
    await b.store.deleteBody("p1");
    await engineB.sync();
    expect(await remote.list("objects/p1-")).toHaveLength(0);
    await engineA.sync();
    // 远端 purge → 本机按设计保留回收站副本（remotePurged），不是本地硬删
    const trashed = store.listNotesForSync().find((x) => x.id === "p1");
    expect(trashed?.trashedAt).toBeTruthy();
    expect(await remote.list("objects/p1-")).toHaveLength(0);
  }, 60_000);


  it("远端首拉：先建目录（保留 id）再建子文档，并落图标", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-first-"));
    const store = new Store(root);
    store.bootstrap();
    const remote = new MemoryRemote();
    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const engineA = new S3v3SyncEngine({ remote, device: adapter, deviceId: "A" });

    const b = await fileDevice();
    const st = emptyState();
    const now = new Date().toISOString();
    const folder = { id: "folder-remote", parentId: null, nodeType: "notebook" as const, title: "远端新建本", sortOrder: 9, updatedAt: now, icon: null };
    st.lake.folders.push(folder);
    st.folders.push(folder);
    const bytes = new TextEncoder().encode("远端首拉正文");
    await b.store.writeBody("n-remote", bytes);
    st.lake.notes.push({ id: "n-remote", title: "远端首拉文档", parentId: "folder-remote", sortOrder: 0, updatedAt: now, contentHash: sha256Hex(bytes), icon: "🎃" } as never);
    await b.store.saveState(st);
    await new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" }).sync({ onEmptyCloud: "upload" });

    await engineA.sync();
    const node = store.listTreeNodes().find((n) => n.id === "n-remote");
    expect(node?.parentId).toBe("folder-remote");
    expect(node?.icon).toBe("🎃");
    expect(store.listTreeNodes().some((n) => n.id === "folder-remote" && n.title === "远端新建本")).toBe(true);
    expect(store.readNote("n-remote").content).toBe("远端首拉正文");
  }, 60_000);


  it("本地 purge 墓碑 → v3 删除意图：远端条目与对象被删除，不被重新拉回", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-purge-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("PurgeNB");
    store.createNoteInAtTopWithContent(nb.id, "PurgeMe", "purge-body", [], "p1");
    const remote = new MemoryRemote();
    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const engine = new S3v3SyncEngine({ remote, device: adapter, deviceId: "A" });
    await engine.sync({ onEmptyCloud: "upload" });
    expect(await remote.list("objects/p1-")).toHaveLength(1);

    store.deleteNote("p1");
    store.purgeTrashItem("p1");
    await engine.sync();
    expect(await remote.list("objects/p1-")).toHaveLength(0);
    const idx = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { lake: { commit: string } };
    const lake = JSON.parse(new TextDecoder().decode((await remote.get("meta/index/" + idx.lake.commit + ".json"))!)) as { notes: Array<{ id: string }> };
    expect(lake.notes.some((n) => n.id === "p1")).toBe(false);
  }, 60_000);

  it("远端改正文后同步：不打开文档就能搜到新关键词（text_cache + FTS 随正文落库）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-sync-cache-"));
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Cache", "<p>同步前的旧正文</p>", [], "c1");
    // 关键前提：text_cache 已有旧内容（文档曾被打开/保存过）。否则 SearchRepository 会从磁盘
    // 重新派生并顺手写入缓存，把「同步写正文不带缓存」的缺口掩盖掉。
    store.updateNoteCaches("c1", null, "同步前的旧正文");
    expect(store.searchNotes("星空大海")).toEqual([]);
    const remote = new MemoryRemote();
    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const engineA = new S3v3SyncEngine({ remote, device: adapter, deviceId: "A" });
    await engineA.sync({ onEmptyCloud: "upload" });
    const b = await fileDevice();
    const engineB = new S3v3SyncEngine({ remote, device: b.store, deviceId: "B" });
    await engineB.sync();

    // 他端改正文并发布
    const st = (await b.store.loadState())!;
    const entry = st.lake.notes.find((x) => x.id === "c1")!;
    const bytes = new TextEncoder().encode("<p>远端新词星空大海</p>");
    await b.store.writeBody("c1", bytes);
    entry.contentHash = sha256Hex(bytes);
    entry.updatedAt = new Date(Date.now() + 2000).toISOString();
    await b.store.saveState(st);
    await engineB.sync();

    // 本机只同步（不打开文档）：正文、text_cache、FTS 必须一起更新
    const r = await engineA.sync();
    expect(r.downloadedNotes).toBe(1);
    expect(store.readNote("c1").content).toContain("星空大海");
    expect(store.readNoteCaches("c1").plain).toContain("星空大海");
    expect(store.searchNotes("星空大海").map((x) => x.id)).toContain("c1");
  }, 60_000);

  it("检测到 quick-notes 库时拒绝（不静默丢小记）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-q-"));
    const store = new Store(root);
    store.bootstrap();
    await fs.mkdir(path.join(root, "quick-notes"), { recursive: true });
    await fs.writeFile(path.join(root, "quick-notes", "metadata.sqlite3"), "");
    const adapter = new DesktopStoreDevice(store, root);
    await expect(adapter.init()).rejects.toThrow(/quick notes store 未注入/);
  });

  it("writeQuickAsset 拒绝非法 filename（SEC-13a：与 writeAsset 同断言）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-quick-asset-"));
    const store = new Store(root);
    store.bootstrap();
    const adapter = new DesktopStoreDevice(store, root);
    for (const bad of ["../escape.png", "a/b.png", "a\\b.png", "a b.png"]) {
      await expect(adapter.writeQuickAsset("q1", bad, new Uint8Array([1]))).rejects.toThrow(/非法资源文件名/);
    }
  });
});

describe("DesktopStoreDevice：state 信封 v3（E3-1 phase2a）", () => {
  const statePath = (root: string): string => path.join(root, "sync-v3", "state.json");
  async function seed(root: string): Promise<{ store: Store; adapter: DesktopStoreDevice }> {
    const store = new Store(root);
    store.bootstrap();
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc", "hello", [], "n1");
    const adapter = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
    await adapter.init();
    return { store, adapter };
  }

  it("saveState 只写 v3 records 信封（+资产投影+hashCache），loadState 无损还原", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-env-"));
    const { store, adapter } = await seed(root);
    const state = (await adapter.loadState())!;
    state.intents = [{ noteId: "n1", targetEpoch: "e1", targetGeneration: 1, purgedAt: "2026-10-02T00:00:00.000Z" }];
    state.pending = [{ kind: "body", key: "objects/n1-x.lake", noteId: "n1", targetEpoch: "e1", targetGeneration: 1, targetCommit: "c1", createdAt: "2026-10-02T00:00:00.000Z" } as never];
    state.remotePurged = ["n1"];
    state.restorePending = ["n2"];
    state.quickDeletes = ["q2"];
    state.quickPurges = ["q3"];
    state.quickPurgeTimes = { q3: "2026-10-03T00:00:00.000Z" };
    state.pendingAssets = [{ space: "lake", id: "n1", filename: "a.png", size: 3, hash: "e".repeat(64), attempts: 1 }];
    state.lake.notes.find((n) => n.id === "n1")!.assetsHash = "f".repeat(64);
    await adapter.saveState(state);

    const raw = JSON.parse(await fs.readFile(statePath(root), "utf8")) as Record<string, any>;
    expect(raw.version).toBe(3);
    // 落盘形状 = 一条 records（不再是 9 组字段）
    expect(raw).not.toHaveProperty("remotePurged");
    expect(raw).not.toHaveProperty("restorePending");
    expect(raw).not.toHaveProperty("assetsHash");
    const byKind = (kind: string): Array<Record<string, unknown>> => (raw.records as Array<Record<string, unknown>>).filter((r) => r.kind === kind);
    expect(byKind("cloud-deleted").map((r) => r.id)).toEqual(["n1"]);
    expect(byKind("restore").map((r) => r.noteId)).toEqual(["n2"]);
    expect(byKind("quick-delete").map((r) => r.id)).toEqual(["q2"]);
    expect(byKind("quick-purge").map((r) => r.id)).toEqual(["q3"]);
    expect(byKind("quick-purge")[0].at).toBe("2026-10-03T00:00:00.000Z");
    expect(byKind("asset-retry")).toHaveLength(1);
    expect(byKind("delete-intent")).toHaveLength(1);
    expect(raw.assets.lake.n1).toBe("f".repeat(64));
    expect(raw.hashCache.n1).toBeTruthy();

    const adapter2 = new DesktopStoreDevice(store, root, { skipQuickNotesGuard: true });
    await adapter2.init();
    const back = (await adapter2.loadState())!;
    expect(back.intents).toEqual(state.intents);
    expect(back.pending).toEqual(state.pending);
    expect(back.remotePurged).toEqual(["n1"]);
    expect(back.restorePending).toContain("n2");
    expect(back.pendingAssets).toEqual(state.pendingAssets);
    expect(back.lake.notes.find((n) => n.id === "n1")!.assetsHash).toBe("f".repeat(64));
  });

  it("旧 sidecar（无 version）加载时逐字段迁移；下一次 saveState 升级为 v3 信封", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-env-legacy-"));
    const { adapter } = await seed(root);
    await fs.mkdir(path.join(root, "sync-v3"), { recursive: true });
    await fs.writeFile(statePath(root), JSON.stringify({
      intents: [{ noteId: "n1", targetEpoch: "e1", targetGeneration: 1 }],
      pending: [],
      quickPurgeTimes: { q3: "2026-10-03T00:00:00.000Z" },
      remotePurged: ["n1"],
      restorePending: ["n2"],
      pendingAssets: [],
      assetsHash: { n1: "a".repeat(64) },
      quickAssetsHash: {},
      hashCache: {},
    }));
    const loaded = (await adapter.loadState())!;
    expect(loaded.intents).toHaveLength(1);
    expect(loaded.remotePurged).toEqual(["n1"]);
    expect(loaded.restorePending).toContain("n2");
    expect(loaded.lake.notes.find((n) => n.id === "n1")!.assetsHash).toBe("a".repeat(64));

    await adapter.saveState(loaded);
    const raw = JSON.parse(await fs.readFile(statePath(root), "utf8")) as Record<string, any>;
    expect(raw.version).toBe(3);
    expect((raw.records as Array<Record<string, unknown>>).filter((r) => r.kind === "cloud-deleted").map((r) => r.id)).toEqual(["n1"]);
    expect(raw).not.toHaveProperty("remotePurged");
  });
});
