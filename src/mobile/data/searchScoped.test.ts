/**
 * 移动端搜索「范围筛选」数据层护栏（261105 搜索增强）。
 *
 * 用 better-sqlite3 + 生产同款 schema（含 FTS5）验证真实 SQL：
 * - 标题范围只匹配标题；正文范围用 FTS5 列过滤 `body : (expr)`（标题命中不算正文）；
 * - 标签范围走 tag_links → tags.name（文档 target_kind='note' / 小记 'quickNote'），标签名可含空格；
 * - 「全部」= 不限字段：标签独有命中补在后、与标题/正文命中按 id 去重；
 * - 回收站（trashed_at）/已删小记不参与；无 FTS 环境（Web 预览）正文范围降级为 text_cache LIKE。
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyMobileSchema } from "./schema.js";
import { indexNote, searchDocsByScope } from "./searchIndex.js";
import { searchQuickNotesByScope } from "./quickNotesSearch.js";
import { searchNotes } from "./noteRepository.js";
import { writeQuickNoteBody } from "./noteBodies.js";
import type { MobileDb, MobileDbStatement } from "./sqliteDb.js";
import { sha256Sync } from "../../core/sha256Sync.js";

const T = "2026-11-05T00:00:00.000Z";

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

async function makeDb(): Promise<MobileDb> {
  const d = adapt(new Database(":memory:"));
  await applyMobileSchema(d);
  return d;
}

/** 无 FTS5 的最小库（Web 预览/旧库）：验证正文范围的 LIKE 降级。 */
async function makeDbWithoutFts(): Promise<MobileDb> {
  const d = adapt(new Database(":memory:"));
  await d.exec([
    "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT, updated_at TEXT NOT NULL, content_hash TEXT, is_dirty INTEGER NOT NULL DEFAULT 0, text_cache TEXT, trashed_at TEXT, doc_kind TEXT NOT NULL DEFAULT 'doc');",
    "CREATE TABLE folders (id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT);",
    "CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);",
    "CREATE TABLE tag_links (target_kind TEXT NOT NULL, target_id TEXT NOT NULL, tag_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(target_kind, target_id, tag_id));",
  ].join("\n"));
  return d;
}

async function ensureTag(d: MobileDb, name: string): Promise<string> {
  const id = "t-" + name;
  await d.prepare("INSERT OR IGNORE INTO tags (id,name,sort_order,created_at,updated_at) VALUES (?,?,0,?,?)").run(id, name, T, T);
  return id;
}

async function linkTag(d: MobileDb, kind: "note" | "quickNote", targetId: string, name: string, position = 0): Promise<void> {
  await d.prepare("INSERT OR IGNORE INTO tag_links (target_kind,target_id,tag_id,position) VALUES (?,?,?,?)")
    .run(kind, targetId, await ensureTag(d, name), position);
}

async function addDoc(
  d: MobileDb,
  id: string,
  args: { title: string; body: string; trashed?: boolean; tags?: string[] },
): Promise<void> {
  await d.prepare(
    "INSERT INTO notes (id,title,parent_id,updated_at,content_hash,is_dirty,text_cache,doc_kind,trashed_at) VALUES (?,?,NULL,?,?,1,?,'doc',?)"
  ).run(id, args.title, T, sha256Sync(new TextEncoder().encode(args.body)), args.body, args.trashed ? T : null);
  await indexNote(d, id);
  for (const [index, name] of (args.tags ?? []).entries()) await linkTag(d, "note", id, name, index);
}

async function addQuickNote(
  d: MobileDb,
  id: string,
  args: { text: string; tags?: string[]; deleted?: boolean },
): Promise<void> {
  await writeQuickNoteBody(id, JSON.stringify({ text: args.text }));
  await d.prepare(
    "INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, is_dirty, is_conflict, deleted_at) VALUES (?,?,?,?,0,?,1,0,?)"
  ).run(id, T, T, args.text.replace(/\s+/g, " ").trim(), sha256Sync(new TextEncoder().encode(args.text)), args.deleted ? T : null);
  for (const [index, name] of (args.tags ?? []).entries()) await linkTag(d, "quickNote", id, name, index);
}

const ids = (rows: Array<{ id: string }>): string[] => rows.map((row) => row.id);

