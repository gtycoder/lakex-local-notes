import { describe, it, expect, vi, beforeEach } from "vitest";
import { SQL_PARAMETER_BATCH_SIZE } from "../core/sqlParameterBatch.js";
import { sha256Sync } from "../core/sha256Sync.js";

const sqlitePrepareSqls = vi.hoisted(() => [] as string[]);

vi.mock("./data/persistence", () => ({
  loadSnapshot: vi.fn(async () => null),
}));

vi.mock("./native/nativeSqliteDb.js", async () =>
  (await import("./native/nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);

vi.mock("./native/nativeSqliteMigration", () => ({
  DEFAULT_MOBILE_DATABASE: "lake-notes-mobile",
  migrateSnapshotToNativeSqlite: vi.fn(async () => ({
    status: "no-snapshot",
    databaseName: "lake-notes-mobile",
  })),
}));

vi.mock("./native/assetFs", () => ({
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

vi.mock("./native/secretStore.js", () => ({
  mobileSecretStore: {
    read: vi.fn(async (key: string) => (key === "s3.secretAccessKey" ? "secret-key" : null)),
    write: vi.fn(async () => {}),
  },
}));

import { bridge } from "./bridge.js";
import { syncNow as coreSyncNow } from "../core/syncEngine.js";
import { SqlJsAsyncDb } from "./data/sqliteDb.js";

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

  it("createUsheet 落 kind=usheet 且正文是共享的 50×16 空表快照", async () => {
    const nb = await bridge.createNotebook({ title: "新建表格本", icon: null });
    const sheet = await bridge.createUsheet("无标题表格", nb.id);
    expect(sheet.kind).toBe("usheet");
    expect(sheet.parentId).toBe(nb.id);

    const read = await bridge.readNote(sheet.id);
    expect(read?.kind).toBe("usheet");
    expect(read?.parentId).toBe(nb.id);
    const body = JSON.parse(read?.content ?? "{}") as { kind?: string; version?: number; workbook?: { sheets?: Record<string, { rowCount?: number; columnCount?: number }> } };
    expect(body.kind).toBe("usheet");
    expect(body.version).toBe(1);
    expect(body.workbook?.sheets?.s1).toMatchObject({ rowCount: 50, columnCount: 16 });

    const tree = await bridge.listNotebookTree(nb.id);
    expect(tree.find((t) => t.id === sheet.id)?.title).toBe("无标题表格");

    // 空串父节点必须兜底到真实笔记本，不能建出 parent_id="" 的孤儿表格
    const fallback = await bridge.createUsheet("空父兜底表格", "   ");
    expect(fallback.parentId).toBeTruthy();
    expect(fallback.parentId).not.toBe("");
  });
});

describe("mobile 新建画板", () => {
  it("createBoard 落 kind=board、正文是空场景，并出现在目录树里", async () => {
    const nb = await bridge.createNotebook({ title: "新建画板本", icon: null });
    const board = await bridge.createBoard("无标题画板", nb.id);
    expect(board.kind).toBe("board");
    expect(board.parentId).toBe(nb.id);

    const read = await bridge.readNote(board.id);
    expect(read?.kind).toBe("board");
    expect(read?.parentId).toBe(nb.id);
    const body = JSON.parse(read?.content ?? "{}") as { kind?: string; version?: number; elements?: unknown[] };
    expect(body.kind).toBe("board");
    expect(body.version).toBe(1);
    expect(body.elements).toEqual([]);

    const tree = await bridge.listNotebookTree(nb.id);
    expect(tree.find((t) => t.id === board.id)?.title).toBe("无标题画板");

    const fallback = await bridge.createBoard("空父兜底画板", " ");
    expect(fallback.parentId).toBeTruthy();
    expect(fallback.parentId).not.toBe("");
  });
});

describe("mobile 新建数据表", () => {
  it("createBitable 落 kind=bitable、正文是 core 默认表（1 文本列 + 3 空记录），并出现在目录树里", async () => {
    const nb = await bridge.createNotebook({ title: "新建数据表本", icon: null });
    const bitable = await bridge.createBitable("无标题数据表", nb.id);
    expect(bitable.kind).toBe("bitable");
    expect(bitable.parentId).toBe(nb.id);

    const read = await bridge.readNote(bitable.id);
    expect(read?.kind).toBe("bitable");
    expect(read?.parentId).toBe(nb.id);
    const body = JSON.parse(read?.content ?? "{}") as {
      kind?: string; version?: number; activeTableId?: string;
      tables?: Array<{ id: string; fields?: Array<{ id: string; type: string }>; records?: unknown[]; views?: Array<{ id: string }> }>;
    };
    expect(body.kind).toBe("bitable");
    expect(body.version).toBe(1);
    // 新建数据表的产品默认：只有 1 列文本 + 3 行空记录（core createDefaultBitableTable 口径）
    expect(body.tables?.length).toBe(1);
    expect(body.tables?.[0].fields?.map((field) => field.type)).toEqual(["text"]);
    expect(body.tables?.[0].records?.length).toBe(3);
    expect(body.activeTableId).toBe(body.tables?.[0].id);

    const tree = await bridge.listNotebookTree(nb.id);
    expect(tree.find((t) => t.id === bitable.id)?.title).toBe("无标题数据表");

    // 空串父节点必须兜底到真实笔记本，不能建出 parent_id="" 的孤儿数据表
    const fallback = await bridge.createBitable("空父兜底数据表", "   ");
    expect(fallback.parentId).toBeTruthy();
    expect(fallback.parentId).not.toBe("");
  });
});

describe("mobile 保存不改树归属（261020 实测 bug）", () => {
  it("saveNote 不传 parentId 时保留原父节点（自动保存/完成不会把文档摘出笔记本）", async () => {
    const nb = await bridge.createNotebook({ title: "保存归属本", icon: null });
    const note = await bridge.createNote("归属文档", nb.id);
    expect(note.parentId).toBe(nb.id);

    // 模拟移动端自动保存：只传标题/正文（历史实现会把 parent_id 写成 NULL）
    await bridge.saveNote(note.id, "归属文档", "<p>改一下</p>");
    const after = (await bridge.listNotes()).find((n) => n.id === note.id);
    expect(after?.parentId).toBe(nb.id);
    expect((await bridge.listNotebookTree(nb.id)).some((t) => t.id === note.id)).toBe(true);

    // 数据表同一条写边界
    const bitable = await bridge.createBitable("归属数据表", nb.id);
    await bridge.saveNote(bitable.id, "归属数据表", bitable.content);
    expect((await bridge.listNotes()).find((n) => n.id === bitable.id)?.parentId).toBe(nb.id);

    // 显式移动仍能改父节点（树操作不受 COALESCE 影响）
    const group = await bridge.createGroup(nb.id, "归属分组");
    await bridge.moveTreeNodeOrdered(note.id, group.id, [note.id]);
    expect((await bridge.listNotes()).find((n) => n.id === note.id)?.parentId).toBe(group.id);
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

  it("renameTreeNode 也支持文档（notes）重命名", async () => {
    const nb = await bridge.createNotebook({ title: "文档重命名本", icon: null });
    const note = await bridge.createNote("原标题", nb.id);
    const renamed = await bridge.renameTreeNode(note.id, "新标题");
    expect(renamed.id).toBe(note.id);
    expect(renamed.title).toBe("新标题");
    const tree = await bridge.listNotebookTree(nb.id);
    expect(tree.find((node) => node.id === note.id)?.title).toBe("新标题");
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
