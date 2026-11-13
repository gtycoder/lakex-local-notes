/**
 * 261114 追加回归：带子级 / 多级子级的删除在移动端也必须是「整棵子树进回收站」。
 *
 * 桌面已由 electron/trashCascade.test.ts 钉住；移动端用户 261114 追问同类场景。
 * 注意：移动端 notes 与 folders 都可作为父节点（collectSubtree 明确支持「note 也可作为父节点」）。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
}));

vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  statNoteAssetSizesFs: vi.fn(async () => null),
  removeAssetBytesFs: vi.fn(async () => {}),
  removeNoteAssetsDirFs: vi.fn(async () => {}),
}));

import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { listTrashTree, purgeTreeItem, restoreTreeItem, trashTreeItem } from "./trashRepository.js";
import { trashNote } from "./noteRepository.js";
import { readNoteBody, writeNoteBody } from "./noteBodies.js";

const T = "2026-11-13T00:00:00.000Z";

async function freshDb() {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

async function insertFolder(db: SqlJsAsyncDb, id: string, kind: "notebook" | "group", parentId: string | null): Promise<void> {
  await db.prepare("INSERT INTO folders(id,title,parent_id,sort_order,node_type,updated_at) VALUES(?,?,?,?,?,?)")
    .run(id, id, parentId, 0, kind, T);
}

async function insertNote(db: SqlJsAsyncDb, id: string, parentId: string | null): Promise<void> {
  await db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at) VALUES(?,?,?,?,?)")
    .run(id, id, parentId, 0, T);
}

/** nb1 > g1 > n1(根文档) > n2(子文档) > n3(孙文档)，另有旁观文档 nSibling。 */
async function seedNested(db: SqlJsAsyncDb): Promise<void> {
  await insertFolder(db, "nb1", "notebook", null);
  await insertFolder(db, "g1", "group", "nb1");
  await insertNote(db, "n1", "g1");
  await insertNote(db, "n2", "n1");
  await insertNote(db, "n3", "n2");
  await insertNote(db, "nSibling", "g1");
}

async function row(db: SqlJsAsyncDb, table: "notes" | "folders", id: string): Promise<{ trashed_at: string | null; parent_id: string | null } | undefined> {
  return await db.prepare(`SELECT trashed_at, parent_id FROM ${table} WHERE id=?`).get(id) as never;
}

describe("261114 移动端级联软删：文档下的多级子文档", () => {
  it("trashTreeItem(note)：根文档 + 多级子文档一起进回收站（不是只动根）", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "n1", "note");
    for (const id of ["n1", "n2", "n3"]) {
      expect((await row(db, "notes", id))?.trashed_at).toBeTruthy();
    }
    expect((await row(db, "notes", "nSibling"))?.trashed_at ?? null).toBeNull();
    // 回收站树里能看到整棵（列表返回全部 trashed 行，UI 按 parent 组树）
    const tree = await listTrashTree(db);
    expect(tree.map((it) => it.id)).toEqual(expect.arrayContaining(["n1", "n2", "n3"]));
    await db.close();
  });

  it("noteRepository.trashNote：同样级联（批量删除/回滚等入口共用）", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashNote(db, "n1");
    for (const id of ["n1", "n2", "n3"]) {
      expect((await row(db, "notes", id))?.trashed_at).toBeTruthy();
    }
    expect((await row(db, "notes", "nSibling"))?.trashed_at ?? null).toBeNull();
    await db.close();
  });

  it("restoreTreeItem(note)：整棵子文档一起恢复，父链保持", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "n1", "note");
    await restoreTreeItem(db, "n1", "note", async () => {});
    for (const id of ["n1", "n2", "n3"]) {
      expect((await row(db, "notes", id))?.trashed_at ?? null).toBeNull();
    }
    expect((await row(db, "notes", "n1"))?.parent_id).toBe("g1");
    expect((await row(db, "notes", "n2"))?.parent_id).toBe("n1");
    expect((await row(db, "notes", "n3"))?.parent_id).toBe("n2");
    expect(await listTrashTree(db)).toHaveLength(0);
    await db.close();
  });

  it("purgeTreeItem(note)：整棵子文档一起物理删除并逐条写墓碑", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "n1", "note");
    const purged = await purgeTreeItem(db, "n1", "note");
    expect(purged.purged).toBe(true);
    expect(new Set(purged.noteIds)).toEqual(new Set(["n1", "n2", "n3"])); // G3：返回被物理删除 note ids
    for (const id of ["n1", "n2", "n3"]) {
      expect(await db.prepare("SELECT id FROM notes WHERE id=?").get(id)).toBeUndefined();
    }
    const tombstones = await db.prepare("SELECT id FROM deleted_notes WHERE id IN ('n1','n2','n3')").all() as Array<{ id: string }>;
    expect(tombstones.map((t) => t.id).sort()).toEqual(["n1", "n2", "n3"]);
    expect(await db.prepare("SELECT id FROM notes WHERE id='nSibling'").get()).toBeTruthy();
    await db.close();
  });

  it("批量删除顺序无关：子文档先删、根文档后删，恢复根时子文档跟随回原父", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "n2", "note"); // 先删中间的子文档（成为回收站根）
    expect((await row(db, "notes", "n2"))?.parent_id).toBe("n1");
    await trashTreeItem(db, "n1", "note"); // 后删根文档：已 trashed 的子文档不被重复改写
    for (const id of ["n1", "n2", "n3"]) expect((await row(db, "notes", id))?.trashed_at).toBeTruthy();
    await restoreTreeItem(db, "n1", "note", async () => {});
    for (const id of ["n1", "n2", "n3"]) expect((await row(db, "notes", id))?.trashed_at ?? null).toBeNull();
    expect((await row(db, "notes", "n2"))?.parent_id).toBe("n1");
    expect((await row(db, "notes", "n3"))?.parent_id).toBe("n2");
    await db.close();
  });

  it("删分组（folder）：嵌套在文档下的多级子文档也要一起进回收站", async () => {
    const db = await freshDb();
    await seedNested(db);
    await trashTreeItem(db, "g1", "folder");
    for (const id of ["n1", "n2", "n3"]) {
      expect((await row(db, "notes", id))?.trashed_at).toBeTruthy();
    }
    expect((await row(db, "folders", "g1"))?.trashed_at).toBeTruthy();
    await db.close();
  });
});

