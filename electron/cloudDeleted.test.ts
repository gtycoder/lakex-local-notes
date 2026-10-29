import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";
import { QuickNotesStore } from "./quickNotes.js";
import { DesktopStoreDevice } from "./s3v3/desktopStoreAdapter.js";
import { FileDeviceStore } from "./s3v3/fileDeviceStore.js";
import { S3v3SyncEngine } from "./s3v3/syncEngine.js";
import type { RemoteObjectInfo, S3v3Remote } from "./s3v3/ports.js";
import { getDocumentStatus } from "../src/components/model/documentStatusModel.js";
import { noteInfoRows } from "../src/core/noteInfo.js";

/** 内存 S3（与 desktopStoreAdapter.test.ts 同构的最小实现）。 */
class MemoryRemote implements S3v3Remote {
  objects = new Map<string, { bytes: Uint8Array; gzip: boolean }>();
  async get(key: string) { const o = this.objects.get(key); if (!o) return null; return o.gzip ? new Uint8Array(gunzipSync(Buffer.from(o.bytes))) : o.bytes; }
  async put(key: string, bytes: Uint8Array, opts?: { gzip?: boolean }) { this.objects.set(key, opts?.gzip ? { bytes: new Uint8Array(gzipSync(Buffer.from(bytes))), gzip: true } : { bytes: new Uint8Array(bytes), gzip: false }); }
  async list(prefix: string): Promise<RemoteObjectInfo[]> { return [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length })); }
  async deleteMany(keys: string[]) { for (const k of keys) this.objects.delete(k); }
  async deleteByPrefix(prefix: string) { const ks = [...this.objects.keys()].filter((k) => k.startsWith(prefix)); for (const k of ks) this.objects.delete(k); return ks.length; }
}

/**
 * 261026 v3 cloudDeleted（「云端已删除 · 仅本地」）桌面侧护栏。
 *
 * 语义（用户定稿）：
 * - 远端彻底删除 → 本地副本保留回收站，只打 cloud_deleted 标，不限制恢复；
 * - 恢复并重新上传成功后标记消失（adapter 按 state.remotePurged 的当前全集置位/清除）；
 * - 本地主动彻底删除后标记清掉，后续同步不得再产生 S3 行为（sidecar 里的 remotePurged 也要清）。
 *
 * 引擎侧（task-10）负责把 remotePurged / restorePending 写进 DeviceState；本文件用直接 saveState 驱动，
 * 不依赖引擎当前是否已实现（避免跨任务阻塞），同时钉住 adapter 对任务的契约。
 */

async function makeStore(root: string) {
  const store = new Store(root);
  store.bootstrap();
  return store;
}

function sidecar(root: string) {
  return path.join(root, "sync-v3", "state.json");
}

describe("cloudDeleted：Store 标记位（notes/tree_nodes）", () => {
  it("applyNotesCloudDeleted 置位/清除，UI 三条读路径都能看到", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-store-"));
    const store = await makeStore(root);
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "n1");

    expect(store.listNoteSummaries().find((n) => n.id === "n1")?.cloudDeleted).toBeUndefined();
    store.applyNotesCloudDeleted(["n1"]);
    expect(store.listCloudDeletedNoteIds()).toEqual(["n1"]);
    expect(store.listNoteSummaries().find((n) => n.id === "n1")?.cloudDeleted).toBe(true);
    expect(store.listTreeNodes().find((n) => n.id === "n1")?.cloudDeleted).toBe(true);
    expect(store.readNote("n1").cloudDeleted).toBe(true);
    expect(store.getNoteInfo("n1").cloudDeleted).toBe(true);

    // 恢复并重新上传成功 = remotePurged 全集里不再有它 → 清除
    store.applyNotesCloudDeleted([]);
    expect(store.listCloudDeletedNoteIds()).toEqual([]);
    expect(store.readNote("n1").cloudDeleted).toBeUndefined();
    expect(store.getNoteInfo("n1").cloudDeleted).toBe(false);

    // 非法 id（目录穿越等）忽略，不抛错
    store.applyNotesCloudDeleted(["../evil", "n1"]);
    expect(store.listCloudDeletedNoteIds()).toEqual(["n1"]);
  });

  it("回收站列表带 cloudDeleted（文档页签徽标的数据源）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-trash-"));
    const store = await makeStore(root);
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Trashed", "body", [], "t1");
    store.deleteNote("t1");
    store.applyNotesCloudDeleted(["t1"]);
    const item = store.listTrash().find((x) => x.id === "t1");
    expect(item?.cloudDeleted).toBe(true);
    expect(item?.purged).toBe(false); // 独立于 purged：不抑制恢复
  });

  it("markNotesSynced 清 restore_pending_at（恢复标记不残留，避免每轮重传）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-restore-"));
    const store = await makeStore(root);
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Restored", "body", [], "r1");
    store.deleteNote("r1");
    store.restoreTrashItem("r1");
    expect(store.listRestorePendingNoteIds()).toEqual(["r1"]);
    store.markNotesSynced(["r1"]);
    expect(store.listRestorePendingNoteIds()).toEqual([]);
    // mapSummary 只在为真时带 isDirty 字段：undefined = 不脏（已同步）
    expect(store.listNoteSummaries().find((n) => n.id === "r1")?.isDirty).toBeUndefined();
  });
});

