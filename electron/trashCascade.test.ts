/**
 * 261114 回归护栏：带子级 / 多级子级的删除必须是「整棵子树一起移动进回收站」。
 *
 * 语义（AGENTS §3#5）：删除 = 软删 = 把**根节点**移进回收站笔记本（parent_id=回收站），
 * 子树节点 parent_id 保持不变、全部标 trashed_at；恢复整棵回原位置；purge 只删被 purge 的子树。
 *
 * 用户 261114 追问：删分组 / 删文档（文档下还有子文档）/ 多级嵌套是否有级联？本文件逐条钉住。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Store } from "./store.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  net: { fetch: vi.fn() },
}));

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-trash-cascade-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

type RawDb = InstanceType<typeof Database>;

function withRawDb<T>(fn: (db: RawDb) => T): T {
  const db = new Database(path.join(dir, "metadata.sqlite3"));
  try { return fn(db); } finally { db.close(); }
}

function nodeRow(db: RawDb, id: string): { parent_id: string | null; trashed_at: string | null; deleted_from_parent_id: string | null; deleted_at: string | null } {
  return db.prepare("SELECT parent_id,trashed_at,deleted_from_parent_id,deleted_at FROM tree_nodes WHERE id=?").get(id) as never;
}

function noteRow(db: RawDb, id: string): { parent_id: string | null; trashed_at: string | null } | undefined {
  return db.prepare("SELECT parent_id,trashed_at FROM notes WHERE id=?").get(id) as never;
}

function bodyPath(id: string): string {
  return path.join(dir, "notes", id + ".lake");
}

interface Fixture {
  store: Store;
  nb: string;
  groupA: string;
  groupB: string;
  docRoot: string;
  childDoc: string;
  grandDoc: string;
  sibling: string;
}

/** notebook > A > B > 根文档 > 子文档 > 孙文档，另有旁观文档（不应受牵连）。 */
function buildNestedFixture(): Fixture {
  const store = new Store(dir);
  const nb = store.createNotebook("NB");
  const groupA = store.createGroup(nb.id, "A");
  const groupB = store.createGroup(groupA.id, "B");
  const docRoot = store.createNoteIn(groupB.id, "根文档");
  const childDoc = store.createNoteIn(docRoot.id, "子文档");
  const grandDoc = store.createNoteIn(childDoc.id, "孙文档");
  const sibling = store.createNoteIn(nb.id, "旁观文档");
  return { store, nb: nb.id, groupA: groupA.id, groupB: groupB.id, docRoot: docRoot.id, childDoc: childDoc.id, grandDoc: grandDoc.id, sibling: sibling.id };
}

