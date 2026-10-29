/**
 * E2-4 phase B：共享 loadState/saveState 编排的**内存端口**等价性测试。
 *
 * 判据：同 fixture 输入 → 与桌面适配器（迁移前）逐字段同结果；saveState 只通过 PlatformDataPort 落库，
 * 共享层不 import 平台代码。真实等价性由 electron/s3v3 全目录 conformance/engine/store 对拍另锁。
 */
import { describe, expect, it } from "vitest";
import type { DeviceState } from "../../s3v3DeviceStore.js";
import { createFileBackedAssetIo, createDeviceStoreMeta } from "./deviceStore.js";
import { toPersistedState } from "./intentLogState.js";
import { sha256Hex } from "../../syncUtils.js";
import type { FileDriver } from "./ports.js";
import type { PlatformDataPort, SyncNoteWrite } from "./platformPort.js";

const H = (c: string): string => c.repeat(64);

function memoryFiles(initial: Record<string, Uint8Array> = {}): FileDriver & { files: Map<string, Uint8Array> } {
  const files = new Map(Object.entries(initial));
  const norm = (p: string): string => p.replace(/\/+$/, "");
  return {
    files,
    async read(p) { return files.get(norm(p)) ?? null; },
    async writeAtomic(p, bytes) { files.set(norm(p), new Uint8Array(bytes)); },
    async remove(p) { files.delete(norm(p)); },
    async removeDir(p) { const pre = norm(p) + "/"; for (const k of [...files.keys()]) if (k.startsWith(pre)) files.delete(k); },
    async list(p) { const pre = norm(p) + "/"; return [...files.keys()].filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map((k) => k.slice(pre.length)); },
    async mkdir() { /* no-op */ },
    async stat(p) { const b = files.get(norm(p)); return b ? { size: b.length, mtimeMs: 7 } : null; },
  };
}

/** 内存 PlatformDataPort：记录写调用，读世界可注入。 */
function memoryPlatform(world: Partial<{ folders: any[]; notes: any[]; quickNotes: any[]; quickTags: any[]; quickDeleted: any[]; purged: any[]; restoreNotes: string[]; restoreQuick: string[]; recovery: string[] }> = {}, withDiscard = false) {
  const calls: string[] = [];
  const w = {
    folders: world.folders ?? [], notes: world.notes ?? [], quickNotes: world.quickNotes ?? [],
    quickTags: world.quickTags ?? [], quickDeleted: world.quickDeleted ?? [], purged: world.purged ?? [],
    restoreNotes: world.restoreNotes ?? [], restoreQuick: world.restoreQuick ?? [], recovery: world.recovery ?? [],
  };
  const importedNotes = new Map<string, SyncNoteWrite>();
  const port: PlatformDataPort = {
    async listFoldersForSync() { return w.folders; },
    async listNotesSyncMeta() { return w.notes; },
    async listQuickNotesForSync() { return w.quickNotes; },
    async listQuickTags() { return w.quickTags; },
    async listQuickDeleted() { return w.quickDeleted; },
    async listQuickPurges() { return w.quickDeleted.filter((d) => d.purgedAt).map((d) => ({ id: d.id, purgedAt: d.purgedAt })); },
    async listPurgedTombstones() { return w.purged; },
    async listRestorePendingNoteIds() { return w.restoreNotes; },
    async listRestorePendingQuickNoteIds() { return w.restoreQuick; },
    async listBodyRecoveryPending() { return w.recovery; },
    noteBodyPath(id) { return "bodies/" + id + ".lake"; },
    quickNoteBodyPath(id) { return "quick/" + id + ".qnote"; },
    async hasNote(id) { return w.notes.some((n) => n.id === id); },
    async hasTreeNode(id) { return w.folders.some((f) => f.id === id); },
    async defaultNotebookId() { calls.push("defaultNotebookId"); return "notebook-fallback"; },
    async importRemoteNote(note) { calls.push("importRemoteNote:" + note.id); importedNotes.set(note.id, note); },
    async saveNote(id) { calls.push("saveNote:" + id); },
    async applyRemoteNoteMeta(note) { calls.push("applyRemoteNoteMeta:" + note.id); importedNotes.set(note.id, note); },
    async applyRemoteEditLock(id) { calls.push("applyRemoteEditLock:" + id); },
    async setNodeIcon(id) { calls.push("setNodeIcon:" + id); },
    async deleteNote(id) { calls.push("deleteNote:" + id); },
    async restoreTrashItem(id) { calls.push("restoreTrashItem:" + id); },
    async applyNotesCloudDeleted(ids) { calls.push("applyNotesCloudDeleted:" + ids.join(",")); },
    async markBodyRecoveryPending(ids) { calls.push("markBodyRecoveryPending:" + ids.join(",")); },
    async clearBodyRecoveryPending() { calls.push("clearBodyRecoveryPending"); },
    async importRemoteFolder(f) { calls.push("importRemoteFolder:" + f.id); },
    async applyRemoteFolderMeta(f) { calls.push("applyRemoteFolderMeta:" + f.id); },
    async deleteTreeNode(id) { calls.push("deleteTreeNode:" + id); },
    async listMissingQuickNoteIds() { return []; },
    async purgeOrphanQuickNote(id) { calls.push("purgeOrphanQuickNote:" + id); },
    async importRemoteQuickNote(item) { calls.push("importRemoteQuickNote:" + item.id); },
    async markQuickNoteSyncedIfUnchanged(id) { calls.push("markQuickNoteSyncedIfUnchanged:" + id); },
    async applyQuickNoteTagLinks(id) { calls.push("applyQuickNoteTagLinks:" + id); },
    async mergeQuickTags(tags) { calls.push("mergeQuickTags:" + tags.length); },
    async purgeQuickNote(id) { calls.push("purgeQuickNote:" + id); },
    async deleteQuickNote(id) { calls.push("deleteQuickNote:" + id); },
    async markQuickNotesCloudDeleted(ids) { calls.push("markQuickNotesCloudDeleted:" + ids.join(",")); },
    ...(withDiscard ? { async discardQuickNote(id: string) { calls.push("discardQuickNote:" + id); } } : {}),
  };
  return { port, calls, world: w, importedNotes };
}

