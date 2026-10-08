import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { indexNote, reconcileIndex, searchNotes, RECONCILE_BATCH_SIZE } from "./searchIndex.js";
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

function makeRawDb(): Database.Database {
  const raw = new Database(":memory:");
  raw.exec([
    "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, parent_id TEXT, updated_at TEXT NOT NULL, content_hash TEXT, text_cache TEXT, trashed_at TEXT, doc_kind TEXT NOT NULL DEFAULT 'doc');",
    "CREATE TABLE folders (id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT);",
    "CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, tokenize='unicode61');",
    "CREATE TABLE search_index (note_id TEXT PRIMARY KEY, fts_rowid INTEGER NOT NULL, title TEXT NOT NULL, raw_hash TEXT, title_hash TEXT NOT NULL, body_hash TEXT NOT NULL, indexed_at TEXT NOT NULL);",
    "CREATE UNIQUE INDEX idx_search_index_rowid ON search_index(fts_rowid);",
  ].join("\n"));
  return raw;
}

function makeDb(): MobileDb {
  return adapt(makeRawDb());
}

interface ExecCapture {
  calls: number;
  statements: string[];
  failFirst: boolean;
}

/**
 * 在 better-sqlite3 上模拟原生 executeSet：记录调用/语句，可注入首次失败验证「失败逐条重放」。
 * 原生实现（NativeSqliteDb.executeSet）由插件保证整批单事务，这里用 BEGIN/COMMIT 对齐。
 */
