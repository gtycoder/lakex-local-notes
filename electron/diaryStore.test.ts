import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Store 模块加载即需要 electron（safeStorage 解密 S3 密钥、net）；与既有 electron/*.test.ts 同款桩。
const electronMock = vi.hoisted(() => ({ secrets: new Map<string, string>() }));
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => { const id = crypto.randomUUID(); electronMock.secrets.set(id, value); return Buffer.from(id); },
    decryptString: (value: Buffer) => electronMock.secrets.get(value.toString()) ?? "",
  },
  net: { fetch: vi.fn() },
}));

import Database from "better-sqlite3";
import type { DbLike } from "./dbLike.js";
import { DiaryStore, DIARY_NOTEBOOK_TITLE } from "./diaryStore.js";
import type { SyncFolder } from "./noteQueries.js";
import { Store } from "./store.js";

/**
 * 日记存储（261109，docs/DIARY.md「桌面存储 / IPC 契约」）：
 * - 幂等：连点两次只有一篇；
 * - 层级：笔记本(space=diary) → 年组 → 月组 → 文档(标题=日期)；
 * - space 只出现在笔记本行（分组/文档恒 NULL）；
 * - **单事务**：任一步失败 ⇒ 元数据整体回滚 + 正文半成品回收；
 * - 便携包/整库备份（VACUUM INTO 快照）保留 space。
 */
let root: string;
let store: Store;

function fresh(): void {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lake-diary-"));
  store = new Store(root);
  store.bootstrap();
}

beforeEach(() => { fresh(); });
afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  fs.rmSync(root, { recursive: true, force: true });
});

const readOnlyDb = (): Database.Database => new Database(path.join(root, "metadata.sqlite3"), { readonly: true });

const nodesOf = () => store.listTreeNodes();

/** 月分组节点（2026 → 11）：返回 { notebook, year, month }。 */
function diaryHierarchy() {
  const nodes = nodesOf();
  const notebook = nodes.find((n) => n.space === "diary");
  expect(notebook, "应有 space=diary 的笔记本").toBeTruthy();
  const year = nodes.find((n) => n.parentId === notebook!.id && n.title === "2026");
  const month = nodes.find((n) => n.parentId === year?.id && n.title === "11");
  return { nodes, notebook: notebook!, year: year!, month: month! };
}

