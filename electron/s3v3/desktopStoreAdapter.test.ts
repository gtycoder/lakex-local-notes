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

  it("检测到 quick-notes 库时拒绝（不静默丢小记）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "s3v3-q-"));
    const store = new Store(root);
    store.bootstrap();
    await fs.mkdir(path.join(root, "quick-notes"), { recursive: true });
    await fs.writeFile(path.join(root, "quick-notes", "metadata.sqlite3"), "");
    const adapter = new DesktopStoreDevice(store, root);
    await expect(adapter.init()).rejects.toThrow(/quick notes store 未注入/);
  });
});
