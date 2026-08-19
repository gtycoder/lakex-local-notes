import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SearchRepository } from "./searchRepository";

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
    const rows = repo.search("Lake");
    expect(rows.map((row) => row.id)).toEqual(["n-exact", "n-prefix", "n-body"]);
    expect(rows[0]).toMatchObject({ matchType: "title", updatedAt: "2026-08-19T10:00:00Z" });
    expect(rows[2].matchType).toBe("body");
  });
});
