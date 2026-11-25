/**
 * C-06 护栏（搬移前钉语义）：同步账本「markSynced 族」表驱动单测。
 * 职责：把 store.ts 同步账本写入族的可观察语义逐条钉死，作为搬移到
 * electron/syncStateBookkeeping.ts 的行为基线 —— 搬移是纯搬家，本文件用例断言必须原样通过。
 * 覆盖（真逻辑面）：markNotesSyncedIfUnchanged 守卫式归位 / markNotesSynced 批量归位 /
 * applyNotesCloudDeleted 置位清除（含目录行 261124 B8）/ restore_pending_at 清除红线 /
 * syncInterrupted 断点续传标记 / listPurgedTombstones / markRemoteNoteIds 回填。
 * 契约指针：AGENTS §3#4（恢复标记在 markSynced 清除）、§7#4（markSynced 同改 tree_nodes）、
 * docs/SYNC-PROTOCOL.md §9.6（写守卫调用方分类）。
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "./store.js";

async function makeStore(): Promise<Store> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sync-bookkeeping-"));
  const store = new Store(root);
  store.bootstrap();
  return store;
}

/** 种一篇脏文档（is_dirty=1），返回它的 updated_at 快照（= 同步清单构建时刻）。 */
function seedDoc(store: Store, id: string): string {
  const summaries = () => store.listNoteSummaries().find((n) => n.id === id);
  if (!summaries()) {
    const parent = store.createNotebook("NB-" + id);
    store.createNoteInAtTopWithContent(parent.id, "Doc " + id, "<p>x</p>", [], id);
  }
  return summaries()?.updatedAt ?? "";
}

const dirtyOf = (store: Store, id: string) => store.listNoteSummaries().find((n) => n.id === id)?.isDirty;

describe("markNotesSyncedIfUnchanged：守卫式归位（261107 数据安全）", () => {
  const cases = [
    {
      name: "updatedAt 未变 ⇒ 归位：清 is_dirty + 清 restore_pending_at",
      edit: false,
      expect: { cleared: 1, kept: 0 },
      dirtyAfter: false,
      restoreAfter: false,
    },
    {
      name: "同步窗口内被编辑（updated_at 前移）⇒ kept：dirty 与恢复标记都保留给下一轮重传",
      edit: true,
      expect: { cleared: 0, kept: 1 },
      dirtyAfter: true,
      restoreAfter: true,
    },
  ] as const;
  for (const c of cases) {
    it(c.name, async () => {
      const store = await makeStore();
      seedDoc(store, "n1");
      // 恢复标记场景：移入回收站再恢复 ⇒ restore_pending_at（AGENTS §3#4 唯一 local-wins 例外）。
      store.deleteTreeNode("n1");
      store.restoreTrashItem("n1");
      expect(store.syncState.listRestorePendingNoteIds()).toContain("n1");
      // 快照 = 同步清单构建时刻（恢复等准备动作都已落定）；edit 模拟「清单构建后又被编辑」。
      const before = store.listNoteSummaries().find((n) => n.id === "n1")?.updatedAt ?? "";
      if (c.edit) store.saveNote("n1", "改过", "<p>edited</p>");
      expect(store.syncState.markNotesSyncedIfUnchanged([{ id: "n1", updatedAt: before }])).toEqual(c.expect);
      expect(dirtyOf(store, "n1") === true).toBe(c.dirtyAfter);
      expect(store.syncState.listRestorePendingNoteIds().includes("n1")).toBe(c.restoreAfter);
    });
  }

  it("已 purge 行（is_purged=1）⇒ 不清不计（无需清 UI 标记，也不算 kept）", async () => {
    const store = await makeStore();
    const before = seedDoc(store, "p1");
    store.deleteTreeNode("p1");
    store.purgeTrashItem("p1");
    expect(store.isPurgedNoteId("p1")).toBe(true);
    expect(store.syncState.markNotesSyncedIfUnchanged([{ id: "p1", updatedAt: before }])).toEqual({ cleared: 0, kept: 0 });
  });

  it("跨批（>400 行）不丢行：401 行未变全部归位", { timeout: 60_000 }, async () => {
    const store = await makeStore();
    const parent = store.createNotebook("NB-bulk");
    const ids: string[] = [];
    for (let i = 0; i < 401; i++) {
      const id = "b" + i;
      store.createNoteInAtTopWithContent(parent.id, "D" + i, "<p>x</p>", [], id);
      ids.push(id);
    }
    // 快照在全部种入后统一取（= 清单构建时刻；后续插入会顶改兄弟行 sort/updated_at，属真实行为）。
    const rows = store.listNoteSummaries()
      .filter((n) => ids.includes(n.id))
      .map((n) => ({ id: n.id, updatedAt: n.updatedAt }));
    expect(store.syncState.markNotesSyncedIfUnchanged(rows)).toEqual({ cleared: 401, kept: 0 });
  });
});