/* ============================================================================
 * 261114 task-8 用户要求：逐个根类型 × 多级子树的完整删除矩阵（移动端）
 * 根类型：笔记本 / 分组（多级）/ 文档（多级子文档，≥3 层）
 * 每个根类型都要走完：删除 → 回收站（根可见、子节点 trashed、父链保留）
 *                        → 恢复（整棵回原父）→ 彻底删除（整棵物理删、墓碑逐条、正文/历史清理）
 * 回收站「清空」：移动端**没有批量清空入口**（只有逐条彻底删除 + 90 天自动过期，见 trashAutoPurge），
 * 所以这里用逐条 purge 覆盖；批量只可能是多选逐条，不是清空语义。
 * ========================================================================== */

/** 文档行 + 真实正文文件（purge 的正文清理断言用）。 */
async function mkNote(db: SqlJsAsyncDb, id: string, parentId: string | null): Promise<void> {
  await insertNote(db, id, parentId);
  await writeNoteBody("doc", id, "<p>" + id + "</p>");
}

/** 一条历史快照行（purge 必须连历史一起清）。 */
async function addHistory(db: SqlJsAsyncDb, noteId: string): Promise<void> {
  await db.prepare(
    "INSERT INTO note_history (note_id, file_path, content_hash, title, created_at, size, refs_json, ref_count) VALUES (?,?,?,?,?,?,?,?)",
  ).run(noteId, "/tmp/mobile-trash-test/" + noteId, "h", noteId, T, 1, "[]", 0);
}

async function trashedAt(db: SqlJsAsyncDb, table: "notes" | "folders", id: string): Promise<string | null> {
  const row = await db.prepare("SELECT trashed_at FROM " + table + " WHERE id=?").get(id) as { trashed_at?: string | null } | undefined;
  return row?.trashed_at ?? null;
}

async function parentOf(db: SqlJsAsyncDb, table: "notes" | "folders", id: string): Promise<string | null> {
  const row = await db.prepare("SELECT parent_id FROM " + table + " WHERE id=?").get(id) as { parent_id?: string | null } | undefined;
  return row?.parent_id ?? null;
}

async function deletedFromOf(db: SqlJsAsyncDb, table: "notes" | "folders", id: string): Promise<string | null> {
  const row = await db.prepare("SELECT deleted_from_parent_id FROM " + table + " WHERE id=?").get(id) as { deleted_from_parent_id?: string | null } | undefined;
  return row?.deleted_from_parent_id ?? null;
}

