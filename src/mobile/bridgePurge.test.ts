import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import type { Database } from "sql.js";

// sqliteDb.js 的 SqlJsDb 依赖 Vite 的 ?url wasm import，vitest 下解析为根路径失败；
// mock 为真实 sql.js（node 直载 wasm，同 quickNotesDbPort.test.ts 模式）。
vi.mock("./sqliteDb.js", async () => {
  const initSqlJs = (await import("sql.js")).default;
  let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
  const getSql = async () => {
    if (!SQL) SQL = await initSqlJs({ locateFile: () => path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") });
    return SQL;
  };
  class FakeStmt {
    private stmt: any;
    private db: Database;
    constructor(db: Database, sql: string) { this.db = db; this.stmt = db.prepare(sql); }
    get(...params: unknown[]) { this.stmt.reset(); if (params.length) this.stmt.bind(params as never); return this.stmt.step() ? this.stmt.getAsObject() as Record<string, unknown> : undefined; }
    all(...params: unknown[]) { this.stmt.reset(); if (params.length) this.stmt.bind(params as never); const out: Record<string, unknown>[] = []; while (this.stmt.step()) out.push(this.stmt.getAsObject() as Record<string, unknown>); return out; }
    run(...params: unknown[]) {
      this.stmt.reset();
      if (params.length) this.stmt.bind(params as never);
      this.stmt.step();
      const changes = this.db.getRowsModified();
      const rowid = this.db.exec("SELECT last_insert_rowid() AS rowid")[0]?.values[0]?.[0] ?? 0;
      return { changes, lastInsertRowid: typeof rowid === "bigint" ? rowid : Number(rowid) };
    }
  }
  return {
    SqlJsDb: class {
      private db: Database;
      private constructor(db: Database) { this.db = db; }
      static async open(): Promise<any> { const S = await getSql(); return new (this as any)(new S.Database()); }
      static async openFrom(bytes: Uint8Array): Promise<any> { const S = await getSql(); return new (this as any)(new S.Database(bytes)); }
      prepare(sql: string) { return new FakeStmt(this.db, sql); }
      transaction<T extends (...args: never[]) => unknown>(fn: T): T {
        const wrapped = ((...args: unknown[]) => { this.db.run("BEGIN"); try { const r = fn(...(args as never[])); this.db.run("COMMIT"); return r; } catch (e) { this.db.run("ROLLBACK"); throw e; } }) as unknown as T;
        return wrapped;
      }
      pragma(source: string) { return this.db.exec(source); }
      exec(sql: string) { this.db.exec(sql); }
      close() { this.db.close(); }
      exportBytes(): Uint8Array { return this.db.export(); }
    },
    SqlJsAsyncDb: class {
      private db: any;
      constructor(db: any) { this.db = db; }
      prepare(sql: string) {
        const statement = this.db.prepare(sql);
        return {
          async get(...params: unknown[]) { return statement.get(...params); },
          async all(...params: unknown[]) { return statement.all(...params); },
          async run(...params: unknown[]) { return statement.run(...params); },
        };
      }
      async transaction<T extends (...args: never[]) => Promise<unknown>>(fn: T): Promise<unknown> {
        this.db.exec("BEGIN");
        try {
          const result = await fn();
          this.db.exec("COMMIT");
          return result;
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      }
      async pragma(source: string) { return this.db.pragma(source); }
      async exec(sql: string) { this.db.exec(sql); }
      async databaseSizeBytes(): Promise<number> {
        const pageCount = await this.db.prepare("PRAGMA page_count").get() as { page_count: number };
        const pageSize = await this.db.prepare("PRAGMA page_size").get() as { page_size: number };
        return Number(pageCount.page_count) * Number(pageSize.page_size);
      }
      async close() { this.db.close(); }
    },
  };
});

vi.mock("./persistence", () => ({
  saveSnapshot: vi.fn(async () => {}),
  loadSnapshot: vi.fn(async () => null),
}));
vi.mock("./assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
}));

import { bridge } from "./bridge.js";

/**
 * 移动端 purge 删除传播回归测试：
 * - purgeTreeItem 必须物理删除行（回收站不再残留）+ 写 deleted_notes 墓碑（purged_at + node_type）；
 * - 墓碑经 listDeletedNotesForSync 供 syncEngine 发布 deleted:true → 删除传播到其他端（桌面已修同款 bug）；
 * - folder 墓碑（purged_at）供 isFolderPurged 下载过滤（防远端文件夹重新导入复活）。
 */
describe("mobile purge 删除传播", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("purge note：物理删行（回收站消失）+ 写 note 墓碑，墓碑可被同步读取", async () => {
    const NID = "purge-note-1";
    await bridge.saveNote(NID, "待彻底删", "<p>内容</p>", null);
    await bridge.trashNote(NID);
    expect((await bridge.listTrashTree()).some((t) => t.id === NID)).toBe(true);

    await bridge.purgeTreeItem(NID, "note");

    // 行已物理删除：回收站不再残留（此前 sync_state='purged' 行保留 → 回收站仍显示 = 删不掉）
    expect((await bridge.listTrashTree()).some((t) => t.id === NID)).toBe(false);
    expect((await bridge.listNotes()).some((n) => n.id === NID)).toBe(false);

    // 墓碑写入 deleted_notes（node_type='note'），供 syncEngine 发布 deleted:true 传播删除
    const tombstones = await bridge.listDeletedNotesForSync();
    const tomb = tombstones.find((t) => t.id === NID);
    expect(tomb).toBeDefined();
    expect(tomb!.nodeType).toBe("note");
    expect(tomb!.deletedAt).toBeTruthy();
    // purge 后内容已删：墓碑发布走占位符路径（引擎不传空对象）
    expect(await bridge.readDeletedContent(NID)).toBeNull();
  });

  it("purge folder 子树：folders/notes 全删 + folder 墓碑（isFolderPurged 防复活）+ 子树 note 墓碑", async () => {
    const nb = await bridge.createNotebook({ title: "待彻底删笔记本", icon: null });
    const group = await bridge.createGroup(nb.id, "子分组");
    const NID = "purge-folder-note-1";
    await bridge.saveNote(NID, "子文档", "<p>内容</p>", group.id);

    await bridge.purgeTreeItem(nb.id, "folder");

    // 物理删除
    expect((await bridge.listNotebookTree(nb.id)).length).toBe(0);
    expect((await bridge.listNotes()).some((n) => n.id === NID)).toBe(false);

    // folder 墓碑：isFolderPurged 生效（下载远端 folders 时过滤，防复活）
    expect(await bridge.isFolderPurged(nb.id)).toBe(true);
    // 子树 note 墓碑：发布 deleted:true 传播
    const tombstones = await bridge.listDeletedNotesForSync();
    expect(tombstones.find((t) => t.id === nb.id)?.nodeType).toBe("folder");
    expect(tombstones.find((t) => t.id === NID)?.nodeType).toBe("note");
  });

  it("markTombstonesPublished 幂等：purge 墓碑发布标记不改变 deletedAt", async () => {
    const NID = "purge-note-2";
    await bridge.saveNote(NID, "待删", "<p>内容</p>", null);
    await bridge.trashNote(NID);
    await bridge.purgeTreeItem(NID, "note");
    const tombBefore = (await bridge.listDeletedNotesForSync()).find((t) => t.id === NID);
    await bridge.markTombstonesPublished([NID]);
    const tombAfter = (await bridge.listDeletedNotesForSync()).find((t) => t.id === NID);
    expect(tombAfter!.deletedAt).toBe(tombBefore!.deletedAt);
  });

  it("trashTreeItem(folder)：整棵子树（深层 folders + 子树 notes）进回收站，同步列表带 trashedAt", async () => {
    const nbRow = await bridge.createNotebook({ title: "待删库", icon: null });
    const grp = await bridge.createGroup(nbRow.id, "内层分组");
    const nid = "trash-note-sub-" + Date.now();
    await bridge.saveNote(nid, "子笔记", "<p>内容</p>", grp.id);
    // 删整棵 notebook
    await bridge.trashTreeItem(nbRow.id, "folder");
    const trash = await bridge.listTrashTree();
    expect(trash.some((t) => t.id === nbRow.id && t.kind === "folder")).toBe(true);
    // 子树 folders 级联进回收站
    expect(trash.some((t) => t.id === grp.id && t.kind === "folder")).toBe(true);
    // 子树 notes 级联进回收站
    expect(trash.some((t) => t.id === nid && t.kind === "note")).toBe(true);
    // 已移出可见树（trashed_at 标记生效）
    const visible = await bridge.listTreeNodes();
    expect(visible.some((n) => n.id === nbRow.id)).toBe(false);
    // 回收站条目带删除时间（deletedAt = trashed_at，同步传播载体）
    const trashNb = trash.find((t) => t.id === nbRow.id);
    expect(trashNb?.deletedAt).toBeTruthy();
  });

  it("trashTreeItem(note)：单条进回收站，不连累其它笔记", async () => {
    const A = "trash-note-a";
    const B = "trash-note-b";
    await bridge.saveNote(A, "A", "<p>a</p>", "notebook-personal");
    await bridge.saveNote(B, "B", "<p>b</p>", "notebook-personal");
    await bridge.trashTreeItem(A, "note");
    const trash = await bridge.listTrashTree();
    expect(trash.some((t) => t.id === A && t.kind === "note")).toBe(true);
    expect(trash.some((t) => t.id === B)).toBe(false);
  });

  it("trash/restore folder 覆盖挂在 note 下的嵌套文档", async () => {
    const nb = await bridge.createNotebook({ title: "嵌套子树恢复", icon: null });
    const group = await bridge.createGroup(nb.id, "嵌套分组");
    await bridge.saveNote("nested-parent", "父文档", "<p>p</p>", group.id);
    await bridge.saveNote("nested-child", "子文档", "<p>c</p>", "nested-parent");
    await bridge.saveNote("nested-grandchild", "孙文档", "<p>g</p>", "nested-child");

    await bridge.trashTreeItem(nb.id, "folder");
    let trash = await bridge.listTrashTree();
    expect(trash.some((item) => item.id === "nested-parent")).toBe(true);
    expect(trash.some((item) => item.id === "nested-child")).toBe(true);
    expect(trash.some((item) => item.id === "nested-grandchild")).toBe(true);

    await bridge.restoreTreeItem(nb.id, "folder");
    trash = await bridge.listTrashTree();
    expect(trash.some((item) => item.id === "nested-parent")).toBe(false);
    expect(trash.some((item) => item.id === "nested-child")).toBe(false);
    expect(trash.some((item) => item.id === "nested-grandchild")).toBe(false);

    const tree = await bridge.listNotebookTree(nb.id);
    expect(tree.some((item) => item.id === "nested-child")).toBe(true);
    expect(tree.some((item) => item.id === "nested-grandchild")).toBe(true);
  });

  it("purge folder 为嵌套文档写墓碑并物理删除", async () => {
    const nb = await bridge.createNotebook({ title: "嵌套子树删除", icon: null });
    const group = await bridge.createGroup(nb.id, "嵌套分组");
    await bridge.saveNote("purge-nested-parent", "父文档", "<p>p</p>", group.id);
    await bridge.saveNote("purge-nested-child", "子文档", "<p>c</p>", "purge-nested-parent");
    await bridge.trashTreeItem(nb.id, "folder");

    await bridge.purgeTreeItem(nb.id, "folder");

    const notes = await bridge.listNotes();
    expect(notes.some((note) => note.id === "purge-nested-parent")).toBe(false);
    expect(notes.some((note) => note.id === "purge-nested-child")).toBe(false);

    const tombstones = await bridge.listDeletedNotesForSync();
    expect(tombstones.find((item) => item.id === "purge-nested-parent")?.nodeType).toBe("note");
    expect(tombstones.find((item) => item.id === "purge-nested-child")?.nodeType).toBe("note");
  });
});