describe("cloudDeleted：v3 desktop adapter（remotePurged → 本地标）", () => {
  it("saveState 按 remotePurged 置位并持久化 sidecar；集合清空即清除", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-adapter-"));
    const store = await makeStore(root);
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "n1");
    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();

    const state = (await adapter.loadState())!;
    state.remotePurged = ["n1"];
    await adapter.saveState(state);
    expect(store.listCloudDeletedNoteIds()).toEqual(["n1"]);
    // E3-1 phase2a：sidecar = v3 信封（remotePurged → cloud-deleted records）
    const idsOf = async (): Promise<string[]> => {
      const raw = JSON.parse(await fs.readFile(sidecar(root), "utf8")) as { records?: Array<{ kind: string; id?: string }> };
      return (raw.records ?? []).filter((r) => r.kind === "cloud-deleted").map((r) => r.id!);
    };
    expect(await idsOf()).toEqual(["n1"]);

    // 恢复并重新上传成功：引擎从 remotePurged 移除 → 下一次 saveState 清标
    const next = (await adapter.loadState())!;
    next.remotePurged = [];
    await adapter.saveState(next);
    expect(store.listCloudDeletedNoteIds()).toEqual([]);
    expect(await idsOf()).toEqual([]);
  });

  it("本地主动 purge 后：标记行没了，sidecar 的 remotePurged 也被清掉（不再有 S3 行为）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-purge-"));
    const store = await makeStore(root);
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "p1");
    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const state = (await adapter.loadState())!;
    state.remotePurged = ["p1"];
    await adapter.saveState(state);
    expect(store.listCloudDeletedNoteIds()).toEqual(["p1"]);

    store.deleteNote("p1");
    store.purgeTrashItem("p1");
    expect(store.hasNote("p1")).toBe(false);
    const after = (await adapter.loadState())!; // sidecar 仍带 p1
    expect(after.remotePurged).toContain("p1");
    await adapter.saveState(after);
    {
      const raw = JSON.parse(await fs.readFile(sidecar(root), "utf8")) as { records?: Array<{ kind: string; id?: string }> };
      expect((raw.records ?? []).filter((r) => r.kind === "cloud-deleted").map((r) => r.id)).toEqual([]);
    }
    // purge 墓碑仍是"下次同步要传播的删除意图"，但不再有 remotePurged 打标
    expect(store.listPurgedTombstones().map((t) => t.id)).toContain("p1");
  });

  it("state.restorePending 从 DB 恢复标记补齐（引擎唯一能看到的恢复信号）", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-pending-"));
    const store = await makeStore(root);
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Restored", "body", [], "r1");
    store.deleteNote("r1");
    store.restoreTrashItem("r1"); // 写 notes.restore_pending_at
    const adapter = new DesktopStoreDevice(store, root);
    await adapter.init();
    const state = (await adapter.loadState())!;
    expect(state.restorePending).toContain("r1");
  });

  it("小记远端删除：保留 quick 回收站副本并打标；恢复/本地 purge 后标记消失", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-quick-"));
    const store = await makeStore(root);
    const quick = new QuickNotesStore(root);
    const adapter = new DesktopStoreDevice(store, root, { quickNotes: quick, skipQuickNotesGuard: true });
    await adapter.init();
    const q = quick.createQuickNote({ text: "hello", draftId: "d1", stagedImageIds: [] });

    // 引擎把该条从索引里删掉（远端已彻底删除）→ adapter 落回收站 + 打标
    const state = (await adapter.loadState())!;
    state.quickNotes.items = state.quickNotes.items.filter((x) => x.id !== q.id);
    await adapter.saveState(state);
    expect(quick.listQuickNotes().some((n) => n.id === q.id)).toBe(false);
    const trashItem = quick.listQuickNoteTrash().find((n) => n.id === q.id);
    expect(trashItem).toBeTruthy();
    expect(trashItem?.cloudDeleted).toBe(true);
    expect(quick.listCloudDeletedQuickNoteIds()).toContain(q.id);

    // 恢复：离开回收站（墓碑行删除）→ 标记不再出现
    quick.restoreQuickNote(q.id);
    expect(quick.listQuickNotes().some((n) => n.id === q.id)).toBe(true);
    expect(quick.listCloudDeletedQuickNoteIds()).not.toContain(q.id);

    // 再删 + 本地主动彻底删除：标记清 0，且不会再产生 remotePurged 打标
    quick.deleteQuickNote(q.id);
    quick.purgeQuickNote(q.id);
    expect(quick.listCloudDeletedQuickNoteIds()).not.toContain(q.id);
    expect(quick.listQuickNoteTrash().some((n) => n.id === q.id)).toBe(false);
  });
});