function adaptWithExecuteSet(raw: Database.Database, capture: ExecCapture): MobileDb {
  const db = adapt(raw);
  db.executeSet = async (set) => {
    capture.calls += 1;
    capture.statements.push(...set.map((s) => s.statement));
    if (capture.failFirst) {
      capture.failFirst = false;
      throw new Error("simulated executeSet failure");
    }
    raw.exec("BEGIN");
    try {
      for (const s of set) raw.prepare(s.statement).run(...(s.values as never[]));
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  };
  return db;
}

async function addNote(d: MobileDb, id: string, title: string, content: string, parentId: string | null = "nb", updatedAt = "2026-01-01T00:00:00Z", docKind = "doc"): Promise<void> {
  await d.prepare("INSERT INTO notes (id,title,content,parent_id,updated_at,content_hash,trashed_at,doc_kind) VALUES (?,?,?,?,?,?,NULL,?)")
    .run(id, title, content, parentId, updatedAt, sha256Sync(new TextEncoder().encode(content)), docKind);
}

describe("mobile searchIndex（better-sqlite3 FTS5 验证）", () => {
  it("非 doc（usheet/bitable/board）按 kind 派生搜索文本：不把 JSON 碎片塞进索引", async () => {
    const d = makeDb();
    const usheetBody = JSON.stringify({ kind: "usheet", version: 1, workbook: { id: "workbook", sheetOrder: ["s1"], sheets: { s1: { id: "s1", name: "Sheet1", cellData: { "0": { "0": { v: "季度预算表" } }, "1": { "0": { v: "差旅报销 1200" } } } } } } });
    const bitableBody = JSON.stringify({ kind: "bitable", version: 1, activeTableId: "t1", tables: [{ id: "t1", name: "持仓", fields: [{ id: "f1", name: "名称", type: "text" }], records: [{ id: "r1", values: { f1: "北斗七星持仓" }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }], views: [{ id: "v1", type: "grid", name: "表格" }], activeViewId: "v1" }] });
    const boardBody = JSON.stringify({ kind: "board", version: 1, engine: "drawnix", preset: "drawing", elements: [{ id: "n1", type: "geometry", shape: "rectangle", text: { children: [{ text: "画板里的形状文字" }], type: "paragraph" } }] });
    await addNote(d, "s1", "预算", usheetBody, "nb", "2026-01-01T00:00:00Z", "usheet");
    await addNote(d, "b1", "持仓表", bitableBody, "nb", "2026-01-01T00:00:00Z", "bitable");
    await addNote(d, "p1", "我的画板", boardBody, "nb", "2026-01-01T00:00:00Z", "board");
    await reconcileIndex(d);
    // 正文文字能搜到
    expect((await searchNotes(d, "季度预算")).some((r) => r.id === "s1")).toBe(true);
    expect((await searchNotes(d, "差旅报销")).some((r) => r.id === "s1")).toBe(true);
    expect((await searchNotes(d, "北斗七星")).some((r) => r.id === "b1")).toBe(true);
    expect((await searchNotes(d, "形状文字")).some((r) => r.id === "p1")).toBe(true);
    // JSON 结构碎片不应进索引（"drawnix"/"activeTableId" 这类键名搜不到）
    expect((await searchNotes(d, "drawnix")).length).toBe(0);
    expect((await searchNotes(d, "activeTableId")).length).toBe(0);
  });

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

  it("批量对账走 executeSet：分块一次 SELECT prev/MAX，超过单块文档数也全部建索引且 rowid 连续", async () => {
    const raw = makeRawDb();
    const capture: ExecCapture = { calls: 0, statements: [], failFirst: false };
    const d = adaptWithExecuteSet(raw, capture);
    const total = RECONCILE_BATCH_SIZE + 25;
    for (let i = 0; i < total; i++) {
      await addNote(d, "bulk-" + i, "批量标题" + i, "<p>批量正文关键字-" + i + "</p>", "nb", "2026-01-01T00:00:00Z");
    }
    await reconcileIndex(d);
    // 两块文档 → 两次 executeSet（每块一次 SELECT prev + 一次 SELECT MAX）。
    expect(capture.calls).toBe(2);
    const ledger = await d.prepare("SELECT COUNT(*) AS c, COUNT(DISTINCT fts_rowid) AS d, MIN(fts_rowid) AS mn, MAX(fts_rowid) AS mx FROM search_index").get() as { c: number; d: number; mn: number; mx: number };
    expect(ledger.c).toBe(total);
    expect(ledger.d).toBe(total); // 唯一索引不冲突
    expect(ledger.mn).toBe(1);
    expect(ledger.mx).toBe(total); // 跨块 rowid 连续（后一块 MAX 已含前一块写入）
    const fts = await d.prepare("SELECT COUNT(*) AS c FROM notes_fts").get() as { c: number };
    expect(fts.c).toBe(total);
    expect((await searchNotes(d, "关键字-" + (total - 1))).some((r) => r.id === "bulk-" + (total - 1))).toBe(true);
    // 第二次全量对账：全部命中 hash 短路，不再下发任何语句（幂等）。
    const callsAfterFirst = capture.calls;
    capture.statements.length = 0;
    await reconcileIndex(d);
    expect(capture.calls).toBe(callsAfterFirst);
    expect(capture.statements.length).toBe(0);
  });

  it("executeSet 失败时逐条重放，索引仍完整", async () => {
    const raw = makeRawDb();
    const capture: ExecCapture = { calls: 0, statements: [], failFirst: true };
    const d = adaptWithExecuteSet(raw, capture);
    for (let i = 0; i < 10; i++) await addNote(d, "fb-" + i, "失败标题" + i, "<p>失败正文" + i + "</p>");
    await reconcileIndex(d);
    expect(capture.calls).toBe(1); // 首次批量失败
    const ledger = await d.prepare("SELECT COUNT(*) AS c FROM search_index").get() as { c: number };
    expect(ledger.c).toBe(10); // 逐条重放补齐
    expect((await searchNotes(d, "失败正文7")).some((r) => r.id === "fb-7")).toBe(true);
  });

  it("纯样式变化只更新账本 raw_hash，不重写 FTS", async () => {
    const raw = makeRawDb();
    const capture: ExecCapture = { calls: 0, statements: [], failFirst: false };
    const d = adaptWithExecuteSet(raw, capture);
    await addNote(d, "style-1", "样式标题", "<p>正文一字不改</p>");
    await reconcileIndex(d);
    const before = await d.prepare("SELECT fts_rowid FROM search_index WHERE note_id=?").get("style-1") as { fts_rowid: number };
    // content_hash 变、正文派生纯文本不变 → 只走 UPDATE search_index 分支。
    await d.prepare("UPDATE notes SET content_hash=? WHERE id=?").run("new-raw-hash", "style-1");
    capture.statements.length = 0;
    await reconcileIndex(d);
    const after = await d.prepare("SELECT fts_rowid, raw_hash FROM search_index WHERE note_id=?").get("style-1") as { fts_rowid: number; raw_hash: string };
    expect(after.raw_hash).toBe("new-raw-hash");
    expect(after.fts_rowid).toBe(before.fts_rowid); // FTS rowid 不变
    expect(capture.statements.some((s) => s.includes("INSERT INTO notes_fts"))).toBe(false);
    expect(capture.statements.some((s) => s.includes("UPDATE search_index"))).toBe(true);
    expect((await searchNotes(d, "一字不改")).some((r) => r.id === "style-1")).toBe(true);
  });
});