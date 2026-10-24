import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMobileSchema } from "./schema.js";
import { searchQuickNotes } from "./quickNotesSearch.js";
import type { MobileDb, MobileDbStatement } from "./sqliteDb.js";
import { writeQuickNoteBody } from "./noteBodies.js";
import { normalizeQuickNoteContent, serializeQuickNoteContent } from "../../core/quickNoteModel.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { ensureQuickNoteTag } from "./quickNotesRepository.js";

function adapt(raw: Database.Database): MobileDb {
  return {
    prepare(sql: string): MobileDbStatement {
      const stmt = raw.prepare(sql);
      return {
        get: async (...p: unknown[]) => stmt.get(...(p as never[])) as Record<string, unknown> | undefined,
        all: async (...p: unknown[]) => stmt.all(...(p as never[])) as Record<string, unknown>[],
        run: async (...p: unknown[]) => { const r = stmt.run(...(p as never[])); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }; },
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

async function makeDb(): Promise<MobileDb> {
  const raw = new Database(":memory:");
  const d = adapt(raw);
  await applyMobileSchema(d);
  return d;
}

async function addQuickNote(d: MobileDb, id: string, text: string, tagNames: string[] = []): Promise<void> {
  const tags = [];
  for (const name of tagNames) tags.push(await ensureQuickNoteTag(d, name));
  const content = normalizeQuickNoteContent(text, `<p>${text}</p>`, [], tags.map((tag) => tag.id));
  const serialized = serializeQuickNoteContent(content);
  await writeQuickNoteBody(id, serialized);
  const now = new Date().toISOString();
  await d.prepare(
    "INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, sync_state, is_conflict, tags_json, tag_ids_json) VALUES (?,?,?,?,0,?,'local',0,?,?) " +
    "ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, content_hash=excluded.content_hash, sync_state='local', deleted_at=NULL, restore_pending_at=NULL, tags_json=excluded.tags_json, tag_ids_json=excluded.tag_ids_json"
  ).run(id, now, now, text.replace(/\s+/g, " ").trim(), sha256Sync(new TextEncoder().encode(serialized)), JSON.stringify(tags.map((tag) => tag.name)), JSON.stringify(tags.map((tag) => tag.id)));
}

describe("移动端小记搜索", () => {
  it("正文/标签命中，返回 kind=quick-note 与摘要", async () => {
    const d = await makeDb();
    await addQuickNote(d, "q1", "今天写移动搜索", ["灵感"]);
    const hits = await searchQuickNotes(d, "移动搜索");
    expect(hits.map((hit) => hit.id)).toEqual(["q1"]);
    expect(hits[0].kind).toBe("quick-note");
    expect(hits[0].title).toContain("今天写移动搜索");
    expect(hits[0].snippet).toContain("<mark>");
    expect((await searchQuickNotes(d, "灵感")).map((hit) => hit.id)).toEqual(["q1"]);
    await d.close();
  });

  it("content_hash 变化后对账重建：旧词失效、新词生效", async () => {
    const d = await makeDb();
    await addQuickNote(d, "q1", "第一版内容");
    expect((await searchQuickNotes(d, "第一版")).length).toBe(1);
    await addQuickNote(d, "q1", "第二版内容");
    expect(await searchQuickNotes(d, "第一版")).toEqual([]);
    expect((await searchQuickNotes(d, "第二版")).map((hit) => hit.id)).toEqual(["q1"]);
    await d.close();
  });

  it("删除/恢复中/缺失的小记会从索引对账移除", async () => {
    const d = await makeDb();
    await addQuickNote(d, "q1", "待删除");
    expect((await searchQuickNotes(d, "待删除")).length).toBe(1);
    await d.prepare("UPDATE quick_notes SET deleted_at=? WHERE id=?").run(new Date().toISOString(), "q1");
    expect(await searchQuickNotes(d, "待删除")).toEqual([]);
    await d.close();
  });
});
