import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SearchRepository } from "./searchRepository.js";
import type { DbLike } from "./dbLike.js";

const RUN = process.env.LAKE_RUN_BENCHMARK === "1";
const N = Number(process.env.LAKE_BENCH_N ?? 5000);

(RUN ? describe : describe.skip)("search index benchmark", () => {
  it("build + query at scale", () => {
    const file = path.join(os.tmpdir(), "lake-search-bench.sqlite3");
    try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
    const db = new Database(file);
    db.exec([
      "CREATE TABLE tree_nodes (id TEXT PRIMARY KEY, note_file_id TEXT, title TEXT, parent_id TEXT, node_type TEXT, deleted_at TEXT, updated_at TEXT, sort_order INTEGER);",
      "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, text_cache TEXT);",
      "CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize='unicode61');",
      "CREATE TABLE search_index (note_id TEXT PRIMARY KEY, fts_rowid INTEGER NOT NULL, title_hash TEXT NOT NULL, body_hash TEXT NOT NULL, indexed_at TEXT NOT NULL);",
      "CREATE UNIQUE INDEX idx_search_index_rowid ON search_index(fts_rowid);",
    ].join("\n"));
    const ch = (i: number) => String.fromCodePoint(0x4e00 + i);
    const V = 300;
    const rc = () => ch(Math.floor(Math.random() * V));
    const body = () => {
      let s = "";
      const segs = 20 + Math.floor(Math.random() * 20);
      for (let i = 0; i < segs; i++) {
        let w = "";
        const len = 2 + Math.floor(Math.random() * 6);
        for (let j = 0; j < len; j++) w += rc();
        s += w + (Math.random() < 0.15 ? " lake " : " ");
      }
      return s;
    };
    const target = ch(5) + ch(7) + ch(9);
    const insNode = db.prepare("INSERT INTO tree_nodes(id,note_file_id,title,parent_id,node_type,deleted_at,updated_at,sort_order) VALUES(?,?,?,?,?,?,?,0)");
    const insNote = db.prepare("INSERT INTO notes(id,title,text_cache) VALUES(?,?,?)");
    const seed = db.transaction(() => {
      for (let i = 0; i < N; i++) {
        const id = "n" + i;
        const title = i === 0 ? "标题" + target : ch(Math.floor(Math.random() * V)) + "文档";
        const text = i === 0 ? target + " " + body() : body();
        insNode.run(id, id, title, null, "note", null, "2026-01-01T00:00:00Z");
        insNote.run(id, title, text);
      }
    });
    seed();
    const repo = new SearchRepository({ db: db as unknown as DbLike, trashNotebookId: "trash", derivePlainText: () => null });
    const buildStart = Date.now();
    repo.rebuild();
    const buildMs = Date.now() - buildStart;
    const sizeMB = (fs.statSync(file).size / 1048576).toFixed(1);
    const measure = (term: string) => {
      const t = process.hrtime.bigint();
      const rows = repo.search(term, 50);
      return { ms: (Number(process.hrtime.bigint() - t) / 1e6).toFixed(2), hits: rows.length };
    };
    const q1 = measure(ch(5));
    const q2 = measure(target.slice(0, 2));
    const q3 = measure(target);
    const qLatin = measure("lake");
    console.log("[bench] N=" + N + " build=" + buildMs + "ms size=" + sizeMB + "MB " +
      "1字=" + q1.ms + "ms/" + q1.hits + " 2字=" + q2.ms + "ms/" + q2.hits + " 3字=" + q3.ms + "ms/" + q3.hits + " 拉丁=" + qLatin.ms + "ms/" + qLatin.hits);
    expect(buildMs).toBeGreaterThan(0);
    expect(repo.search(target).some((r) => r.title.includes(target))).toBe(true);
    db.close();
  }, 300000);
});