function makeStore(files: FileDriver, platform: PlatformDataPort, persisted: unknown, opts: { hashCache?: Map<string, { mtimeMs: number; size: number; hash: string }> } = {}) {
  const written: unknown[] = [];
  const meta = createDeviceStoreMeta({
    platform,
    files,
    assets: createFileBackedAssetIo({ files, assetDirFor: (id) => "assets/" + id, quickAssetDirFor: (id) => "quick-assets/" + id }),
    state: { read: async () => persisted, write: async (p) => { written.push(p); } },
    baseline: { load: async () => ({ epoch: "e1", generation: 5, lakeCommit: "c1", quickNotesCommit: "q1", lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] } }) },
    stagedBodies: new Map<string, Uint8Array>() as never,
    ...(opts.hashCache ? { hashCache: opts.hashCache } : {}),
  });
  return { meta, written };
}

describe("createDeviceStoreMeta.loadState（内存端口等价）", () => {
  it("世界投影 + 信封字段 + DB 事实合并成完整 DeviceState（逐字段）", async () => {
    const files = memoryFiles({ "bodies/n2.lake": new TextEncoder().encode("body-n2") });
    const platform = memoryPlatform({
      folders: [
        { id: "nb1", title: "NB", parentId: null, sortOrder: 0, nodeType: "notebook", icon: "book", updatedAt: "T0" },
        { id: "g1", title: "G", parentId: "nb1", sortOrder: 1, nodeType: "group", icon: null, updatedAt: "T0", trashedAt: "T1", deletedFromParentId: "nb1" },
      ],
      notes: [
        { id: "n1", title: "N1", parentId: "nb1", sortOrder: 0, updatedAt: "T0", contentHash: H("a"), kind: "doc", icon: null, isEditLocked: false, editLockedAt: null, isConflict: false, trashedAt: null, deletedFromParentId: null },
        // contentHash 空 ⇒ 用 FileDriver stat/read 现算；并写入 hashCache
        { id: "n2", title: "N2", parentId: "nb1", sortOrder: 1, updatedAt: "T0", contentHash: "", kind: "bitable", icon: "x", isEditLocked: true, editLockedAt: "T9", isConflict: true, trashedAt: "T2", deletedFromParentId: "nb1" },
      ],
      quickNotes: [
        { id: "q1", createdAt: "T0", updatedAt: "T0", contentHash: H("c"), isConflict: false, tagIds: ["t1"], tagsUpdatedAt: "T3" },
      ],
      quickTags: [
        { id: "t1", name: "标签", sortOrder: 0, pinned: true, createdAt: "T0", updatedAt: "T0", deletedAt: null },
        { id: "t2", name: "已删", sortOrder: 1, pinned: false, createdAt: "T0", updatedAt: "T0", deletedAt: "T4" },
      ],
      quickDeleted: [{ id: "q2", purgedAt: null }, { id: "q3", purgedAt: "T5" }],
      purged: [{ id: "n9", purgedAt: "T6" }],
      restoreNotes: ["n1"], restoreQuick: ["q1"], recovery: ["n7"],
    });
    const hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();
    const persisted = toPersistedState({
      lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [],
      intents: [{ noteId: "n5", targetEpoch: "e0", targetGeneration: 2 }],
      pending: [], remotePurged: ["n8"], restorePending: ["n8"], quickDeletes: [], quickPurges: [], quickPurgeTimes: {},
      pendingAssets: [{ space: "lake", id: "n1", filename: "a.png", size: 1, hash: H("d"), attempts: 1 }],
    } as DeviceState);
    persisted.assets = { lake: { n1: H("e") }, quickNotes: { q1: H("f") } };
    const { meta } = makeStore(files, platform.port, persisted, { hashCache });
    const state = await meta.loadState();

    expect(state.folders.map((f) => f.id)).toEqual(["nb1", "g1"]);
    expect(state.folders[1]).toMatchObject({ trashedAt: "T1", deletedFromParentId: "nb1" });
    expect(state.lake.notes.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(state.lake.notes[0]).toMatchObject({ contentHash: H("a"), isLocked: false, isConflict: false, assetsHash: H("e") });
    const n2Hash = sha256Hex(new TextEncoder().encode("body-n2"));
    expect(state.lake.notes[1]).toMatchObject({ contentHash: n2Hash, kind: "bitable", isLocked: true, lockedAt: "T9", isConflict: true, trashedAt: "T2", deletedFromParentId: "nb1", icon: "x" });
    // hashCache 现算并写入（mtime/size 来自 FileDriver.stat）
    expect(hashCache.get("n2")).toEqual({ mtimeMs: 7, size: new TextEncoder().encode("body-n2").length, hash: n2Hash });
    expect(state.quickNotes.items[0]).toMatchObject({ id: "q1", tagIds: ["t1"], tagsUpdatedAt: "T3", assetsHash: H("f") });
    expect(state.quickNotes.tags?.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(state.quickDeletes).toEqual(["q2", "q3"]);
    expect(state.quickPurges).toEqual(["q3"]);
    expect(state.quickPurgeTimes).toEqual({ q3: "T5" });
    // 信封里的删除意图 + DB purge 墓碑合并；target 世代取 baseline
    expect(state.intents.map((i) => i.noteId)).toEqual(["n5", "n9"]);
    expect(state.intents[1]).toMatchObject({ targetEpoch: "e1", targetGeneration: 5, purgedAt: "T6" });
    expect(state.remotePurged).toEqual(["n8"]);
    expect(state.restorePending).toEqual(["n1", "n8", "q1"]);
    expect(state.bodyRecoveryPending).toEqual(["n7"]);
    expect(state.pendingAssets).toHaveLength(1);
  });

  it("DB cloud_deleted 投影 + 信封标记：恢复/本地 purge 的 id 按同一判据失效，其余保留（稳定排序）", async () => {
    const files = memoryFiles();
    const noteRow = (id: string, cloudDeleted: boolean) => ({
      id, title: id, parentId: null, sortOrder: 0, updatedAt: "T0", contentHash: H("a"), kind: "doc", icon: null,
      isEditLocked: false, editLockedAt: null, isConflict: false, trashedAt: null, deletedFromParentId: null, cloudDeleted,
    });
    const platform = memoryPlatform({
      notes: [noteRow("n1", true), noteRow("n2", true)],
      quickDeleted: [{ id: "q3", purgedAt: "T5" }],
      purged: [{ id: "n9", purgedAt: "T6" }],
      restoreNotes: ["n1"],
    });
    // 信封里的旧标记：n1 已被用户恢复、n9 已本地 purge、q3 已彻底删除 ⇒ 三条都必须失效；
    // n2 仍是「仅本地」副本、keep 与行无关（适配器不清）⇒ 保留。
    const persisted = toPersistedState({
      lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] }, folders: [],
      intents: [], pending: [], remotePurged: ["n1", "n2", "n9", "q3", "keep"], restorePending: ["n1"],
      quickDeletes: [], quickPurges: ["q3"], quickPurgeTimes: { q3: "T5" }, bodyRecoveryPending: [], pendingAssets: [],
    } as DeviceState);
    const { meta } = makeStore(files, platform.port, persisted);
    const state = await meta.loadState();
    expect(state.restorePending).toContain("n1");
    expect(state.quickPurges).toEqual(["q3"]);
    expect(state.remotePurged).toEqual(["keep", "n2"]);
  });

  it("正文文件缺失 + contentHash 空 ⇒ 跳过该篇并失效 hash 缓存（不写空正文）", async () => {
    const files = memoryFiles();
    const platform = memoryPlatform({ notes: [{ id: "n1", title: "N1", parentId: null, sortOrder: 0, updatedAt: "T0", contentHash: "", kind: "doc", icon: null, isEditLocked: false, editLockedAt: null, isConflict: false, trashedAt: null, deletedFromParentId: null }] });
    const hashCache = new Map([["n1", { mtimeMs: 1, size: 1, hash: H("a") }]]);
    const { meta } = makeStore(files, platform.port, null, { hashCache });
    const state = await meta.loadState();
    expect(state.lake.notes).toEqual([]);
    expect(hashCache.has("n1")).toBe(false);
  });
});

