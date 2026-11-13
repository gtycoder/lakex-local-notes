/**
 * 261114 P0 回归护栏：回收站文档不得泄漏进启动快照 / 冷启动 / gone 判定。
 *
 * 现场缺陷（用户 2026-11-13）：
 * 1) 删除笔记本时只有**根节点**的 parent_id 移进回收站，子文档 parent_id 不变、只标 trashed_at；
 * 2) 旧 Store.bootstrap() 只过滤 deleted_at/parent_id ⇒ 回收站子文档被当成活跃文档塞进启动快照：
 *    tab session 的 liveIds 认为它还活着、lastOpenedNoteId 一命中就冷启动打开；
 * 3) readNote/getNoteDigest/isGoneNote 都不读 trashed_at ⇒ 打开后按可编辑标签出现，保存被主进程拦下；
 * 4) 清空回收站（purge）后旧 seed() 仅凭「notes 表为空」又把固定 id 的 welcome-note 复活到已被 purge
 *    的默认笔记本下（孤儿文档），每次启动重演。
 *
 * 本文件全部走真实 Store 构造路径 + 临时目录（不 mock 存储层），只对「旧 bug 残留」直接写 SQLite 造数据。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { AppError, Store } from "./store.js";
import { TRASH_NOTEBOOK_ID, isGoneNote } from "../src/core/syncDecisions.js";

// Store 模块加载链会 import electron/secretCipher（safeStorage）——与 electron/store.test.ts 同口径。
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (buf: Buffer) => buf.toString(),
  },
  net: { fetch: vi.fn() },
}));

const DEFAULT_NOTEBOOK_ID = "notebook-personal";
const WELCOME_NOTE_ID = "welcome-note";
/** 与 Store 内部 DEFAULT_WORKSPACE_ID 一致（幽灵 tree_nodes 行的 workspace 归属）。 */
const WORKSPACE_ID = "default";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lake-startup-trash-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** 另开一条 better-sqlite3 连接：用于造「旧 bug 残留」和校验落盘内容（Store 构造路径之外）。 */
function openRawDb() {
  return new Database(path.join(dir, "metadata.sqlite3"));
}
type RawDb = ReturnType<typeof openRawDb>;

function withRawDb<T>(fn: (db: RawDb) => T): T {
  const db = openRawDb();
  try { return fn(db); } finally { db.close(); }
}

function count(db: RawDb, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { c: number }).c;
}

