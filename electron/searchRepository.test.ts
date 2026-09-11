import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SearchRepository } from "./searchRepository.js";
import type { DbLike } from "./dbLike.js";

const SCHEMA =
  "CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, note_file_id TEXT, title TEXT, parent_id TEXT, node_type TEXT, deleted_at TEXT, updated_at TEXT, sort_order INTEGER);" +
  "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, text_cache TEXT);" +
  "CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize='unicode61');" +
  "CREATE TABLE search_index (note_id TEXT PRIMARY KEY, fts_rowid INTEGER NOT NULL, title_hash TEXT NOT NULL, body_hash TEXT NOT NULL, indexed_at TEXT NOT NULL);" +
  "CREATE UNIQUE INDEX idx_search_index_rowid ON search_index(fts_rowid);";

function wrapCounting(raw: Database.Database, counter: { deletes: number; inserts: number }): DbLike {
  return {
    prepare(sql: string) {
      const stmt = raw.prepare(sql);
      if (sql.startsWith("DELETE FROM notes_fts")) {
        return { ...stmt, run: (...a: unknown[]) => { counter.deletes += 1; return stmt.run(...(a as never[])); } };
      }
      if (sql.startsWith("INSERT INTO notes_fts")) {
        return { ...stmt, run: (...a: unknown[]) => { counter.inserts += 1; return stmt.run(...(a as never[])); } };
      }
      return stmt;
    },
    transaction: ((fn: (...args: never[]) => unknown) => raw.transaction(fn)) as DbLike["transaction"],
    pragma: ((...a: unknown[]) => (raw.pragma as (...x: unknown[]) => unknown)(...a)) as DbLike["pragma"],
    exec: (sql: string) => raw.exec(sql),
    close: () => raw.close(),
  };
}

function makeRepo(options: { countWrites?: { deletes: number; inserts: number } } = {}) {
  const raw = new Database(":memory:");
  raw.exec(SCHEMA);
  const db = options.countWrites ? wrapCounting(raw, options.countWrites) : (raw as unknown as DbLike);
  const repo = new SearchRepository({
    db,
    trashNotebookId: "trash",
    derivePlainText: (noteId: string) => {
      const row = raw.prepare("SELECT text_cache FROM notes WHERE id=?").get(noteId) as { text_cache: string | null } | undefined;
      return row?.text_cache ?? null;
    },
  });
  let tick = 0;
  const addNote = (id: string, title: string, plain: string, parentId: string | null = null): void => {
    tick += 1;
    const updatedAt = "2026-01-" + String(tick).padStart(2, "0") + "T00:00:00Z";
    raw.prepare(
      "INSERT INTO tree_nodes(id,note_file_id,title,parent_id,node_type,deleted_at,updated_at,sort_order) VALUES(?,?,?,?,?,?,?,0)"
    ).run(id, id, title, parentId, "note", null, updatedAt);
    raw.prepare("INSERT INTO notes(id,title,text_cache) VALUES(?,?,?)").run(id, title, plain);
    repo.upsert(id, title, plain);
  };
  return { raw, repo, addNote };
}

describe("SearchRepository v2（统一 FTS5 unicode61 + 账本）", () => {
  it("1/2/3 字统一；2 字正文也能命中；短语要求相邻", () => {
    const { repo, addNote } = makeRepo();
    addNote("n1", "Lake", "欢迎使用Lake编辑器性能测试");
    addNote("n2", "技术记录", "这是编辑器的一个测试");
    addNote("n3", "杂谈", "编辑遇到问题需要修复器");
    expect(repo.search("编").some((r) => r.id === "n1")).toBe(true);
    expect(repo.search("编辑").some((r) => r.id === "n3")).toBe(true);
    expect(repo.search("编辑器").map((r) => r.id).sort()).toEqual(["n1", "n2"]);
  });

  it("标题精确/前缀排在正文命中之前", () => {
    const { repo, addNote } = makeRepo();
    addNote("n-exact", "同步", "正文无关");
    addNote("n-prefix", "同步笔记", "正文无关");
    addNote("n-body", "其他", "这里讲同步机制");
    const ids = repo.search("同步").map((r) => r.id);
    expect(ids.indexOf("n-exact")).toBeLessThan(ids.indexOf("n-body"));
    expect(ids.indexOf("n-prefix")).toBeLessThan(ids.indexOf("n-body"));
  });

  it("回收站子树不返回", () => {
    const { raw, repo, addNote } = makeRepo();
    raw.prepare("INSERT INTO tree_nodes(id,note_file_id,title,parent_id,node_type,deleted_at,updated_at,sort_order) VALUES(?,?,?,?,?,?,?,0)")
      .run("trash", null, "回收站", null, "notebook", null, "2026-01-01T00:00:00Z");
    addNote("n-in", "秘密文档", "正文", "trash");
    addNote("n-out", "正常文档", "正文");
    const ids = repo.search("文档").map((r) => r.id);
    expect(ids).toContain("n-out");
    expect(ids).not.toContain("n-in");
  });

  it("remove 后不再命中", () => {
    const { repo, addNote } = makeRepo();
    addNote("n1", "标题", "可搜索的正文内容");
    expect(repo.search("正文").length).toBe(1);
    repo.remove(["n1"]);
    expect(repo.search("正文").length).toBe(0);
  });

  it("内容 hash 未变短路；变则重建", () => {
    const counter = { deletes: 0, inserts: 0 };
    const { repo } = makeRepo({ countWrites: counter });
    repo.upsert("n1", "标题A", "正文A");
    expect(counter).toEqual({ deletes: 0, inserts: 1 });
    repo.upsert("n1", "标题A", "正文A");
    expect(counter).toEqual({ deletes: 0, inserts: 1 });
    repo.upsert("n1", "标题A", "正文B");
    expect(counter).toEqual({ deletes: 1, inserts: 2 });
    repo.upsert("n1", "标题B", "正文B");
    expect(counter).toEqual({ deletes: 2, inserts: 3 });
  });

  it("rebuild 从 text_cache 重建", () => {
    const { raw, repo } = makeRepo();
    raw.prepare("INSERT INTO tree_nodes(id,note_file_id,title,parent_id,node_type,deleted_at,updated_at,sort_order) VALUES(?,?,?,?,?,?,?,0)")
      .run("n1", "n1", "磁盘文档", null, "note", null, "2026-01-01T00:00:00Z");
    raw.prepare("INSERT INTO notes(id,title,text_cache) VALUES(?,?,?)").run("n1", "磁盘文档", "磁盘正文包含量子纠缠");
    repo.rebuild();
    expect(repo.search("量子纠缠").some((r) => r.id === "n1")).toBe(true);
  });

  it("特殊字符/超长不抛错", () => {
    const { repo, addNote } = makeRepo();
    addNote("n1", "标题", "正文");
    for (const q of ['"', "%", "_", "*", "-", "a b  c", "a".repeat(500), "%完整%", "50%", "C++", "a.b", "   "]) {
      expect(() => repo.search(q)).not.toThrow();
    }
  });

  it("摘要带 <mark>；正文命中 matchType=body", () => {
    const { repo, addNote } = makeRepo();
    addNote("n1", "Lake", "欢迎使用Lake编辑器性能测试");
    const hit = repo.search("编辑器").find((r) => r.id === "n1")!;
    expect(hit.snippet).toContain("<mark>编辑器</mark>");
    expect(hit.matchType).toBe("body");
  });
});