describe("搜索范围：文档（真实 FTS5）", () => {
  it("标题范围：只按标题匹配（正文命中/回收站不计）", async () => {
    const d = await makeDb();
    try {
      await addDoc(d, "n1", { title: "项目计划", body: "无关内容" });
      await addDoc(d, "n2", { title: "无关标题", body: "正文里提到项目计划" });
      await addDoc(d, "n3", { title: "项目计划（已删）", body: "无关", trashed: true });

      const hits = await searchDocsByScope(d, "项目", "title");
      expect(ids(hits)).toEqual(["n1"]);
      expect(hits[0].matchType).toBe("title");
      expect(hits[0].snippet).toContain("<mark>");
    } finally { await d.close(); }
  });

  it("正文范围：FTS5 列过滤只认正文（标题命中不算）", async () => {
    const d = await makeDb();
    try {
      await addDoc(d, "n1", { title: "项目计划", body: "无关内容" });
      await addDoc(d, "n2", { title: "无关标题", body: "正文里提到项目计划" });
      await addDoc(d, "n3", { title: "Lake 笔记", body: "正文提到 Lake 与其它" });

      const hits = await searchDocsByScope(d, "项目", "body");
      expect(ids(hits)).toEqual(["n2"]);
      // 英文前缀查询走同一条列过滤路径（body : ("lak"*)）
      const prefix = await searchDocsByScope(d, "Lak", "body");
      expect(ids(prefix)).toEqual(["n3"]);
    } finally { await d.close(); }
  });

  it("标签范围：文档标签命中（标签名可含空格，不被拼串拆开）", async () => {
    const d = await makeDb();
    try {
      await addDoc(d, "n1", { title: "周会纪要", body: "无关", tags: ["项目", "移动 搜索"] });
      await addDoc(d, "n2", { title: "另一篇", body: "无关", tags: ["生活"] });
      await addDoc(d, "n3", { title: "已删", body: "无关", tags: ["项目"], trashed: true });

      const hits = await searchDocsByScope(d, "项目", "tags");
      expect(ids(hits)).toEqual(["n1"]);
      expect(hits[0].matchedTags).toEqual(["项目"]);

      const spaced = await searchDocsByScope(d, "移动", "tags");
      expect(spaced[0].matchedTags).toEqual(["移动 搜索"]);
    } finally { await d.close(); }
  });

  it("全部范围 = 不限字段：标签独有命中补在后，命中多处只出一条并带上标签名", async () => {
    const d = await makeDb();
    try {
      await addDoc(d, "n1", { title: "项目计划", body: "无关" });                       // 标题命中
      await addDoc(d, "n2", { title: "无关", body: "正文提到项目" });                    // 正文命中
      await addDoc(d, "n3", { title: "只有标签", body: "无关", tags: ["项目"] });         // 标签独有命中
      await addDoc(d, "n4", { title: "项目复盘", body: "无关", tags: ["项目"] });         // 标题 + 标签

      const hits = await searchDocsByScope(d, "项目", "all");
      expect(ids(hits).slice(0, 2)).toEqual(["n1", "n4"]);
      expect(ids(hits)).toContain("n2");
      expect(ids(hits)).toContain("n3");
      expect(new Set(ids(hits)).size).toBe(hits.length); // 去重
      expect(hits.find((hit) => hit.id === "n4")?.matchedTags).toEqual(["项目"]);
    } finally { await d.close(); }
  });

  it("无 FTS（Web 预览）：正文范围降级 text_cache LIKE，「全部」= 标题 ∪ 正文 ∪ 标签", async () => {
    const d = await makeDbWithoutFts();
    try {
      await addDoc(d, "n1", { title: "项目计划", body: "无关内容" });
      await addDoc(d, "n2", { title: "无关标题", body: "正文里提到项目计划" });
      await addDoc(d, "n3", { title: "只有标签", body: "无关", tags: ["项目"] });
      expect(ids(await searchDocsByScope(d, "项目", "body"))).toEqual(["n2"]);
      // 「全部」在无 FTS 时也不能空：标题 ∪ 正文 ∪ 标签
      expect(ids(await searchDocsByScope(d, "项目", "all")).sort()).toEqual(["n1", "n2", "n3"]);
    } finally { await d.close(); }
  });
});

describe("搜索范围：小记", () => {
  it("正文范围只认正文；标签范围只认标签；标题范围不召回小记", async () => {
    const d = await makeDb();
    try {
      await addQuickNote(d, "q1", { text: "项目计划随手记", tags: ["灵感"] });
      await addQuickNote(d, "q2", { text: "无关内容", tags: ["项目"] });
      await addQuickNote(d, "q3", { text: "项目 已删除", deleted: true });

      expect(ids(await searchQuickNotesByScope(d, "项目", "body"))).toEqual(["q1"]);
      expect(ids(await searchQuickNotesByScope(d, "项目", "tags"))).toEqual(["q2"]);
      expect(ids(await searchQuickNotesByScope(d, "灵感", "tags"))).toEqual(["q1"]);
      expect(await searchQuickNotesByScope(d, "项目", "title")).toEqual([]);
    } finally { await d.close(); }
  });

  it("全部范围保持既有口径：正文与标签都召回（文档在前、小记在后）", async () => {
    const d = await makeDb();
    try {
      await addDoc(d, "n1", { title: "项目计划", body: "无关" });
      await addQuickNote(d, "q1", { text: "项目计划随手记", tags: [] });
      const hits = await searchNotes(d, "项目", "all");
      expect(ids(hits)).toEqual(["n1", "q1"]);
    } finally { await d.close(); }
  });
});
