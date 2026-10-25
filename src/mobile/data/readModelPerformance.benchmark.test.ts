import { describe, expect, it } from "vitest";
import { applyMobileSchema } from "./schema";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb";
import { listNotebookTree } from "./notebookTreeRepository";
import { listNotes } from "./noteRepository";
import { listQuickNotePage } from "./quickNotesRepository";

const enabled = process.env.LAKE_RUN_BENCHMARK === "1";
const DOCS = Number(process.env.LAKE_BENCH_DOCS ?? 100_000);
const QUICK_NOTES = Number(process.env.LAKE_BENCH_QUICK_NOTES ?? 5_000);

describe.skipIf(!enabled)("mobile read model performance", () => {
  it("100k 文档树、首页元数据与 5k 小记首屏查询满足目标", async () => {
    const raw = await SqlJsDb.open();
    const db = new SqlJsAsyncDb(raw);
    await applyMobileSchema(db);
    raw.transaction(() => {
      raw.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty) VALUES (?,?,?,?,?,?,?,?)")
        .run("nb", "Benchmark", null, 0, "notebook", null, "2026-01-01T00:00:00.000Z", 0);
      const note = raw.prepare("INSERT INTO notes (id,title,parent_id,sort_order,updated_at,content_hash,is_dirty,is_conflict,doc_kind) VALUES (?,?,?,?,?,?,?,?,?)");
      for (let i = 0; i < DOCS; i += 1) {
        note.run(`n${i}`, `文档 ${i}`, "nb", i, `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`, `h${i}`, 0, 0, "doc");
      }
      const quick = raw.prepare("INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,tags_json,list_metadata_version) VALUES (?,?,?,?,?,?,?,?,?,?)");
      for (let i = 0; i < QUICK_NOTES; i += 1) {
        quick.run(`q${i}`, "2026-01-01T00:00:00.000Z", `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`, `小记 ${i}`, 0, `qh${i}`, 0, 0, "[]", 1);
      }
    })();

    const treeStart = performance.now();
    const tree = await listNotebookTree(db, "nb");
    const treeMs = performance.now() - treeStart;

    const homeStart = performance.now();
    const notes = await listNotes(db);
    const homeMs = performance.now() - homeStart;

    const quickStart = performance.now();
    const quick = await listQuickNotePage(db, { limit: 50 });
    const quickMs = performance.now() - quickStart;

    console.log(JSON.stringify({ docs: DOCS, quickNotes: QUICK_NOTES, treeMs, homeMs, quickMs, treeRows: tree.length, noteRows: notes.length, quickRows: quick.items.length }));
    expect(tree.length).toBe(DOCS);
    expect(notes.length).toBe(DOCS);
    expect(quick.items).toHaveLength(50);
    expect(quick.nextCursor).not.toBeNull();
    expect(treeMs).toBeLessThanOrEqual(500);
    expect(homeMs).toBeLessThanOrEqual(DOCS <= 5_000 ? 100 : 300);
    expect(quickMs).toBeLessThanOrEqual(100);
  }, 120_000);
});