interface Fixture {
  folders: Array<[string, "notebook" | "group", string | null]>;
  notes: Array<[string, string | null]>;
  /** 该根子树里应受影响的全部 id（folders+notes）。 */
  subtree: string[];
  /** 子树外的旁观 id（不得被动到）。 */
  outside: string[];
  root: { id: string; kind: "folder" | "note" };
}

/** 根 X 的完整生命周期断言：删除（回收站）→ 恢复（回原父）→ 彻底删除（物理删+墓碑+正文/历史清理）。 */
async function assertTrashLifecycle(f: Fixture): Promise<void> {
  const db = await freshDb();
  try {
    for (const [id, kind, parentId] of f.folders) await insertFolder(db, id, kind, parentId);
    for (const [id, parentId] of f.notes) { await mkNote(db, id, parentId); await addHistory(db, id); }
    // 记录原始父链：删除/恢复都不得改写它。
    const parents = new Map<string, string | null>();
    for (const id of [...f.folders.map((x) => x[0]), ...f.notes.map((x) => x[0])]) {
      const table = f.folders.some((x) => x[0] === id) ? "folders" : "notes";
      parents.set(id, await parentOf(db, table, id));
    }

    // ---- 1) 删除：返回整棵 subtree note ids；根在回收站可见；子节点 trashed；父链保留 ----
    const trashedNoteIds = f.root.kind === "folder"
      ? await trashTreeItem(db, f.root.id, "folder")
      : await trashNote(db, f.root.id);
    expect(new Set(trashedNoteIds)).toEqual(new Set(f.notes.filter(([id]) => f.subtree.includes(id)).map(([id]) => id)));
    for (const id of f.subtree) {
      const table = f.folders.some((x) => x[0] === id) ? "folders" : "notes";
      expect(await trashedAt(db, table, id), id + " 应进回收站").toBeTruthy();
      // 父链保留：只有根节点（笔记本）可能本来就没有父；其余 parent_id 不得被改。
      expect(await parentOf(db, table, id), id + " parent 不得改").toBe(parents.get(id));
      if (id !== f.root.id) expect(await deletedFromOf(db, table, id), id + " 应记删除前父").toBe(parents.get(id));
    }
    for (const id of f.outside) {
      const table = f.folders.some((x) => x[0] === id) ? "folders" : "notes";
      expect(await trashedAt(db, table, id), id + " 不应被删").toBeNull();
    }
    const trash = await listTrashTree(db);
    expect(trash.some((it) => it.id === f.root.id)).toBe(true); // 根可见（回收站行）
    expect(trash.filter((it) => f.subtree.includes(it.id))).toHaveLength(f.subtree.length);

    // ---- 2) 恢复：整棵回原父；回收站清空；旁观不动 ----
    await restoreTreeItem(db, f.root.id, f.root.kind, async () => {});
    for (const id of f.subtree) {
      const table = f.folders.some((x) => x[0] === id) ? "folders" : "notes";
      expect(await trashedAt(db, table, id), id + " 应已恢复").toBeNull();
      expect(await parentOf(db, table, id), id + " 恢复后父不变").toBe(parents.get(id));
    }
    expect(await listTrashTree(db)).toHaveLength(0);

    // ---- 3) 彻底删除：整棵物理删 + 逐条墓碑 + 正文/历史清理 ----
    await trashTreeItem(db, f.root.id, f.root.kind);
    const purged = await purgeTreeItem(db, f.root.id, f.root.kind);
    expect(purged.purged).toBe(true);
    // G3：返回整棵被物理删除的 note ids（UI 关标签用；folder 根只含 notes）
    expect(new Set(purged.noteIds)).toEqual(new Set(f.notes.map(([id]) => id).filter((id) => f.subtree.includes(id))));
    for (const id of f.subtree) {
      const table = f.folders.some((x) => x[0] === id) ? "folders" : "notes";
      expect(await db.prepare("SELECT id FROM " + table + " WHERE id=?").get(id), id + " 应物理删除").toBeUndefined();
    }
    const tombstones = await db.prepare("SELECT id, node_type FROM deleted_notes WHERE id IN (" + f.subtree.map(() => "?").join(",") + ")").all(...f.subtree) as Array<{ id: string; node_type: string }>;
    expect(tombstones.map((t) => t.id).sort()).toEqual([...f.subtree].sort());
    for (const t of tombstones) {
      const table = f.folders.some((x) => x[0] === t.id) ? "folders" : "notes";
      expect(t.node_type).toBe(table === "folders" ? "folder" : "note");
    }
    for (const [id] of f.notes.filter(([id]) => f.subtree.includes(id))) {
      expect(await readNoteBody("doc", id), id + " 正文应清理").toBeNull();
      const hist = await db.prepare("SELECT COUNT(*) AS c FROM note_history WHERE note_id=?").get(id) as { c: number };
      expect(hist.c).toBe(0);
    }
    for (const id of f.outside) {
      const table = f.folders.some((x) => x[0] === id) ? "folders" : "notes";
      expect(await db.prepare("SELECT id FROM " + table + " WHERE id=?").get(id), id + " 不应被彻底删除").toBeTruthy();
    }

    // ---- 4) 清空回收站：移动端无批量入口；逐条 purge 已覆盖（见文件头）----
    expect(await listTrashTree(db)).toHaveLength(0);
  } finally {
    await db.close();
  }
}