describe("markNotesSynced / markSynced：无条件归位（发布成功后）", () => {
  it("清 is_dirty + 清 restore_pending_at（AGENTS §3#4：标记在 markSynced 清除）", async () => {
    const store = await makeStore();
    seedDoc(store, "n1");
    store.deleteTreeNode("n1");
    store.restoreTrashItem("n1");
    store.syncState.markNotesSynced(["n1"]);
    expect(dirtyOf(store, "n1")).toBeUndefined();
    expect(store.syncState.listRestorePendingNoteIds()).toEqual([]);
    // 幂等：重复调用不抛错、不回写标记
    store.syncState.markNotesSynced(["n1"]);
    expect(store.syncState.listRestorePendingNoteIds()).toEqual([]);
  });

  it("跨批（>200 行）不丢行：201 行全部归位", { timeout: 60_000 }, async () => {
    const store = await makeStore();
    const parent = store.createNotebook("NB-bulk2");
    const ids: string[] = [];
    for (let i = 0; i < 201; i++) {
      const id = "c" + i;
      store.createNoteInAtTopWithContent(parent.id, "D" + i, "<p>x</p>", [], id);
      ids.push(id);
    }
    store.syncState.markNotesSynced(ids);
    expect(store.listNoteSummaries().filter((n) => ids.includes(n.id) && n.isDirty === true)).toEqual([]);
  });

  it("markSynced（单条）同语义：清 dirty + 清恢复标记", async () => {
    const store = await makeStore();
    seedDoc(store, "n1");
    store.deleteTreeNode("n1");
    store.restoreTrashItem("n1");
    store.syncState.markSynced("n1");
    expect(dirtyOf(store, "n1")).toBeUndefined();
    expect(store.syncState.listRestorePendingNoteIds()).toEqual([]);
  });
});

describe("applyNotesCloudDeleted：cloud_deleted 置位/清除（含目录行 B8）", () => {
  it("新 id 置位：notes 与 tree_nodes 双打标；再清空集合 ⇒ 双清", async () => {
    const store = await makeStore();
    seedDoc(store, "n1");
    store.syncState.applyNotesCloudDeleted(["n1"]);
    expect(store.syncState.listCloudDeletedNoteIds()).toEqual(["n1"]);
    expect(store.listTreeNodes().find((n) => n.id === "n1")?.cloudDeleted).toBe(true);
    store.syncState.applyNotesCloudDeleted([]);
    expect(store.syncState.listCloudDeletedNoteIds()).toEqual([]);
    expect(store.listTreeNodes().find((n) => n.id === "n1")?.cloudDeleted).toBeUndefined();
  });

  it("目录行（note_file_id=NULL）按节点 id 立标与清标（261124 B8）", async () => {
    const store = await makeStore();
    const folder = store.createNotebook("F1");
    store.syncState.applyNotesCloudDeleted([folder.id]);
    expect(store.listTreeNodes().find((n) => n.id === folder.id)?.cloudDeleted).toBe(true);
    store.syncState.applyNotesCloudDeleted([]);
    expect(store.listTreeNodes().find((n) => n.id === folder.id)?.cloudDeleted).toBeUndefined();
  });

  it("非法 id 段被过滤（不写库、不抛错）；稳态重复调用幂等", async () => {
    const store = await makeStore();
    seedDoc(store, "n1");
    store.syncState.applyNotesCloudDeleted(["../evil", "a/b", "n1"]);
    expect(store.syncState.listCloudDeletedNoteIds()).toEqual(["n1"]);
    store.syncState.applyNotesCloudDeleted(["n1"]);
    expect(store.syncState.listCloudDeletedNoteIds()).toEqual(["n1"]);
  });
});

describe("断点续传标记（syncInterrupted）与墓碑/回填", () => {
  it("markSyncInterrupted 覆盖写、getSyncInterruptedAt 读回、clearSyncInterrupted 清空且幂等", async () => {
    const store = await makeStore();
    expect(store.syncState.getSyncInterruptedAt()).toBeNull();
    store.syncState.markSyncInterrupted("2026-11-25T00:00:00.000Z");
    expect(store.syncState.getSyncInterruptedAt()).toBe("2026-11-25T00:00:00.000Z");
    store.syncState.markSyncInterrupted("2026-11-25T01:00:00.000Z");
    expect(store.syncState.getSyncInterruptedAt()).toBe("2026-11-25T01:00:00.000Z");
    store.syncState.clearSyncInterrupted();
    expect(store.syncState.getSyncInterruptedAt()).toBeNull();
    store.syncState.clearSyncInterrupted();
  });

  it("listPurgedTombstones 只收 purged_at 非空（purge 才是墓碑，软删不算）", async () => {
    const store = await makeStore();
    seedDoc(store, "n1");
    store.deleteTreeNode("n1");
    expect(store.syncState.listPurgedTombstones()).toEqual([]);
    store.purgeTrashItem("n1");
    const rows = store.syncState.listPurgedTombstones();
    expect(rows.map((r) => r.id)).toContain("n1");
    expect(rows.find((r) => r.id === "n1")?.purgedAt).toBeTruthy();
  });

  it("markRemoteNoteIds 回填「云端有副本」事实 ⇒ listMissingBodies.hasSyncBase=true", async () => {
    const store = await makeStore();
    seedDoc(store, "n1");
    await fs.rm(store.notePathFor("n1")); // 手动删正文文件 ⇒ 缺正文
    expect(store.missingBody.listMissingBodies().find((d) => d.id === "n1")?.hasSyncBase).toBe(false);
    store.syncState.markRemoteNoteIds(["n1"]);
    expect(store.missingBody.listMissingBodies().find((d) => d.id === "n1")?.hasSyncBase).toBe(true);
    // 事件驱动：缺正文清单发现缺失才入队恢复队列
    expect(store.missingBody.listBodyRecoveryPending()).toContain("n1");
    store.missingBody.clearBodyRecoveryPending();
  });
});