describe("createDeviceStoreMeta.saveState（只经端口落库）", () => {
  it("新文档（staged 正文）→ importRemoteNote；目录先于文档；信封只留本地仍存在的 remotePurged", async () => {
    const files = memoryFiles();
    // 本地已有 n1 行（hasNote 判据）；gone 无行 ⇒ 从信封清掉
    const platform = memoryPlatform({ folders: [], notes: [{ id: "n1", title: "N1", parentId: null, sortOrder: 0, updatedAt: "T1", contentHash: H("a"), kind: "doc", icon: null, isEditLocked: false, editLockedAt: null, isConflict: false, trashedAt: null, deletedFromParentId: null }] });
    const staged = new Map<string, Uint8Array>([["n1", new TextEncoder().encode("hello")]]);
    const written: unknown[] = [];
    const meta = createDeviceStoreMeta({
      platform: platform.port,
      files,
      assets: createFileBackedAssetIo({ files, assetDirFor: (id) => "assets/" + id }),
      state: { read: async () => null, write: async (p) => { written.push(p); } },
      baseline: { load: async () => null },
      stagedBodies: staged,
    });
    const state: DeviceState = {
      lake: { v: 3, space: "lake", notes: [{ id: "n1", title: "N1", parentId: null, sortOrder: 0, updatedAt: "T1", contentHash: H("a") }], folders: [] },
      quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
      folders: [],
      intents: [], pending: [], remotePurged: ["n1", "gone"], restorePending: [],
    };
    await meta.saveState(state);
    expect(platform.calls).toContain("importRemoteNote:n1");
    expect(platform.calls).toContain("applyNotesCloudDeleted:n1"); // gone 本地无行 ⇒ 从信封清掉
    expect(staged.size).toBe(0); // staging 消费后清空
    const envelope = written[0] as { version?: number; records?: Array<{ kind: string; id?: string }> };
    expect(envelope.version).toBe(3);
    expect(envelope.records?.filter((r) => r.kind === "cloud-deleted").map((r) => r.id)).toEqual(["n1"]);
  });

  it("远端墓碑 → 软删；远端恢复 → restoreTrashItem；目录缺失 → deleteTreeNode（不回删兜底目录）", async () => {
    const files = memoryFiles();
    const platform = memoryPlatform({
      folders: [
        { id: "old", title: "旧目录", parentId: null, sortOrder: 0, nodeType: "notebook", icon: null, updatedAt: "T0" },
        { id: "trash", title: "回收站", parentId: null, sortOrder: 9, nodeType: "notebook", icon: null, updatedAt: "T0" },
      ],
      notes: [
        { id: "n1", title: "N1", parentId: null, sortOrder: 0, updatedAt: "T0", contentHash: H("a"), kind: "doc", icon: null, isEditLocked: false, editLockedAt: null, isConflict: false, trashedAt: null, deletedFromParentId: null },
        { id: "n2", title: "N2", parentId: "trash", sortOrder: 0, updatedAt: "T0", contentHash: H("b"), kind: "doc", icon: null, isEditLocked: false, editLockedAt: null, isConflict: false, trashedAt: "T1", deletedFromParentId: null },
      ],
    });
    const meta = createDeviceStoreMeta({
      platform: platform.port,
      files,
      assets: createFileBackedAssetIo({ files, assetDirFor: (id) => "assets/" + id }),
      state: { read: async () => null, write: async () => {} },
      baseline: { load: async () => null },
      stagedBodies: new Map(),
      protectedFolderIds: new Set(["fallback"]),
    });
    const state: DeviceState = {
      lake: { v: 3, space: "lake", notes: [
        { id: "n1", title: "N1", parentId: null, sortOrder: 0, updatedAt: "T0", contentHash: H("a"), trashedAt: "T3", deletedFromParentId: null },
        { id: "n2", title: "N2", parentId: "fallback", sortOrder: 0, updatedAt: "T0", contentHash: H("b") },
      ], folders: [] },
      quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
      // 回收站容器仍在 state.folders 里（世界投影会带上它）⇒ 不属 deleteMissing
      folders: [{ id: "trash", title: "回收站", parentId: null, sortOrder: 9, nodeType: "notebook", icon: null, updatedAt: "T0" }],
      intents: [], pending: [], remotePurged: [], restorePending: [],
    };
    await meta.saveState(state);
    expect(platform.calls).toContain("deleteNote:n1");
    expect(platform.calls).toContain("restoreTrashItem:n2");
    expect(platform.calls).toContain("deleteTreeNode:old");
    expect(platform.calls).not.toContain("deleteTreeNode:trash");
  });

  it("quick 缺失三态（C-3 第 4 处漂移）：purge / baseline 内→软删打标 / 从未同步→物理删（无 discard 端口则回落软删）", async () => {
    const files = memoryFiles();
    const platform = memoryPlatform({
      folders: [], notes: [],
      quickNotes: [
        { id: "qp", createdAt: "T0", updatedAt: "T0", contentHash: H("a"), isConflict: false, tagIds: [], tagsUpdatedAt: null },
        { id: "qc", createdAt: "T0", updatedAt: "T0", contentHash: H("b"), isConflict: false, tagIds: [], tagsUpdatedAt: null },
        { id: "qn", createdAt: "T0", updatedAt: "T0", contentHash: H("c"), isConflict: false, tagIds: [], tagsUpdatedAt: null },
      ],
    }, true);
    const meta = createDeviceStoreMeta({
      platform: platform.port,
      files,
      assets: createFileBackedAssetIo({ files, assetDirFor: (id) => "assets/" + id, quickAssetDirFor: (id) => "quick-assets/" + id }),
      state: { read: async () => null, write: async () => {} },
      baseline: { load: async () => ({ epoch: "e1", generation: 1, lakeCommit: "c", quickNotesCommit: "q", lake: { v: 3, space: "lake", notes: [], folders: [] }, quickNotes: { v: 3, space: "quickNotes", items: [{ id: "qc", createdAt: "T0", updatedAt: "T0", contentHash: H("b") }], tags: [] } }) },
      stagedBodies: new Map(),
    });
    const state: DeviceState = {
      lake: { v: 3, space: "lake", notes: [], folders: [] },
      quickNotes: { v: 3, space: "quickNotes", items: [], tags: [] },
      folders: [], intents: [], pending: [], quickPurges: ["qp"],
      remotePurged: [], restorePending: [],
    };
    await meta.saveState(state);
    expect(platform.calls).toContain("purgeQuickNote:qp");
    expect(platform.calls).toContain("deleteQuickNote:qc"); // baseline 内 ⇒ 软删
    expect(platform.calls).toContain("discardQuickNote:qn"); // 从未同步 + 有 discard 端口 ⇒ 物理删
    expect(platform.calls).toContain("markQuickNotesCloudDeleted:qc"); // 只有软删的进打标集合
  });
});
