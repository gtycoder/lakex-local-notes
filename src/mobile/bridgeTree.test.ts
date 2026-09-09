import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import type { Database } from "sql.js";
import { SQL_PARAMETER_BATCH_SIZE } from "../core/sqlParameterBatch.js";
import { saveSnapshot } from "./persistence";

const sqlitePrepareSqls = vi.hoisted(() => [] as string[]);

// sqliteDb.js 依赖 Vite ?url wasm import，vitest 下解析失败 → mock 为真实 sql.js（同 bridgePurge.test.ts）
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
      prepare(sql: string) {
        sqlitePrepareSqls.push(sql);
        return new FakeStmt(this.db, sql);
      }
      transaction<T extends (...args: never[]) => unknown>(fn: T): T {
        const wrapped = ((...args: unknown[]) => { this.db.run("BEGIN"); try { const r = fn(...(args as never[])); this.db.run("COMMIT"); return r; } catch (e) { this.db.run("ROLLBACK"); throw e; } }) as unknown as T;
        return wrapped;
      }
      pragma(source: string) { return this.db.exec(source); }
      exec(sql: string) { this.db.exec(sql); }
      close() { this.db.close(); }
      exportBytes(): Uint8Array { return this.db.export(); }
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
}));

type TestManifest = {
  notes: Array<{ id: string; contentHash: string; assets?: Array<{ filename: string }> }>;
};

vi.mock("../core/syncEngine.js", () => ({
  downloadNoteAssets: vi.fn(),
  syncNow: vi.fn(async (
    _config: unknown,
    _store: unknown,
    _port: unknown,
    options: { onPublished: (next: TestManifest, prev: TestManifest) => Promise<void> },
  ) => {
    await options.onPublished(
      { notes: [{ id: "sync-note", contentHash: "next", assets: [] }] },
      { notes: [{ id: "sync-note", contentHash: "prev", assets: [{ filename: "old.png" }] }] },
    );
    return { message: "同步完成" };
  }),
}));

vi.mock("../core/quickNotesSyncEngine.js", () => ({
  syncQuickNotesViaEngine: vi.fn(async () => ({ uploaded: 0, downloaded: 0 })),
}));

vi.mock("./secretStore.js", () => ({
  mobileSecretStore: {
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
  },
}));

import { bridge } from "./bridge.js";
import { syncNow as coreSyncNow } from "../core/syncEngine.js";

/** 移动端目录树：文档套文档（note 作父）在树中可见（回归：listNotebookTree 此前只显示 folder 直属 note）。 */
describe("mobile 目录树（文档套文档）", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("listNotebookTree 返回嵌套文档：group > 父文档 > 子文档", async () => {
    const nb = await bridge.createNotebook({ title: "嵌套测试本", icon: null });
    const group = await bridge.createGroup(nb.id, "子分组");
    // 父文档（挂在 group 下）+ 子文档（挂在父文档下）+ 孙文档（挂在子文档下，验证任意层级）
    await bridge.saveNote("parent-1", "父文档", "<p>x</p>", group.id);
    await bridge.saveNote("child-1", "子文档", "<p>x</p>", "parent-1");
    await bridge.saveNote("grand-1", "孙文档", "<p>x</p>", "child-1");
    // 根层文档（直接挂 notebook）
    await bridge.saveNote("root-1", "根层文档", "<p>x</p>", nb.id);

    const tree = await bridge.listNotebookTree(nb.id);
    const byId = new Map(tree.map((t) => [t.id, t]));
    expect(byId.get("parent-1")?.parentId).toBe(group.id);   // 父文档在 group 下
    expect(byId.get("child-1")?.parentId).toBe("parent-1");  // 子文档在父文档下（此前被过滤）
    expect(byId.get("grand-1")?.parentId).toBe("child-1");   // 孙文档任意层级
    expect(byId.get("root-1")?.parentId).toBe(nb.id);        // 根层文档
    expect(byId.size).toBe(5);                               // group + 4 note 全在树里
  });

  it("listNotebookTree 返回节点 icon（notebook/group 自定义图标；note 图标由同步导入 notes.icon）", async () => {
    const nb = await bridge.createNotebook({ title: "图标测试本", icon: "📁" });
    const group = await bridge.createGroup(nb.id, "图标分组");
    await bridge.setNodeIcon(group.id, "🗂️");

    const tree = await bridge.listNotebookTree(nb.id);
    expect(tree.find((t) => t.id === group.id)?.icon).toBe("🗂️");  // group 图标
    // notebook 本身不在 listNotebookTree（树从 notebook 根展开，不含根自身）；listTreeNodes 验证
    const nodes = await bridge.listTreeNodes();
    expect(nodes.find((n) => n.id === nb.id)?.icon).toBe("📁");      // notebook 图标
  });
});

