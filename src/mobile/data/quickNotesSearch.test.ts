import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMobileSchema } from "./schema.js";
import { searchQuickNotes } from "./quickNotesSearch.js";
import { listQuickNotePage } from "./quickNotesRepository.js";
import type { MobileDb, MobileDbStatement } from "./dbPortTypes.js";
import { writeQuickNoteBody } from "./noteBodies.js";
import { normalizeQuickNoteContent, serializeQuickNoteContent } from "../../core/quickNoteModel.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { mobileQuickNoteTags } from "./quickNoteTagService.js";

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
  for (const name of tagNames) tags.push(await mobileQuickNoteTags.create(d, name));
  const content = normalizeQuickNoteContent(text, `<p>${text}</p>`, []);
  const serialized = serializeQuickNoteContent(content);
  await writeQuickNoteBody(id, serialized);
  const now = new Date().toISOString();
  await d.prepare(
    "INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, is_dirty, is_conflict) VALUES (?,?,?,?,0,?,1,0) " +
    "ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, preview_text=excluded.preview_text, content_hash=excluded.content_hash, is_dirty=1, deleted_at=NULL, restore_pending_at=NULL"
  ).run(id, now, now, text.replace(/\s+/g, " ").trim(), sha256Sync(new TextEncoder().encode(serialized)));
  // 标签走独立关联表（正文里没有标签）。
  await mobileQuickNoteTags.setNoteTags(d, id, tags.map((tag) => tag.id));
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

  it("删除/缺失的小记会从索引对账移除", async () => {
    const d = await makeDb();
    await addQuickNote(d, "q1", "待删除");
    expect((await searchQuickNotes(d, "待删除")).length).toBe(1);
    await d.prepare("UPDATE quick_notes SET deleted_at=? WHERE id=?").run(new Date().toISOString(), "q1");
    expect(await searchQuickNotes(d, "待删除")).toEqual([]);
    await d.close();
  });

  /**
   * 261124 修复回归：restore_pending_at 是「local-wins 重传」标记，**不是可见性开关**。
   * 旧实现把它当可见性条件 ⇒ 未开云同步时（标记永远不清）恢复的小记从列表与搜索里消失
   * （真机复现：恢复成功、回收站清空、首页仍「暂无小记」）。可见性只看 deleted_at。
   */
  it("恢复中的行（restore_pending_at）仍在列表与搜索里：可见性只看 deleted_at", async () => {
    const d = await makeDb();
    await addQuickNote(d, "q-rp", "恢复后应当立即可见");
    expect((await searchQuickNotes(d, "立即可见")).length).toBe(1);

    // 软删（进回收站）⇒ 对账把索引清掉、列表隐藏
    await d.prepare("UPDATE quick_notes SET deleted_at=? WHERE id=?").run(new Date().toISOString(), "q-rp");
    expect(await searchQuickNotes(d, "立即可见")).toEqual([]);
    expect((await listQuickNotePage(d, {})).items.map((i) => i.id)).not.toContain("q-rp");

    // 恢复 = 清 deleted_at + 写 restore_pending（bridge.restoreQuickNote 同语义；无云同步 ⇒ 标记不清）
    await d.prepare("UPDATE quick_notes SET deleted_at=NULL, restore_pending_at=? WHERE id=?").run(new Date().toISOString(), "q-rp");
    expect((await listQuickNotePage(d, {})).items.map((i) => i.id)).toContain("q-rp");
    expect((await searchQuickNotes(d, "立即可见")).map((h) => h.id)).toEqual(["q-rp"]);
    await d.close();
  });

  it("标签关系：新增/改名/删除都维护搜索索引；删标签只清关联、不删小记", async () => {
    const d = await makeDb();
    const tag = await mobileQuickNoteTags.create(d, "灵感");
    await addQuickNote(d, "q1", "正文");
    await mobileQuickNoteTags.setNoteTags(d, "q1", [tag.id]);
    expect((await searchQuickNotes(d, "灵感")).map((hit) => hit.id)).toEqual(["q1"]);

    await mobileQuickNoteTags.update(d, tag.id, { name: "项目" });
    expect(await searchQuickNotes(d, "灵感")).toEqual([]);
    expect((await searchQuickNotes(d, "项目")).map((hit) => hit.id)).toEqual(["q1"]);

    const result = await mobileQuickNoteTags.delete(d, tag.id);
    expect(result.updated).toBe(1);
    expect(await searchQuickNotes(d, "项目")).toEqual([]);
    expect((await d.prepare("SELECT COUNT(*) AS c FROM quick_notes WHERE id=?").get("q1") as { c: number }).c).toBe(1);
    await d.close();
  });

  it("合并标签：关联改指向目标、源标签墓碑（事务内不再嵌套 BEGIN）", async () => {
    const d = await makeDb();
    const source = await mobileQuickNoteTags.create(d, "灵感");
    const target = await mobileQuickNoteTags.create(d, "待办");
    await addQuickNote(d, "q1", "合并", ["灵感", "待办"]);

    const result = await mobileQuickNoteTags.merge(d, source.id, target.id);
    expect(result.updated).toBe(1);
    expect(await mobileQuickNoteTags.tagIds(d, "q1")).toEqual([target.id]);
    expect((await mobileQuickNoteTags.list(d)).map((tag) => tag.name)).toEqual(["待办"]);
    await d.close();
  });
});
