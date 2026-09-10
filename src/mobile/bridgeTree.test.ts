import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQL_PARAMETER_BATCH_SIZE } from "../core/sqlParameterBatch.js";
import { sha256Sync } from "../core/sha256Sync.js";

const sqlitePrepareSqls = vi.hoisted(() => [] as string[]);

vi.mock("./persistence", () => ({
  loadSnapshot: vi.fn(async () => null),
}));

vi.mock("./nativeSqliteDb.js", async () =>
  (await import("./nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);

vi.mock("./nativeSqliteMigration", () => ({
  migrateSnapshotToNativeSqlite: vi.fn(async () => ({
    status: "no-snapshot",
    databaseName: "lake-notes-mobile",
  })),
}));

vi.mock("./assetFs", () => ({
  saveAssetBytesFs: vi.fn(async () => {}),
  loadAssetBytesFs: vi.fn(async () => null),
  listAssetKeysFs: vi.fn(async () => []),
  listNoteAssetKeysFs: vi.fn(async () => []),
  removeAssetBytesFs: vi.fn(async () => {}),
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
import { SqlJsAsyncDb } from "./sqliteDb.js";

const sqlJsPrepare = SqlJsAsyncDb.prototype.prepare;
SqlJsAsyncDb.prototype.prepare = function prepare(sql: string) {
  sqlitePrepareSqls.push(sql);
  return sqlJsPrepare.call(this, sql);
};

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
  it("applies history and GC writes through the maintenance queue", async () => {
    const nb = await bridge.createNotebook({ title: "维护队列测试本", icon: null });
    await bridge.saveNote("maintenance-note", "维护队列文档", "<p>x</p>", nb.id);

    await bridge.snapshotNote("maintenance-note");
    const history = await bridge.listNoteHistory("maintenance-note");
    expect(history).toHaveLength(1);

    await bridge.deleteHistory(history[0]!.id);
    expect(await bridge.listNoteHistory("maintenance-note")).toEqual([]);

    await bridge.saveHistorySettings({
      maxSnapshots: 3,
      retentionDays: 7,
      cleanupIntervalHours: 1,
      snapshotIntervalMinutes: 1,
    });

    const gcKey = "maintenance-gc-key";
    await bridge.addS3GcPending(gcKey);
    await bridge.removeS3GcPending([gcKey]);
    await bridge.recordS3GcLog("delete", gcKey, "test", true);
    expect(await bridge.listS3GcPending()).toEqual([]);

    await expect(bridge.cleanupHistory()).resolves.toEqual({ deleted: 0 });
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
      const port = vi.mocked(coreSyncNow).mock.calls[0]?.[2] as {
        getAllNotes(): Promise<Array<{ id: string; content: string; contentHash?: string }>>;
      };
      const metadata = (await port.getAllNotes()).find((row) => row.id === "maintenance-note");
      expect(metadata?.content).toBe("");
      expect(metadata?.contentHash).toBe(sha256Sync(new TextEncoder().encode("<p>x</p>")));
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
