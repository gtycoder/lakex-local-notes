import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { indexNote, reconcileIndex, searchNotes } from "./searchIndex.js";
import type { MobileDb, MobileDbStatement } from "./sqliteDb.js";
import { sha256Sync } from "../core/sha256Sync.js";

/** better-sqlite3 上的异步 MobileDb 适配器：用生产同款 FTS5(unicode61) 验证移动端搜索逻辑。 */
function adapt(raw: Database.Database): MobileDb {
  return {
    prepare(sql: string): MobileDbStatement {
      const stmt = raw.prepare(sql);
      return {
        get: async (...p: unknown[]) => stmt.get(...(p as never[])) as Record<string, unknown> | undefined,
        all: async (...p: unknown[]) => stmt.all(...(p as never[])) as Record<string, unknown>[],
        run: async (...p: unknown[]) => {
          const r = stmt.run(...(p as never[]));
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
      };
    },
    transaction: (async (fn: () => Promise<unknown>) => {
      raw.exec("BEGIN");
      try { const r = await fn(); raw.exec("COMMIT"); return r; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    }) as MobileDb["transaction"],
    pragma: async (source: string) => raw.pragma(source),
    exec: async (sql: string) => { raw.exec(sql); },
    databaseSizeBytes: async () => 0,
    close: async () => { raw.close(); },
  };
}

function makeDb(): MobileDb {
  const raw = new Database(":memory:");
  raw.exec([
    "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, parent_id TEXT, updated_at TEXT NOT NULL, content_hash TEXT, text_cache TEXT, trashed_at TEXT);",
    "CREATE TABLE folders (id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT);",
    "CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize='unicode61');",
    "CREATE TABLE search_index (note_id TEXT PRIMARY KEY, fts_rowid INTEGER NOT NULL, title TEXT NOT NULL, raw_hash TEXT, title_hash TEXT NOT NULL, body_hash TEXT NOT NULL, indexed_at TEXT NOT NULL);",
    "CREATE UNIQUE INDEX idx_search_index_rowid ON search_index(fts_rowid);",
  ].join("\n"));
  return adapt(raw);
}

async function addNote(d: MobileDb, id: string, title: string, content: string, parentId: string | null = "nb", updatedAt = "2026-01-01T00:00:00Z"): Promise<void> {
  await d.prepare("INSERT INTO notes (id,title,content,parent_id,updated_at,content_hash,trashed_at) VALUES (?,?,?,?,?,?,NULL)")
    .run(id, title, content, parentId, updatedAt, sha256Sync(new TextEncoder().encode(content)));
}

describe("mobile searchIndex（better-sqlite3 FTS5 验证）", () => {
  it("1/2/3 字统一；正文命中；短语相邻", async () => {
    const d = makeDb();
    await addNote(d, "n1", "Lake", "<p>欢迎使用Lake编辑器性能测试</p>");
    await addNote(d, "n2", "技术记录", "<p>这是编辑器的一个测试</p>");
    await addNote(d, "n3", "杂谈", "<p>编辑遇到问题需要修复器</p>");
    await reconcileIndex(d);
    expect((await searchNotes(d, "编")).some((r) => r.id === "n1")).toBe(true);
    expect((await searchNotes(d, "编辑")).some((r) => r.id === "n3")).toBe(true);
    expect((await searchNotes(d, "编辑器")).map((r) => r.id).sort()).toEqual(["n1", "n2"]);
  });

  it("标题优先排序 + 摘要 <mark>", async () => {
    const d = makeDb();
    await addNote(d, "n-body", "其他", "<p>这里讲同步机制</p>", "nb", "2026-01-03T00:00:00Z");
    await addNote(d, "n-title", "同步", "<p>正文无关</p>", "nb", "2026-01-01T00:00:00Z");
    await reconcileIndex(d);
    const rows = await searchNotes(d, "同步");
    expect(rows[0]?.id).toBe("n-title");
    expect(rows.find((r) => r.id === "n-body")?.snippet).toContain("<mark>同步</mark>");
  });

  it("回收站文档被排除并在对账时移除账本", async () => {
    const d = makeDb();
    await addNote(d, "n1", "秘密", "<p>可搜索正文</p>");
    await reconcileIndex(d);
    expect((await searchNotes(d, "正文")).length).toBe(1);
    await d.prepare("UPDATE notes SET trashed_at=? WHERE id=?").run("2026-02-01T00:00:00Z", "n1");
    await reconcileIndex(d);
    expect((await searchNotes(d, "正文")).length).toBe(0);
    const ledger = await d.prepare("SELECT COUNT(*) AS c FROM search_index").get() as { c: number };
    expect(ledger.c).toBe(0);
  });

  it("indexNote 幂等；正文变化后重建", async () => {
    const d = makeDb();
    await addNote(d, "n1", "标题", "<p>第一版正文</p>");
    await indexNote(d, "n1");
    expect((await searchNotes(d, "第一版")).length).toBe(1);
    await d.prepare("UPDATE notes SET content=?, content_hash=? WHERE id=?").run("<p>第二版正文</p>", sha256Sync(new TextEncoder().encode("<p>第二版正文</p>")), "n1");
    await reconcileIndex(d);
    expect((await searchNotes(d, "第一版")).length).toBe(0);
    expect((await searchNotes(d, "第二版")).length).toBe(1);
  });
});