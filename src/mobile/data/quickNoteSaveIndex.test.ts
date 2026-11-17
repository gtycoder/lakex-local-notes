// @vitest-environment node
/**
 * 小记「保存即建 text_cache」（261118 用户裁决：恢复演练实锤的兜底缺口收口）。
 * 此前 text_cache 只在搜索/打标时惰性建 ⇒「从没搜过的新小记」缺正文后若未同步则三条恢复路全断
 * （missingQuickNoteRecovery 的 hasTextCache 为假、UI 只能报「没有可用备份」）。
 * 本护栏钉住：保存路径（纯文本 / 内核正文）落库后无需任何搜索动作即有 text_cache。
 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";

const bodies = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm") }));
vi.mock("../native/assetFs", () => ({
  saveAssetBytesFs: async (key: string, bytes: Uint8Array) => { bodies.set(key, bytes); },
  loadAssetBytesFs: async (key: string) => bodies.get(key) ?? null,
  removeAssetBytesFs: async (key: string) => { bodies.delete(key); },
  listNoteAssetKeysFs: async () => [],
  listQuickNoteAssetKeysFs: async () => [],
  listAssetKeysFs: async () => [],
  statNoteAssetSizesFs: async () => null,
  removeNoteAssetsDirFs: async () => {},
  removeQuickNoteAssetsDirFs: async () => {},
}));

import { SqlJsAsyncDb, SqlJsDb } from "./sqliteDb.js";
import { applyMobileSchema } from "./schema.js";
import { saveQuickNote, saveQuickNoteContent } from "./quickNotesRepository.js";

const openDb = async () => {
  const db = new SqlJsAsyncDb(await SqlJsDb.open());
  await applyMobileSchema(db);
  return db;
};
const textCacheOf = async (db: SqlJsAsyncDb, id: string) =>
  ((await db.prepare("SELECT text_cache FROM quick_notes_search_index WHERE quick_note_id=?").get(id)) as { text_cache: string } | undefined)?.text_cache;

describe("小记保存即建 text_cache", () => {
  it("saveQuickNote 后无需任何搜索/打标即有 text_cache（兜底不再有窗口）", async () => {
    const db = await openDb();
    await saveQuickNote(db, "q1", "你好世界 hello");
    expect(await textCacheOf(db, "q1")).toContain("hello");
    expect(await textCacheOf(db, "q1")).toContain("你好世界");
  });

  it("再次保存内容变化 ⇒ text_cache 跟新（force=false 靠 content_hash 短路）", async () => {
    const db = await openDb();
    await saveQuickNote(db, "q1", "v1 初稿");
    await saveQuickNote(db, "q1", "v2 内容变了");
    expect(await textCacheOf(db, "q1")).toContain("v2");
  });

  it("内核正文路径 saveQuickNoteContent 同样建", async () => {
    const db = await openDb();
    await saveQuickNoteContent(db, "q2", { text: "内核小记", body: "<p>内核小记</p>", images: [] });
    expect(await textCacheOf(db, "q2")).toContain("内核小记");
  });
});