describe("261114 删除矩阵：笔记本根（多顶层分组/文档/子文档/孙文档）", () => {
  const fixture: Fixture = {
    folders: [
      ["nb1", "notebook", null],
      ["gTop1", "group", "nb1"],
      ["gTop2", "group", "nb1"],
      ["gInner", "group", "gTop1"],
      ["nb2", "notebook", null],
    ],
    notes: [
      ["t1", "nb1"], ["t2", "t1"],
      ["a", "gTop1"], ["a1", "a"], ["a11", "a1"],
      ["b", "gTop2"],
      ["z", "nb2"],
    ],
    subtree: ["nb1", "gTop1", "gTop2", "gInner", "t1", "t2", "a", "a1", "a11", "b"],
    outside: ["nb2", "z"],
    root: { id: "nb1", kind: "folder" },
  };
  it("删笔记本：整棵回收站→整棵回原父→整棵物理删（逐条墓碑/正文/历史清理）", async () => {
    await assertTrashLifecycle(fixture);
  });
});

describe("261114 删除矩阵：分组根（多级分组嵌套文档）", () => {
  const fixture: Fixture = {
    folders: [
      ["nb1", "notebook", null],
      ["g1", "group", "nb1"],
      ["g2", "group", "g1"],
      ["g3", "group", "g2"],
      ["keep", "group", "nb1"],
    ],
    notes: [
      ["d1", "g1"], ["d2", "g2"], ["d3", "g3"],
      ["deep", "d3"],
      ["s", "keep"],
    ],
    subtree: ["g1", "g2", "g3", "d1", "d2", "d3", "deep"],
    outside: ["nb1", "keep", "s"],
    root: { id: "g1", kind: "folder" },
  };
  it("删多级分组：整棵回收站→整棵回原父→整棵物理删", async () => {
    await assertTrashLifecycle(fixture);
  });
});

describe("261114 删除矩阵：文档根（文档下多级子文档，≥3 层）", () => {
  const fixture: Fixture = {
    folders: [["nb1", "notebook", null]],
    notes: [
      ["d1", "nb1"], ["d2", "d1"], ["d3", "d2"], ["d4", "d3"],
      ["sib", "nb1"],
    ],
    subtree: ["d1", "d2", "d3", "d4"],
    outside: ["nb1", "sib"],
    root: { id: "d1", kind: "note" },
  };
  it("删文档：整棵子文档回收站（父链保留）→整棵回原父→整棵物理删", async () => {
    await assertTrashLifecycle(fixture);
  });
});

describe("261114 单条恢复：原父是活跃文档/回收站行（G2）", () => {
  it("子文档的父是活跃 note ⇒ 恢复保持原父（不回落首个笔记本根）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", "notebook", null);
      await mkNote(db, "parent", "nb1");
      await mkNote(db, "child", "parent");
      await mkNote(db, "other", "nb1");
      await trashNote(db, "child");
      await restoreTreeItem(db, "child", "note", async () => {});
      expect(await trashedAt(db, "notes", "child")).toBeNull();
      expect(await parentOf(db, "notes", "child")).toBe("parent");
      await db.close();
    } catch (e) { await db.close(); throw e; }
  });

  it("子分组的父是活跃 note ⇒ 恢复保持原父（分组不挂错到笔记本根）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", "notebook", null);
      await mkNote(db, "parent-note", "nb1");
      await insertFolder(db, "g1", "group", "parent-note");
      await mkNote(db, "doc-in-g1", "g1");
      await trashTreeItem(db, "g1", "folder");
      await restoreTreeItem(db, "g1", "folder", async () => {});
      expect(await trashedAt(db, "folders", "g1")).toBeNull();
      expect(await parentOf(db, "folders", "g1")).toBe("parent-note");
      expect(await parentOf(db, "notes", "doc-in-g1")).toBe("g1");
      await db.close();
    } catch (e) { await db.close(); throw e; }
  });
});