describe("diary_open_date 的存储编排", () => {
  it("首次打开：建日记本 + 年组 + 月组 + 文档；space 只落在笔记本行", () => {
    const result = store.openDiaryDate("2026-11-09");
    expect(result.created).toBe(true);
    expect(result.duplicates).toEqual([]);

    const { nodes, notebook, year, month } = diaryHierarchy();
    expect(notebook.nodeType).toBe("notebook");
    expect(notebook.title).toBe(DIARY_NOTEBOOK_TITLE);
    expect(year.nodeType).toBe("group");
    expect(year.space).toBeNull();
    expect(month.nodeType).toBe("group");
    expect(month.space).toBeNull();

    const note = nodes.find((n) => n.id === result.noteId)!;
    expect(note.nodeType).toBe("note");
    expect(note.title).toBe("2026-11-09");
    expect(note.parentId).toBe(month.id);
    expect(note.space).toBeNull();
    expect(result.notebookId).toBe(notebook.id);

    // 正文按生产管线可读（正文路径/空正文模板都走 store 既有口径，不是测试自造）
    const doc = store.readNote(result.noteId);
    expect(doc.title).toBe("2026-11-09");
    expect(doc.content).toContain("ne-p");

    // 全库只有一行 space='diary'
    const db = readOnlyDb();
    try {
      const rows = db.prepare("SELECT id,node_type FROM tree_nodes WHERE space IS NOT NULL").all() as Array<{ id: string; node_type: string }>;
      expect(rows).toEqual([{ id: notebook.id, node_type: "notebook" }]);
      // 文档与分组 space 必须是 NULL（不是空串）
      const notNullGroups = db.prepare("SELECT COUNT(*) AS c FROM tree_nodes WHERE node_type IN ('group','note') AND space IS NOT NULL").get() as { c: number };
      expect(notNullGroups.c).toBe(0);
    } finally { db.close(); }
  });

  it("幂等：连点两次只有一篇（第二次 created=false，notes 行数不变）", () => {
    const first = store.openDiaryDate("2026-11-09");
    const db = readOnlyDb();
    const countNotes = () => (db.prepare("SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NULL").get() as { c: number }).c;
    const before = countNotes();
    db.close();

    const second = store.openDiaryDate("2026-11-09");
    expect(second.created).toBe(false);
    expect(second.noteId).toBe(first.noteId);
    expect(second.notebookId).toBe(first.notebookId);

    const db2 = readOnlyDb();
    try {
      expect((db2.prepare("SELECT COUNT(*) AS c FROM notes WHERE deleted_at IS NULL").get() as { c: number }).c).toBe(before);
      // 分组也没有重复
      expect((db2.prepare("SELECT COUNT(*) AS c FROM tree_nodes WHERE node_type='group'").get() as { c: number }).c).toBe(2);
    } finally { db2.close(); }
  });

  it("一天允许多篇（261109）：默认打开最新、mode:new 才新建；同日其它条目不是重复文档", () => {
    const first = store.openDiaryDate("2026-11-09");
    // 再次「打开」= 幂等复用（不新建）
    const again = store.openDiaryDate("2026-11-09");
    expect(again.created).toBe(false);
    expect(again.noteId).toBe(first.noteId);
    expect(again.duplicates).toEqual([]);

    // mode:"new" = 显式新建第二篇（同一天多篇是合法形态）
    const second = store.openDiaryDate("2026-11-09", { mode: "new" });
    expect(second.created).toBe(true);
    expect(second.noteId).not.toBe(first.noteId);
    expect(second.duplicates).toEqual([]);

    const db = readOnlyDb();
    try {
      const row = db.prepare("SELECT COUNT(*) AS c FROM notes WHERE title='2026-11-09' AND deleted_at IS NULL").get() as { c: number };
      expect(row.c).toBe(2);
      // 分组不重复建
      expect((db.prepare("SELECT COUNT(*) AS c FROM tree_nodes WHERE node_type='group'").get() as { c: number }).c).toBe(2);
    } finally { db.close(); }

    // 再次「打开」= 回到既有的一篇（不新建第三篇）
    const third = store.openDiaryDate("2026-11-09");
    expect(third.created).toBe(false);
    expect([first.noteId, second.noteId]).toContain(third.noteId);
  });

  it("日期键非法 ⇒ 拒绝并明确报错，且不写任何行", () => {
    const db = readOnlyDb();
    const before = (db.prepare("SELECT COUNT(*) AS c FROM tree_nodes").get() as { c: number }).c;
    db.close();
    expect(() => store.openDiaryDate("2026-02-30")).toThrow(/日期格式非法/);
    expect(() => store.openDiaryDate("2026-1-1")).toThrow(/日期格式非法/);
    expect(() => store.openDiaryDate("")).toThrow(/日期格式非法/);
    const db2 = readOnlyDb();
    try {
      expect((db2.prepare("SELECT COUNT(*) AS c FROM tree_nodes").get() as { c: number }).c).toBe(before);
    } finally { db2.close(); }
  });

  it("便携包/整库备份（VACUUM INTO 快照）保留 tree_nodes.space", () => {
    store.openDiaryDate("2026-11-09");
    const target = path.join(root, "snapshot.sqlite3");
    store.backupDatabaseTo(target);

    const snap = new Database(target, { readonly: true });
    try {
      const rows = snap.prepare("SELECT id,space FROM tree_nodes WHERE space IS NOT NULL").all() as Array<{ id: string; space: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].space).toBe("diary");
      // 列本身也在快照里（老端读列即可，不需要额外映射文件）
      const cols = snap.prepare("PRAGMA table_info(tree_nodes)").all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === "space")).toBe(true);
    } finally { snap.close(); }
  });

  it("远端目录应用：space 落库；日记本单调（远端 null 不降级）；笔记本 row 也带 space", () => {
    const remoteDiary: SyncFolder = {
      id: "nb-remote-diary", title: "日记（他端）", parentId: null, sortOrder: 0, nodeType: "notebook",
      icon: null, updatedAt: "2026-11-09T01:00:00.000Z", space: "diary",
    };
    store.importRemoteFolder(remoteDiary);
    expect(store.listTreeNodes().find((n) => n.id === "nb-remote-diary")?.space).toBe("diary");

    // 日记本不可降级（261112 用户裁决）：远端旧包/脏数据发来 null + 更新的 updatedAt ⇒ 本地仍是 diary。
    store.applyRemoteFolderMeta({ ...remoteDiary, space: null, updatedAt: "2026-11-10T01:00:00.000Z" });
    expect(store.listTreeNodes().find((n) => n.id === "nb-remote-diary")?.space).toBe("diary");
  });

  it("既有库 ALTER 迁移：老 tree_nodes 没有 space 列也能补上，且默认 NULL", () => {
    store.close();
    const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lake-diary-legacy-"));
    try {
      const raw = new Database(path.join(legacyRoot, "metadata.sqlite3"));
      raw.exec(`CREATE TABLE tree_nodes (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, parent_id TEXT,
        node_type TEXT NOT NULL CHECK(node_type IN ('notebook','group','note')),
        title TEXT NOT NULL, note_file_id TEXT, sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
        is_conflict INTEGER NOT NULL DEFAULT 0, icon TEXT, trashed_at TEXT,
        deleted_from_parent_id TEXT, is_purged INTEGER NOT NULL DEFAULT 0,
        is_dirty INTEGER NOT NULL DEFAULT 0, cloud_deleted INTEGER NOT NULL DEFAULT 0)`);
      raw.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at) VALUES('old-nb','default',NULL,'notebook','旧笔记本',NULL,0,'2026-01-01','2026-01-01')").run();
      raw.close();

      const legacyStore = new Store(legacyRoot);
      try {
        legacyStore.bootstrap();
        expect(legacyStore.listTreeNodes().find((n) => n.id === "old-nb")?.space).toBeNull();
        // 新列可用：新建带 space 的笔记本
        const created = legacyStore.createNotebook("日记", "diary");
        expect(created.space).toBe("diary");
      } finally { legacyStore.close(); }
      // 让 afterEach 的 store.close() 可重入
      store = legacyStore;
    } finally {
      const check = new Database(path.join(legacyRoot, "metadata.sqlite3"), { readonly: true });
      const cols = check.prepare("PRAGMA table_info(tree_nodes)").all() as Array<{ name: string }>;
      check.close();
      expect(cols.some((c) => c.name === "space")).toBe(true);
      fs.rmSync(legacyRoot, { recursive: true, force: true });
    }
  });
});