describe("261114 级联软删：带子级/多级子级的删除", () => {
  it("删分组：整棵多级子树（分组+子分组+多级文档）一起进回收站，可整棵恢复", () => {
    const f = buildNestedFixture();
    const { store } = f;
    const allNotes = [f.docRoot, f.childDoc, f.grandDoc];
    const allNodes = [f.groupA, f.groupB, ...allNotes];

    store.deleteTreeNode(f.groupA);

    // 1) DB：根 parent=回收站，其余 parent 原样保留；树节点与 notes 行全部 trashed_at 非空。
    withRawDb((db) => {
      expect(nodeRow(db, f.groupA).parent_id).toBe(TRASH_NOTEBOOK_ID);
      expect(nodeRow(db, f.groupA).trashed_at).toBeTruthy();
      expect(nodeRow(db, f.groupB).parent_id).toBe(f.groupA);
      expect(nodeRow(db, f.groupB).trashed_at).toBeTruthy();
      expect(nodeRow(db, f.docRoot).parent_id).toBe(f.groupB);
      expect(nodeRow(db, f.childDoc).parent_id).toBe(f.docRoot);
      expect(nodeRow(db, f.grandDoc).parent_id).toBe(f.childDoc);
      for (const id of allNodes) expect(nodeRow(db, id).trashed_at).toBeTruthy();
      for (const id of allNotes) {
        const note = noteRow(db, id);
        expect(note?.trashed_at).toBeTruthy();
        // 删除前父保留（恢复/跨端位置合一的依据）
        expect(nodeRow(db, id).deleted_from_parent_id).toBeTruthy();
      }
      // 旁观文档不受牵连
      expect(nodeRow(db, f.sibling).trashed_at ?? null).toBeNull();
      expect(noteRow(db, f.sibling)?.trashed_at ?? null).toBeNull();
    });

    // 2) 启动快照 / 目录树都不含被删子树，旁观文档仍在
    expect(store.bootstrap().notes.map((n) => n.id)).not.toEqual(expect.arrayContaining(allNotes));
    expect(store.bootstrap().notes.map((n) => n.id)).toContain(f.sibling);
    const liveTreeIds = store.listTreeNodes().map((n) => n.id);
    for (const id of allNodes) expect(liveTreeIds).not.toContain(id);
    expect(liveTreeIds).toContain(f.sibling);

    // 3) 回收站列表 = 完整多级子树（parent 链原样），根挂在回收站下
    const trash = store.listTrash();
    const byId = new Map(trash.map((item) => [item.id, item]));
    expect(byId.get(f.groupA)?.parentId).toBe(TRASH_NOTEBOOK_ID);
    expect(byId.get(f.groupB)?.parentId).toBe(f.groupA);
    expect(byId.get(f.docRoot)?.parentId).toBe(f.groupB);
    expect(byId.get(f.childDoc)?.parentId).toBe(f.docRoot);
    expect(byId.get(f.grandDoc)?.parentId).toBe(f.childDoc);
    for (const id of allNotes) expect(byId.has(id)).toBe(true);

    // 4) 同步元数据：所有被删文档都带 trashedAt（其他端才会跟着移动，不是只删根）
    const syncMeta = new Map(store.listNotesSyncMeta().map((m) => [m.id, m]));
    for (const id of allNotes) expect(syncMeta.get(id)?.trashedAt).toBeTruthy();
    expect(syncMeta.get(f.sibling)?.trashedAt ?? null).toBeNull();

    // 5) 打开入口判据：readNote 带 trashedAt、digest.deleted
    for (const id of allNotes) {
      expect(store.readNote(id).trashedAt).toBeTruthy();
      expect(store.getNoteDigest(id)?.deleted).toBe(true);
    }

    // 6) 整棵恢复：父子关系与 trashed 状态全部还原
    store.restoreTrashItem(f.groupA);
    withRawDb((db) => {
      expect(nodeRow(db, f.groupA).parent_id).toBe(f.nb);
      expect(nodeRow(db, f.groupB).parent_id).toBe(f.groupA);
      expect(nodeRow(db, f.docRoot).parent_id).toBe(f.groupB);
      expect(nodeRow(db, f.childDoc).parent_id).toBe(f.docRoot);
      expect(nodeRow(db, f.grandDoc).parent_id).toBe(f.childDoc);
      for (const id of allNodes) expect(nodeRow(db, id).trashed_at ?? null).toBeNull();
      for (const id of allNotes) expect(noteRow(db, id)?.trashed_at ?? null).toBeNull();
    });
    expect(store.bootstrap().notes.map((n) => n.id)).toEqual(expect.arrayContaining(allNotes));
    expect(store.listTrash().map((item) => item.id)).not.toEqual(expect.arrayContaining(allNodes));

    store.close?.();
  });

  it("删文档：文档自身的多级子文档一起进回收站，恢复回原父", () => {
    const f = buildNestedFixture();
    const { store } = f;
    store.deleteTreeNode(f.docRoot);
    withRawDb((db) => {
      expect(nodeRow(db, f.docRoot).parent_id).toBe(TRASH_NOTEBOOK_ID);
      expect(nodeRow(db, f.childDoc).parent_id).toBe(f.docRoot);
      expect(nodeRow(db, f.grandDoc).parent_id).toBe(f.childDoc);
      for (const id of [f.docRoot, f.childDoc, f.grandDoc]) {
        expect(nodeRow(db, id).trashed_at).toBeTruthy();
        expect(noteRow(db, id)?.trashed_at).toBeTruthy();
      }
      // 分组不进回收站
      expect(nodeRow(db, f.groupB).trashed_at ?? null).toBeNull();
      expect(nodeRow(db, f.groupA).trashed_at ?? null).toBeNull();
    });
    expect(store.listTrash().map((item) => item.id)).toEqual(expect.arrayContaining([f.docRoot, f.childDoc, f.grandDoc]));
    store.restoreTrashItem(f.docRoot);
    withRawDb((db) => {
      expect(nodeRow(db, f.docRoot).parent_id).toBe(f.groupB);
      expect(nodeRow(db, f.childDoc).parent_id).toBe(f.docRoot);
      expect(nodeRow(db, f.grandDoc).parent_id).toBe(f.childDoc);
      for (const id of [f.docRoot, f.childDoc, f.grandDoc]) expect(nodeRow(db, id).trashed_at ?? null).toBeNull();
    });
  });

  it("删笔记本：多级分组 + 多级文档（含孙文档）整棵进回收站，恢复回根层", () => {
    const f = buildNestedFixture();
    const { store } = f;
    const allNodes = [f.nb, f.groupA, f.groupB, f.docRoot, f.childDoc, f.grandDoc, f.sibling];
    const allNotes = [f.docRoot, f.childDoc, f.grandDoc, f.sibling];
    store.deleteTreeNode(f.nb);
    withRawDb((db) => {
      expect(nodeRow(db, f.nb).parent_id).toBe(TRASH_NOTEBOOK_ID);
      expect(nodeRow(db, f.groupA).parent_id).toBe(f.nb);
      expect(nodeRow(db, f.groupB).parent_id).toBe(f.groupA);
      expect(nodeRow(db, f.docRoot).parent_id).toBe(f.groupB);
      expect(nodeRow(db, f.childDoc).parent_id).toBe(f.docRoot);
      expect(nodeRow(db, f.grandDoc).parent_id).toBe(f.childDoc);
      for (const id of allNodes) expect(nodeRow(db, id).trashed_at).toBeTruthy();
      for (const id of allNotes) expect(noteRow(db, id)?.trashed_at).toBeTruthy();
    });
    // 启动快照：被删子树全部不出现；旁观（本 fixture 全在 NB 下 ⇒ 全部被删）
    expect(store.bootstrap().notes.map((n) => n.id)).not.toEqual(expect.arrayContaining(allNotes));
    // 回收站树：根是笔记本（parent=回收站），多级 parent 链保持
    const trash = new Map(store.listTrash().map((item) => [item.id, item]));
    expect(trash.get(f.nb)?.parentId).toBe(TRASH_NOTEBOOK_ID);
    expect(trash.get(f.groupA)?.parentId).toBe(f.nb);
    expect(trash.get(f.docRoot)?.parentId).toBe(f.groupB);
    expect(trash.get(f.grandDoc)?.parentId).toBe(f.childDoc);
    // 恢复：笔记本回根层、整棵父子与 trashed 状态还原
    store.restoreTrashItem(f.nb);
    withRawDb((db) => {
      expect(nodeRow(db, f.nb).parent_id).toBeNull();
      expect(nodeRow(db, f.groupA).parent_id).toBe(f.nb);
      expect(nodeRow(db, f.grandDoc).parent_id).toBe(f.childDoc);
      for (const id of allNodes) expect(nodeRow(db, id).trashed_at ?? null).toBeNull();
      for (const id of allNotes) expect(noteRow(db, id)?.trashed_at ?? null).toBeNull();
    });
    expect(store.bootstrap().notes.map((n) => n.id)).toEqual(expect.arrayContaining(allNotes));
    expect(store.listTrash()).toHaveLength(0);
  });

  it("彻底删除整本笔记本：多级子树全部物理清空（行+文件+逐条墓碑）", () => {
    const f = buildNestedFixture();
    const { store } = f;
    store.deleteTreeNode(f.nb);
    store.purgeTrashItem(f.nb);
    withRawDb((db) => {
      for (const id of [f.nb, f.groupA, f.groupB, f.docRoot, f.childDoc, f.grandDoc, f.sibling]) {
        expect(db.prepare("SELECT id FROM tree_nodes WHERE id=?").get(id)).toBeUndefined();
      }
      for (const id of [f.docRoot, f.childDoc, f.grandDoc, f.sibling]) {
        expect(db.prepare("SELECT id FROM notes WHERE id=?").get(id)).toBeUndefined();
      }
      const tomb = db.prepare("SELECT id,node_type FROM deleted_notes WHERE id IN (?,?,?,?,?,?)").all(f.nb, f.groupA, f.groupB, f.docRoot, f.childDoc, f.grandDoc) as Array<{ id: string; node_type: string }>;
      expect(tomb).toHaveLength(6);
      expect(tomb.find((t) => t.id === f.nb)?.node_type).toBe("folder");
      expect(tomb.filter((t) => t.node_type === "note").map((t) => t.id).sort()).toEqual([f.docRoot, f.childDoc, f.grandDoc].sort());
    });
    for (const id of [f.docRoot, f.childDoc, f.grandDoc, f.sibling]) expect(fs.existsSync(bodyPath(id))).toBe(false);
    expect(store.listTrash()).toHaveLength(0);
  });

  it("彻底删除回收站里的文档子树：只清该文档与其子文档，分组保留", () => {
    const f = buildNestedFixture();
    const { store } = f;
    store.deleteTreeNode(f.docRoot);
    store.purgeTrashItem(f.docRoot);
    withRawDb((db) => {
      for (const id of [f.docRoot, f.childDoc, f.grandDoc]) {
        expect(db.prepare("SELECT id FROM notes WHERE id=?").get(id)).toBeUndefined();
      }
      expect(nodeRow(db, f.groupB).trashed_at ?? null).toBeNull();
      expect(nodeRow(db, f.groupA).trashed_at ?? null).toBeNull();
      expect(nodeRow(db, f.sibling).trashed_at ?? null).toBeNull();
      const tomb = db.prepare("SELECT id FROM deleted_notes WHERE id IN (?,?,?)").all(f.docRoot, f.childDoc, f.grandDoc) as Array<{ id: string }>;
      expect(tomb.map((t) => t.id).sort()).toEqual([f.docRoot, f.childDoc, f.grandDoc].sort());
    });
    for (const id of [f.docRoot, f.childDoc, f.grandDoc]) expect(fs.existsSync(bodyPath(id))).toBe(false);
    expect(fs.existsSync(bodyPath(f.sibling))).toBe(true);
  });

  it("彻底删除回收站里的中间分组：只清该子树（行+正文文件），兄弟节点保留", () => {
    const f = buildNestedFixture();
    const { store } = f;
    store.deleteTreeNode(f.groupA);
    expect(fs.existsSync(bodyPath(f.grandDoc))).toBe(true);

    store.purgeTrashItem(f.groupB);
    withRawDb((db) => {
      for (const id of [f.groupB, f.docRoot, f.childDoc, f.grandDoc]) {
        expect(db.prepare("SELECT id FROM tree_nodes WHERE id=?").get(id)).toBeUndefined();
        expect(db.prepare("SELECT id FROM notes WHERE id=?").get(id)).toBeUndefined();
      }
      // 根 groupA 仍在回收站（只删了被点的子树）
      expect(nodeRow(db, f.groupA).parent_id).toBe(TRASH_NOTEBOOK_ID);
      // 墓碑：folder + 三篇 note
      const tomb = db.prepare("SELECT id,node_type,purged_at FROM deleted_notes WHERE id IN (?,?,?,?)").all(f.groupB, f.docRoot, f.childDoc, f.grandDoc) as Array<{ id: string; node_type: string; purged_at: string | null }>;
      expect(tomb.map((t) => t.id).sort()).toEqual([f.groupB, f.docRoot, f.childDoc, f.grandDoc].sort());
      for (const t of tomb) expect(t.purged_at).toBeTruthy();
      expect(tomb.find((t) => t.id === f.groupB)?.node_type).toBe("folder");
    });
    // 正文文件被清（回收站里的另一个分支不受影响：groupA 无正文）
    expect(fs.existsSync(bodyPath(f.grandDoc))).toBe(false);
    expect(fs.existsSync(bodyPath(f.childDoc))).toBe(false);
    expect(fs.existsSync(bodyPath(f.docRoot))).toBe(false);
  });

  it("批量/重复删除的幂等与层级：子项先被删、父项后被删，恢复父项时子项跟随回原父", () => {
    const f = buildNestedFixture();
    const { store } = f;
    // 模拟批量删除「父分组 + 其中子文档」但**子项先处理**：子文档先成为回收站根。
    store.deleteTreeNode(f.childDoc);
    withRawDb((db) => expect(nodeRow(db, f.childDoc).parent_id).toBe(TRASH_NOTEBOOK_ID));
    store.deleteTreeNode(f.groupA);
    // 已 trashed 的子文档不再被改成回收站根（保持可回溯的 deleted_from_parent 链）
    withRawDb((db) => {
      expect(nodeRow(db, f.groupA).parent_id).toBe(TRASH_NOTEBOOK_ID);
      expect(nodeRow(db, f.docRoot).parent_id).toBe(f.groupB);
      expect(nodeRow(db, f.grandDoc).parent_id).toBe(f.childDoc);
      for (const id of [f.childDoc, f.grandDoc]) expect(nodeRow(db, id).trashed_at).toBeTruthy();
    });
    // 重复删除（已 trashed、parent 不是回收站的子项）必须幂等：不抛错、不改 parent
    expect(() => store.deleteTreeNode(f.childDoc)).not.toThrow();
    withRawDb((db) => {
      expect(nodeRow(db, f.childDoc).parent_id).toBe(TRASH_NOTEBOOK_ID);
      expect(nodeRow(db, f.grandDoc).parent_id).toBe(f.childDoc);
    });
    // 恢复父分组：flattenedSubtreeIds 会把「已先成回收站根」的子文档也收进来并归位到原父
    store.restoreTrashItem(f.groupA);
    withRawDb((db) => {
      expect(nodeRow(db, f.groupA).parent_id).toBe(f.nb);
      expect(nodeRow(db, f.groupB).parent_id).toBe(f.groupA);
      expect(nodeRow(db, f.docRoot).parent_id).toBe(f.groupB);
      expect(nodeRow(db, f.childDoc).parent_id).toBe(f.docRoot);
      expect(nodeRow(db, f.grandDoc).parent_id).toBe(f.childDoc);
      for (const id of [f.groupA, f.groupB, f.docRoot, f.childDoc, f.grandDoc]) expect(nodeRow(db, id).trashed_at ?? null).toBeNull();
    });
  });

  it("清空回收站：多级子树的全部行/文件清空，墓碑逐条落库", () => {
    const f = buildNestedFixture();
    const { store } = f;
    store.deleteTreeNode(f.groupA);
    const result = store.emptyTrash();
    expect(result.purged).toBeGreaterThanOrEqual(1);
    withRawDb((db) => {
      for (const id of [f.groupA, f.groupB, f.docRoot, f.childDoc, f.grandDoc]) {
        expect(db.prepare("SELECT id FROM tree_nodes WHERE id=?").get(id)).toBeUndefined();
        expect(db.prepare("SELECT id FROM notes WHERE id=?").get(id)).toBeUndefined();
      }
      // 旁观文档仍在
      expect(db.prepare("SELECT id FROM notes WHERE id=?").get(f.sibling)).toBeTruthy();
    });
    expect(store.listTrash()).toHaveLength(0);
    for (const id of [f.docRoot, f.childDoc, f.grandDoc]) expect(fs.existsSync(bodyPath(id))).toBe(false);
  });
});