describe("261114 purge 清理派生账本（G4）与回收站守卫（G5）", () => {
  it("purge 事务内清 orphan_assets（note 子树每篇都清）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", "notebook", null);
      await mkNote(db, "p", "nb1");
      await mkNote(db, "c", "p");
      for (const id of ["p", "c"]) {
        await db.prepare("INSERT INTO orphan_assets (note_id, filename, file_path, size, mime_type) VALUES (?,?,?,?,?)")
          .run(id, "orphan.bin", "note-assets/" + id + "/orphan.bin", 3, "application/octet-stream");
      }
      await trashNote(db, "p");
      const purged = await purgeTreeItem(db, "p", "note");
      expect(purged.purged).toBe(true);
      const rows = await db.prepare("SELECT note_id FROM orphan_assets WHERE note_id IN ('p','c')").all() as Array<{ note_id: string }>;
      expect(rows).toHaveLength(0);
    } finally { await db.close(); }
  });

  it("G5 守卫：活跃行不可 purge（返回 false、行与 trashed_at 不动）", async () => {
    const db = await freshDb();
    try {
      await insertFolder(db, "nb1", "notebook", null);
      await insertNote(db, "active", "nb1");
      const result = await purgeTreeItem(db, "active", "note");
      expect(result).toEqual({ purged: false, noteIds: [] });
      expect(await db.prepare("SELECT id FROM notes WHERE id='active'").get()).toBeTruthy();
      const folderResult = await purgeTreeItem(db, "nb1", "folder");
      expect(folderResult).toEqual({ purged: false, noteIds: [] });
      expect(await db.prepare("SELECT id FROM folders WHERE id='nb1'").get()).toBeTruthy();
    } finally { await db.close(); }
  });
});

describe("261114 删除矩阵：批量多选「父 + 子」同时删（顺序无关）", () => {
  async function seed(): Promise<SqlJsAsyncDb> {
    const db = await freshDb();
    await insertFolder(db, "nb1", "notebook", null);
    await mkNote(db, "p", "nb1");
    await mkNote(db, "c", "p");
    await mkNote(db, "gc", "c"); // 孙文档
    await mkNote(db, "sib", "nb1");
    return db;
  }

  it("先父后子 与 先子后父：结果一致、幂等、恢复根回原父", async () => {
    for (const order of [["p", "c"], ["c", "p"]] as const) {
      const db = await seed();
      try {
        const first = await trashNote(db, order[0]);
        const second = await trashNote(db, order[1]);
        // 每次返回**本次被软删的整棵子树** ids（含孙文档）；整体并集恒为整棵；幂等，不重复改 parent。
        const expected = order[0] === "p" ? [["p", "c", "gc"], ["c", "gc"]] : [["c", "gc"], ["p", "c", "gc"]];
        expect(new Set(first)).toEqual(new Set(expected[0]));
        expect(new Set(second)).toEqual(new Set(expected[1]));
        for (const id of ["p", "c", "gc"]) expect(await trashedAt(db, "notes", id)).toBeTruthy();
        expect(await trashedAt(db, "notes", "sib")).toBeNull();
        expect(await parentOf(db, "notes", "c")).toBe("p");
        // 恢复根：整棵回原父、孙文档仍挂在 c 下
        await restoreTreeItem(db, "p", "note", async () => {});
        for (const id of ["p", "c", "gc"]) expect(await trashedAt(db, "notes", id)).toBeNull();
        expect(await parentOf(db, "notes", "c")).toBe("p");
        expect(await parentOf(db, "notes", "gc")).toBe("c");
        expect(await listTrashTree(db)).toHaveLength(0);
      } finally {
        await db.close();
      }
    }
  });

  it("父已删后再删子：幂等（不产生第二个回收站根、不改 parent）", async () => {
    const db = await seed();
    try {
      await trashNote(db, "p");
      const deletedFromBefore = await deletedFromOf(db, "notes", "c");
      await trashNote(db, "c");
      expect(await trashedAt(db, "notes", "c")).toBeTruthy();
      expect(await parentOf(db, "notes", "c")).toBe("p");
      expect(await deletedFromOf(db, "notes", "c")).toBe(deletedFromBefore);
      // 幂等语义：c 的 parent 仍指向 p（不因二次删除被改成回收站容器/空 ⇒ 不产生第二个回收站根）。
      expect(await parentOf(db, "notes", "c")).toBe("p");
    } finally {
      await db.close();
    }
  });
});