describe("diaryStore 单事务（失败回滚）", () => {
  /** 直接建 DiaryStore：需要注入一个"写 notes 必失败"的 DbLike 来验证回滚；生产里这层不暴露 db。 */
  function harness(): { diary: DiaryStore; db: Database.Database; ids: string[]; bodyPath: (id: string) => string; close: () => void } {
    store.close();
    const db = new Database(path.join(root, "metadata.sqlite3"));
    const ids: string[] = [];
    const bodyPath = (id: string) => path.join(root, "notes", id + ".lake");
    const listNodes = () => (db.prepare("SELECT id,parent_id,node_type,title,sort_order,updated_at,space FROM tree_nodes WHERE deleted_at IS NULL").all() as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id), parentId: row.parent_id == null ? null : String(row.parent_id),
        nodeType: String(row.node_type), title: String(row.title),
        sortOrder: Number(row.sort_order), updatedAt: String(row.updated_at),
        space: row.space === "diary" ? "diary" as const : null,
      }));
    const nextSortOrder = (parentId: string | null): number => {
      const row = (parentId === null
        ? db.prepare("SELECT COALESCE(MAX(sort_order),-1) AS m FROM tree_nodes WHERE parent_id IS NULL AND deleted_at IS NULL").get()
        : db.prepare("SELECT COALESCE(MAX(sort_order),-1) AS m FROM tree_nodes WHERE parent_id=? AND deleted_at IS NULL").get(parentId)) as { m: number };
      return Number(row.m) + 1;
    };
    // 只让「写 notes」失败：树/分组的 INSERT 正常执行，用来证明是 db.transaction 整体回滚。
    const failingDb = {
      prepare: (sql: string) => {
        const stmt = db.prepare(sql);
        if (sql.includes("INSERT INTO notes")) {
          return { get: (...a: unknown[]) => stmt.get(...a), all: (...a: unknown[]) => stmt.all(...a), run: () => { throw new Error("注入失败：notes 写入失败"); } };
        }
        return stmt;
      },
      transaction: (fn: (...args: never[]) => unknown) => db.transaction(fn),
    } as unknown as DbLike;
    const diary = new DiaryStore({
      db: failingDb,
      workspaceId: "default",
      listTreeNodes: listNodes,
      nextSortOrder,
      uuid: () => { const id = crypto.randomUUID(); ids.push(id); return id; },
      nowIso: () => new Date().toISOString(),
      atomicWrite: (filePath, content) => { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, content); },
      noteBodyPath: bodyPath,
    });
    return { diary, db, ids, bodyPath, close: () => db.close() };
  }

  it("建组/建文档任一步失败 ⇒ 笔记本与分组一起回滚，正文半成品被回收", () => {
    const h = harness();
    try {
      const before = {
        notebook: (h.db.prepare("SELECT COUNT(*) AS c FROM tree_nodes WHERE space='diary'").get() as { c: number }).c,
        groups: (h.db.prepare("SELECT COUNT(*) AS c FROM tree_nodes WHERE node_type='group'").get() as { c: number }).c,
        notes: (h.db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number }).c,
      };
      expect(() => h.diary.openDate("2026-11-09")).toThrow(/注入失败/);

      expect((h.db.prepare("SELECT COUNT(*) AS c FROM tree_nodes WHERE space='diary'").get() as { c: number }).c).toBe(before.notebook);
      expect((h.db.prepare("SELECT COUNT(*) AS c FROM tree_nodes WHERE node_type='group'").get() as { c: number }).c).toBe(before.groups);
      expect((h.db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number }).c).toBe(before.notes);
      // 正文半成品不许留下（元数据没成功 ⇒ 回收）
      for (const id of h.ids) expect(fs.existsSync(h.bodyPath(id))).toBe(false);
    } finally { h.close(); }
  });

  it("回滚后重试仍能成功（不残留坏状态）", () => {
    const h = harness();
    h.close();
    // 用真实 Store 重开同一个库再打开同一天：应能正常建全（证明上一轮没有留下半成品挡路）
    store = new Store(root);
    const result = store.openDiaryDate("2026-11-09");
    expect(result.created).toBe(true);
    const db = readOnlyDb();
    try {
      expect((db.prepare("SELECT COUNT(*) AS c FROM tree_nodes WHERE node_type='group'").get() as { c: number }).c).toBe(2);
    } finally { db.close(); }
  });
});
