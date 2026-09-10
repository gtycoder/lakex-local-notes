import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SearchRepository } from "./searchRepository.js";
import type { DbLike, DbLikeStatement } from "./dbLike.js";

function makeRepo() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, note_file_id TEXT, title TEXT, parent_id TEXT, node_type TEXT, deleted_at TEXT, updated_at TEXT, sort_order INTEGER);
    CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, note_id UNINDEXED, tokenize='trigram');
  `);
  const notes = [
    ["n-exact", "Lake", "Lake", "2026-08-19T10:00:00Z"],
    ["n-prefix", "Lake Notes", "Lake Notes app", "2026-08-19T09:00:00Z"],
    ["n-body", "个人笔记", "这里讨论 Lake 编辑器性能", "2026-08-19T11:00:00Z"],
    ["n-cn-body", "技术记录", "欢迎使用 Lake 编辑器", "2026-08-19T12:00:00Z"],
    ["n-one", "同步", "云端镜像", "2026-08-19T08:00:00Z"],
  ];
  const insertNode = db.prepare("INSERT INTO tree_nodes(id,note_file_id,title,parent_id,node_type,deleted_at,updated_at,sort_order) VALUES(?,?,?,?,?,?,?,?)");
  const insertFts = db.prepare("INSERT INTO notes_fts(title,body,note_id) VALUES(?,?,?)");
  for (const [id, title, body, updatedAt] of notes) {
    insertNode.run(id, id, title, null, "note", null, updatedAt, 0);
    insertFts.run(title, body, id);
  }
  return { db, repo: new SearchRepository({ db, trashNotebookId: "trash", ensureNoteCaches: () => true, readNoteCaches: () => ({ markdown: null, plain: null }) }) };
}

describe("SearchRepository title/body search", () => {
  it("searches one character by title only", () => {
    const { repo } = makeRepo();
    const rows = repo.search("湖");
    expect(rows).toEqual([]);
    expect(repo.search("同").some((row) => row.id === "n-one")).toBe(true);
  });

  it("P4-2：2 字只搜标题——不再命中正文，标题命中保留", () => {
    const { repo } = makeRepo();
    // "讨论" 只在 n-body 的正文里（2 字）→ 新语义下不返回
    expect(repo.search("讨论").find((row) => row.id === "n-body")).toBeUndefined();
    // "欢迎" 只在 n-cn-body 的正文里（2 字）→ 不返回
    expect(repo.search("欢迎").find((row) => row.id === "n-cn-body")).toBeUndefined();
    // "同步" 是 n-one 的标题（2 字）→ 标题命中保留，matchType=title
    const rows = repo.search("同步");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "n-one", matchType: "title" });
    // ≥3 字走 FTS 分支，正文命中不受影响：4 字 "Lake" 仍命中 n-body 的正文
    expect(repo.search("Lake").find((row) => row.id === "n-body")?.matchType).toBe("body");
  });

  it("searches two characters in title and body with title ranking", () => {
    const { repo } = makeRepo();
    const rows = repo.search("Lake");
    expect(rows.slice(0, 2).map((row) => row.id)).toEqual(["n-exact", "n-prefix"]);
    expect(rows[0]).toMatchObject({ matchType: "title", updatedAt: "2026-08-19T10:00:00Z" });
  });
});
describe("FTS 转义与边界（V5 §4 R8）", () => {
  it("FTS5 特殊字符不抛错（引号/%/_/*/-/空白/超长）", () => {
    const { repo } = makeRepo();
    for (const q of ["\"", "%", "_", "*", "-", "\"unclosed", "a b  c", "a".repeat(500), "%完整%", "50%"]) {
      expect(() => repo.search(q)).not.toThrow();
    }
  });
  it("1/2 字符 LIKE 分支特殊字符不抛错", () => {
    const { repo } = makeRepo();
    for (const q of ["%", "_", "*", "-", "\""]) {
      expect(() => repo.search(q)).not.toThrow();
    }
  });
  it("空串与纯空白返回空数组", () => {
    const { repo } = makeRepo();
    expect(repo.search("")).toEqual([]);
    expect(repo.search("   ")).toEqual([]);
  });
  it("回收站下笔记不返回", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, note_file_id TEXT, title TEXT, parent_id TEXT, node_type TEXT, sort_order INTEGER, updated_at TEXT, deleted_at TEXT)");
    db.exec("CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, note_id UNINDEXED, tokenize='trigram')");
    const repo = new SearchRepository({ db, trashNotebookId: "trash", ensureNoteCaches: () => true, readNoteCaches: () => ({ markdown: null, plain: null }) });
    db.prepare("INSERT INTO tree_nodes VALUES(?,?,?,?,?,?,?,NULL)").run("trash", null, "回收站", null, "notebook", 0, "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO tree_nodes VALUES(?,?,?,?,?,?,?,NULL)").run("n-in-trash", "n-in-trash", "秘密文档", "trash", "note", 0, "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO tree_nodes VALUES(?,?,?,?,?,?,?,NULL)").run("n-normal", "n-normal", "正常文档", null, "note", 0, "2026-01-01T00:00:00Z");
    db.prepare("INSERT INTO notes_fts VALUES(?,?,?)").run("秘密文档", "", "n-in-trash");
    db.prepare("INSERT INTO notes_fts VALUES(?,?,?)").run("正常文档", "", "n-normal");
    const rows = repo.search("文档");
    expect(rows.some((r) => r.id === "n-in-trash")).toBe(false);
    expect(rows.some((r) => r.id === "n-normal")).toBe(true);
  });
});
describe("P1-2b FTS 条件重建（无变化短路）", () => {
  function fresh() {
    const db = new Database(":memory:");
    db.exec("CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, note_id UNINDEXED, tokenize='trigram')");
    let deletes = 0;
    let inserts = 0;
    // 包装 db：计数对 notes_fts 的 DELETE/INSERT，以验证"无变化时跳过重建"
    const wrapDb = {
      prepare(sql: string): DbLikeStatement {
        const stmt = db.prepare(sql);
        if (sql.startsWith("DELETE FROM notes_fts")) {
          return { ...stmt, run: (...a: unknown[]) => { deletes += 1; return stmt.run(...(a as never[])); } };
        }
        if (sql.startsWith("INSERT INTO notes_fts")) {
          return { ...stmt, run: (...a: unknown[]) => { inserts += 1; return stmt.run(...(a as never[])); } };
        }
        return stmt;
      },
      transaction: ((fn: (...args: never[]) => unknown) => db.transaction(fn)) as DbLike["transaction"],
      pragma: ((...args: unknown[]) => (db.pragma as (...x: unknown[]) => unknown)(...args)) as DbLike["pragma"],
      exec: (sql: string) => db.exec(sql),
      close: () => db.close(),
    } satisfies DbLike;
    const repo = new SearchRepository({ db: wrapDb, trashNotebookId: "trash", ensureNoteCaches: () => true, readNoteCaches: () => ({ markdown: null, plain: null }) });
    return { count: () => ({ deletes, inserts }), repo };
  }
  it("title/body 未变时跳过 DELETE+INSERT，任一变化才重建", () => {
    const { count, repo } = fresh();
    repo.upsert("n1", "标题A", "正文A");
    expect(count()).toEqual({ deletes: 1, inserts: 1 });
    repo.upsert("n1", "标题A", "正文A"); // 无变化 → 不重建
    expect(count()).toEqual({ deletes: 1, inserts: 1 });
    repo.upsert("n1", "标题A", "正文B"); // body 变 → 重建
    expect(count()).toEqual({ deletes: 2, inserts: 2 });
    repo.upsert("n1", "标题B", "正文B"); // title 变 → 重建
    expect(count()).toEqual({ deletes: 3, inserts: 3 });
  });
  it("body=null（无派生缓存路径）按同一规则短路", () => {
    const { count, repo } = fresh();
    repo.upsert("n1", "标题", "正文");
    expect(count()).toEqual({ deletes: 1, inserts: 1 });
    repo.upsert("n1", "标题", null); // null → "" 与现存 "正文" 不同 → 重建
    expect(count()).toEqual({ deletes: 2, inserts: 2 });
    repo.upsert("n1", "标题", null); // "" === "" → 跳过
    expect(count()).toEqual({ deletes: 2, inserts: 2 });
  });
});