describe("mobile 目录重命名", () => {
  it("renameTreeNode 真实更新标题并返回新节点", async () => {
    const nb = await bridge.createNotebook({ title: "重命名测试本", icon: null });
    const renamed = await bridge.renameTreeNode(nb.id, "重命名成功");

    expect(renamed.id).toBe(nb.id);
    expect(renamed.title).toBe("重命名成功");

    const nodes = await bridge.listTreeNodes();
    expect(nodes.find((node) => node.id === nb.id)?.title).toBe("重命名成功");
  });
});

describe("mobile SQL parameter batching", () => {
  it("removes GC keys in parameter-sized batches", async () => {
    const keys = Array.from(
      { length: SQL_PARAMETER_BATCH_SIZE + 1 },
      (_, index) => `gc-key-${index}`,
    );
    for (const key of keys) {
      await bridge.addS3GcPending(key);
    }

    sqlitePrepareSqls.length = 0;
    await bridge.removeS3GcPending(keys);

    const deleteSqls = sqlitePrepareSqls.filter((sql) =>
      sql.includes("DELETE FROM s3_gc_pending"),
    );
    expect(deleteSqls).toHaveLength(2);
    expect(deleteSqls[0]?.match(/\?/g)).toHaveLength(SQL_PARAMETER_BATCH_SIZE);
    expect(deleteSqls[1]?.match(/\?/g)).toHaveLength(1);
    expect(await bridge.listS3GcPending()).toEqual([]);
  });
});

describe("mobile maintenance writes", () => {
  it("persists history and GC writes after each queued mutation", async () => {
    const saveSnapshotMock = vi.mocked(saveSnapshot);
    const nb = await bridge.createNotebook({ title: "维护队列测试本", icon: null });
    await bridge.saveNote("maintenance-note", "维护队列文档", "<p>x</p>", nb.id);
    saveSnapshotMock.mockClear();

    await bridge.snapshotNote("maintenance-note");
    expect(saveSnapshotMock).toHaveBeenCalledTimes(1);
    const history = await bridge.listNoteHistory("maintenance-note");
    expect(history).toHaveLength(1);

    await bridge.deleteHistory(history[0]!.id);
    expect(saveSnapshotMock).toHaveBeenCalledTimes(2);
    expect(await bridge.listNoteHistory("maintenance-note")).toEqual([]);

    await bridge.saveHistorySettings({
      maxSnapshots: 3,
      retentionDays: 7,
      cleanupIntervalHours: 1,
      snapshotIntervalMinutes: 1,
    });
    expect(saveSnapshotMock).toHaveBeenCalledTimes(3);

    const gcKey = "maintenance-gc-key";
    await bridge.addS3GcPending(gcKey);
    expect(saveSnapshotMock).toHaveBeenCalledTimes(4);
    await bridge.removeS3GcPending([gcKey]);
    expect(saveSnapshotMock).toHaveBeenCalledTimes(5);
    await bridge.recordS3GcLog("delete", gcKey, "test", true);
    expect(saveSnapshotMock).toHaveBeenCalledTimes(6);

    await expect(bridge.cleanupHistory()).resolves.toEqual({ deleted: 0 });
    expect(saveSnapshotMock).toHaveBeenCalledTimes(7);
  });

  it("syncNow updates GC state inside its existing maintenance queue without deadlocking", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    storage.set("lake-notes-mobile.s3", JSON.stringify({
      endpoint: "https://s3.example.test",
      region: "us-east-1",
      bucket: "lake-notes",
      accessKeyId: "access-key",
      secretAccessKey: "secret-key",
      prefix: "lake-notes",
    }));

    try {
      const result = await bridge.syncNow();
      expect(result.message).toContain("同步完成");
      expect(coreSyncNow).toHaveBeenCalled();
      expect(await bridge.listS3GcPending()).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


describe("mobile 文档图标同步能力", () => {
  it("setNodeIcon 支持 note 元数据并保留在 notebook tree", async () => {
    const nb = await bridge.createNotebook({ title: "文档图标本", icon: null });
    const noteId = "mobile-note-icon";
    await bridge.saveNote(noteId, "带图标文档", "<p>x</p>", nb.id);
    const updated = await bridge.setNodeIcon(noteId, "star");
    expect(updated.id).toBe(noteId);
    expect(updated.icon).toBe("star");
    const tree = await bridge.listNotebookTree(nb.id);
    expect(tree.find((item) => item.id === noteId)?.icon).toBe("star");
  });
});