describe("cloudDeleted：端到端（v3 引擎 remotePurged → 桌面标 → 恢复后清除）", () => {
  it("B 彻底删除 → A 保留回收站副本并打标；A 恢复并重新上传成功后徽标消失、云端复活", async () => {
    const remote = new MemoryRemote();
    const rootA = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-e2e-"));
    const store = await makeStore(rootA);
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "CrossDevice", "body-v1", [], "p1");
    const adapterA = new DesktopStoreDevice(store, rootA);
    await adapterA.init();
    const engineA = new S3v3SyncEngine({ remote, device: adapterA, deviceId: "A" });
    await engineA.sync({ onEmptyCloud: "upload" });

    // B 端：下载后本地彻底删除（写删除意图 + 从索引移除）
    const rootB = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-e2e-b-"));
    const deviceB = new FileDeviceStore(rootB);
    await deviceB.init();
    const engineB = new S3v3SyncEngine({ remote, device: deviceB, deviceId: "B" });
    await engineB.sync();
    const ptr = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { epoch: string; generation: number };
    const stB = (await deviceB.loadState())!;
    stB.lake.notes = stB.lake.notes.filter((x) => x.id !== "p1");
    stB.intents = [{ noteId: "p1", targetEpoch: ptr.epoch, targetGeneration: ptr.generation, purgedAt: new Date().toISOString() }];
    await deviceB.saveState(stB);
    await deviceB.deleteBody("p1");
    await engineB.sync();
    expect(await remote.list("objects/p1-")).toHaveLength(0);

    // A 跟随：保留回收站副本 + 「云端已删除 · 仅本地」标记（不是物理删除）
    await engineA.sync();
    expect(store.hasNote("p1")).toBe(true);
    expect(store.listNotesForSync().find((n) => n.id === "p1")?.trashedAt).toBeTruthy();
    expect(store.listCloudDeletedNoteIds()).toContain("p1");
    expect(store.listTrash().find((x) => x.id === "p1")?.cloudDeleted).toBe(true);

    // A 显式恢复（不限制恢复）→ 重新上传成功后标记消失
    store.restoreTrashItem("p1");
    expect(store.listRestorePendingNoteIds()).toEqual(["p1"]);
    await engineA.sync();
    expect(store.listCloudDeletedNoteIds()).toEqual([]);
    expect(store.listRestorePendingNoteIds()).toEqual([]);
    expect(store.listNotesForSync().find((n) => n.id === "p1")?.trashedAt ?? null).toBeNull();
    // 云端确实重新有了 active 条目（不是只本地清标）
    const idx = JSON.parse(new TextDecoder().decode((await remote.get("meta/pointer.json"))!)) as { lake: { commit: string } };
    const lake = JSON.parse(new TextDecoder().decode((await remote.get("meta/index/" + idx.lake.commit + ".json"))!)) as { notes: Array<{ id: string }> };
    expect(lake.notes.some((n) => n.id === "p1")).toBe(true);
    // B 跟随恢复
    await engineB.sync();
    expect((await deviceB.loadState())!.lake.notes.some((n) => n.id === "p1")).toBe(true);
  }, 120_000);
});

describe("cloudDeleted：UI 文案口径（状态栏 / 属性面板）", () => {
  it("documentStatusModel：云端已删除 · 仅本地（保存中/待保存优先）", () => {
    expect(getDocumentStatus({ hasCloudConfig: true, isCloudDeleted: true, saveState: "idle" }))
      .toMatchObject({ kind: "cloud-deleted", label: "云端已删除 · 仅本地" });
    expect(getDocumentStatus({ hasCloudConfig: true, isCloudDeleted: true, saveState: "saving" }).kind).toBe("saving");
    expect(getDocumentStatus({ hasCloudConfig: true, isCloudDeleted: true, saveState: "dirty" }).kind).toBe("dirty");
  });

  it("noteInfoRows 状态行显示同一文案，恢复后回到已同步", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-del-info-"));
    const store = await makeStore(root);
    const nb = store.createNotebook("NB");
    store.createNoteInAtTopWithContent(nb.id, "Doc", "body", [], "n1");
    store.applyNotesCloudDeleted(["n1"]);
    const statusOf = (rows: Array<[string, string]>) => rows.find(([label]) => label === "状态")?.[1] ?? "";
    expect(statusOf(noteInfoRows(store.getNoteInfo("n1")))).toContain("云端已删除 · 仅本地");
    store.applyNotesCloudDeleted([]);
    expect(statusOf(noteInfoRows(store.getNoteInfo("n1")))).not.toContain("云端已删除");
  });
});