describe("261114 回归：回收站文档不得进入启动快照", () => {
  it("a. 全新库回归：bootstrap 种子快照含 welcome-note", () => {
    const store = new Store(dir);
    try {
      const boot = store.bootstrap();
      expect(boot.notes.map((note) => note.id)).toContain(WELCOME_NOTE_ID);
      const welcome = store.readNote(WELCOME_NOTE_ID);
      expect(welcome.trashedAt ?? null).toBeNull();
      expect(isGoneNote(welcome)).toBe(false);
    } finally {
      store.close();
    }
  });

  it("b. 活跃文档回归：bootstrap 包含、冷启动命中 lastOpened、trashedAt 为空、isGoneNote=false", () => {
    const store = new Store(dir);
    const active = store.createNoteIn(DEFAULT_NOTEBOOK_ID, "活跃文档");
    store.readNote(active.id); // 写 device_state.last_opened_note_id
    store.close();

    const restarted = new Store(dir);
    try {
      const boot = restarted.bootstrap();
      expect(boot.lastOpenedNoteId).toBe(active.id);
      expect(boot.notes.map((note) => note.id)).toContain(active.id);
      const read = restarted.readNote(active.id);
      expect(read.trashedAt ?? null).toBeNull();
      expect(isGoneNote(read)).toBe(false);
    } finally {
      restarted.close();
    }
  });

  it("c. 核心缺陷：删笔记本后重启——根/嵌套子文档都不进快照、冷启动为空、readNote 带 trashedAt、digest deleted", () => {
    const store = new Store(dir);
    const notebook = store.createNotebook("待删笔记本");
    const rootDoc = store.createNoteIn(notebook.id, "根文档");
    const group = store.createGroup(notebook.id, "嵌套分组");
    const nestedDoc = store.createNoteIn(group.id, "嵌套文档");
    store.deleteTreeNode(notebook.id);
    // 用户现场是「删光笔记本」：种子的个人笔记（含 welcome-note）也一起删。
    // welcome-note 的 parent_id 仍停在 notebook-personal（级联只标 trashed_at）——正是旧 bootstrap 泄漏的形状。
    store.deleteTreeNode(DEFAULT_NOTEBOOK_ID);
    store.close();

    const restarted = new Store(dir);
    try {
      const boot = restarted.bootstrap();
      expect(boot.notes).toEqual([]);

      for (const noteId of [rootDoc.id, nestedDoc.id]) {
        const read = restarted.readNote(noteId);
        expect(read.trashedAt).toBeTruthy();
        expect(isGoneNote(read)).toBe(true);
        expect(restarted.getNoteDigest(noteId)?.deleted).toBe(true);
      }

      const treeIds = restarted.listTreeNodes().map((node) => node.id);
      expect(treeIds).not.toContain(notebook.id);
      expect(treeIds).not.toContain(group.id);
      expect(treeIds).not.toContain(rootDoc.id);
      expect(treeIds).not.toContain(nestedDoc.id);
    } finally {
      restarted.close();
    }
  });

  it("d. 回归：删单篇文档（parent 直接变回收站）仍被 bootstrap 排除，其它活跃文档不受影响", () => {
    const store = new Store(dir);
    const notebook = store.createNotebook("单篇本");
    const doc = store.createNoteIn(notebook.id, "单篇文档");
    store.deleteTreeNode(doc.id);
    store.close();

    const restarted = new Store(dir);
    try {
      const boot = restarted.bootstrap();
      expect(boot.notes.map((note) => note.id)).not.toContain(doc.id);
      expect(boot.notes.map((note) => note.id)).toContain(WELCOME_NOTE_ID);
      const read = restarted.readNote(doc.id);
      expect(read.parentId).toBe(TRASH_NOTEBOOK_ID);
      expect(read.trashedAt).toBeTruthy();
      expect(isGoneNote(read)).toBe(true);
    } finally {
      restarted.close();
    }
  });

  it("e. 清空回收站后不复活血缘笔记（二次启动也不复活）", () => {
    const store = new Store(dir);
    store.deleteTreeNode(DEFAULT_NOTEBOOK_ID);
    const emptied = store.emptyTrash();
    expect(emptied.purged).toBeGreaterThan(0);
    store.close();

    const restarted = new Store(dir);
    try {
      expect(restarted.bootstrap().notes).toEqual([]);
      expect(restarted.listNoteSummaries().map((note) => note.id)).not.toContain(WELCOME_NOTE_ID);
      let thrown: unknown = null;
      try { restarted.readNote(WELCOME_NOTE_ID); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).kind).toBe("NotFound");
    } finally {
      restarted.close();
    }

    // 二次启动：purge 墓碑永久压制 seed 复活
    const restartedAgain = new Store(dir);
    try {
      expect(restartedAgain.bootstrap().notes).toEqual([]);
      expect(restartedAgain.listNoteSummaries().map((note) => note.id)).not.toContain(WELCOME_NOTE_ID);
    } finally {
      restartedAgain.close();
    }
    expect(withRawDb((db) => count(db, "SELECT COUNT(*) AS c FROM deleted_notes WHERE id=?", WELCOME_NOTE_ID))).toBe(1);
  });

  it("f. 幽灵自愈：旧 bug 遗留的「活跃 + 父不存在 + 有墓碑」行在 Store 构造时清掉，墓碑保留", () => {
    const store = new Store(dir);
    store.deleteTreeNode(DEFAULT_NOTEBOOK_ID);
    store.emptyTrash();
    store.close();

    // 模拟旧 seed 的复活产物：活跃 notes 行（parent 指向已被 purge 的 notebook-personal）+ 对应 tree_nodes 行。
    const now = new Date().toISOString();
    withRawDb((db) => {
      db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,is_dirty) VALUES(?,?,?,?,?,1)")
        .run(WELCOME_NOTE_ID, "幽灵欢迎笔记", DEFAULT_NOTEBOOK_ID, 0, now);
      db.prepare(
        "INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_dirty,is_conflict) " +
        "VALUES(?,?,?,?,?,?,?,?,?,1,0)",
      ).run(WELCOME_NOTE_ID, WORKSPACE_ID, DEFAULT_NOTEBOOK_ID, "note", "幽灵欢迎笔记", WELCOME_NOTE_ID, 0, now, now);
      expect(count(db, "SELECT COUNT(*) AS c FROM notes WHERE id=?", WELCOME_NOTE_ID)).toBe(1);
    });

    // 必须真实走 Store 构造路径（migrate + seed 自愈），不是直接测 SQL。
    const restarted = new Store(dir);
    try {
      expect(restarted.bootstrap().notes).toEqual([]);
      expect(restarted.listNoteSummaries().map((note) => note.id)).not.toContain(WELCOME_NOTE_ID);
    } finally {
      restarted.close();
    }

    withRawDb((db) => {
      expect(count(db, "SELECT COUNT(*) AS c FROM notes WHERE id=?", WELCOME_NOTE_ID)).toBe(0);
      expect(count(db, "SELECT COUNT(*) AS c FROM tree_nodes WHERE id=? OR note_file_id=?", WELCOME_NOTE_ID, WELCOME_NOTE_ID)).toBe(0);
      // 墓碑必须保留：彻底删除是永久语义，不再复活
      expect(count(db, "SELECT COUNT(*) AS c FROM deleted_notes WHERE id=?", WELCOME_NOTE_ID)).toBe(1);
    });
  });

  it("g. 防御：活跃文档的父节点不存在（无墓碑）时 bootstrap 也不包含它", () => {
    const store = new Store(dir);
    const notebook = store.createNotebook("父节点会消失");
    const orphan = store.createNoteIn(notebook.id, "父节点丢失文档");
    store.close();

    // 无墓碑、notes 行活跃：只让父树节点消失（模拟半途失败的树/元数据漂移）
    withRawDb((db) => { db.prepare("DELETE FROM tree_nodes WHERE id=?").run(notebook.id); });

    const restarted = new Store(dir);
    try {
      const boot = restarted.bootstrap();
      expect(boot.notes.map((note) => note.id)).not.toContain(orphan.id);
      // bootstrap 是防御性过滤，不删数据：行仍在（避免误伤用户数据）
      expect(restarted.listNoteSummaries().map((note) => note.id)).toContain(orphan.id);
    } finally {
      restarted.close();
    }
  });
});
