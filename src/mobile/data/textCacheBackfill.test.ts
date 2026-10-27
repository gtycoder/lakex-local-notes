import { describe, expect, it } from "vitest";
import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { createNote } from "./noteRepository.js";
import { backfillTextCache } from "./textCacheBackfill.js";

async function freshDb(): Promise<SqlJsAsyncDb> {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
}

describe("text_cache 后台补齐（261027）", () => {
  it("导入后的 NULL text_cache 能被补齐；幂等且不重复", async () => {
    const db = await freshDb();
    await createNote(db, "n1", "标题", "<p>正文关键词甲</p>", null, new Map());
    await db.prepare("UPDATE notes SET text_cache=NULL WHERE id='n1'").run();
    const first = await backfillTextCache(db);
    expect(first.filled).toBe(1);
    const row = await db.prepare("SELECT text_cache FROM notes WHERE id='n1'").get() as { text_cache: string };
    expect(row.text_cache).toContain("正文关键词甲");
    const second = await backfillTextCache(db);
    expect(second.filled).toBe(0);
  });

  it("正文缺失时写空串（不死循环、不阻塞后续补齐）", async () => {
    const db = await freshDb();
    await db.prepare(
      "INSERT INTO notes (id,title,parent_id,updated_at,content_hash,is_dirty,text_cache) VALUES ('n2','无正文',NULL,'2026-01-01T00:00:00Z','x',1,NULL)"
    ).run();
    const result = await backfillTextCache(db);
    expect(result.filled).toBe(1);
    const row = await db.prepare("SELECT text_cache FROM notes WHERE id='n2'").get() as { text_cache: string };
    expect(row.text_cache).toBe("");
  });
});
