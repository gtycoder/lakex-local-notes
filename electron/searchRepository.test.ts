import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SearchRepository } from "../src/core/searchRepository.js";

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

  it("searches two characters in title and body with title ranking", () => {
    const { repo } = makeRepo();
    expect(repo.search("欢迎").find((row) => row.id === "n-cn-body")).toMatchObject({ matchType: "body" });
  });

  it("searches two characters in title and body with title ranking", () => {
    const { repo } = makeRepo();
    const rows = repo.search("Lake");
    expect(rows.slice(0, 2).map((row) => row.id)).toEqual(["n-exact", "n-prefix"]);
    expect(rows.some((row) => row.id === "n-body" && row.matchType === "body")).toBe(true);
    expect(rows[0]).toMatchObject({ matchType: "title", updatedAt: "2026-08-19T10:00:00Z" });
    expect(rows.find((row) => row.id === "n-body")?.matchType).toBe("body");
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
