import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileDb, MobileDbStatement } from "./sqliteDb";

vi.mock("./noteBodies.js", () => ({
  readQuickNoteBody: vi.fn(async () => null),
  writeQuickNoteBody: vi.fn(async () => 0),
  restoreQuickNoteBody: vi.fn(async () => undefined),
}));

import { saveQuickNote, saveQuickNoteContent, saveQuickNoteWithImages } from "./quickNotesRepository";

let upserts: unknown[][] = [];
let tombstoneDeletes: unknown[][] = [];

function fakeDb(): MobileDb {
  const stmt = (sql: string): MobileDbStatement => ({
    async get(..._params: unknown[]) { return undefined; },
    async all(..._params: unknown[]) { return []; },
    async run(...params: unknown[]) {
      if (sql.includes("INSERT INTO quick_notes")) upserts.push(params);
      if (sql.includes("DELETE FROM quick_note_deleted")) tombstoneDeletes.push(params);
      return { changes: 1, lastInsertRowid: 0 };
    },
  });
  return {
    prepare: stmt,
    async transaction<T extends (...args: never[]) => Promise<unknown>>(fn: T): Promise<Awaited<ReturnType<T>>> {
      return await fn() as Awaited<ReturnType<T>>;
    },
    async pragma() { return undefined; },
    async exec() { return undefined; },
    async databaseSizeBytes() { return 0; },
    async close() { return undefined; },
  };
}

describe("小记写入核心", () => {
  beforeEach(() => {
    upserts = [];
    tombstoneDeletes = [];
  });

  it("三条保存入口都 upsert 并清删除墓碑", async () => {
    const db = fakeDb();
    await saveQuickNote(db, "q1", "纯文本", []);
    await saveQuickNoteWithImages(db, "q2", "图片入口", [], { assets: new Map(), saveAssetFile: vi.fn(async () => undefined) });
    await saveQuickNoteContent(db, "q3", { text: "富文本", body: "<p>富文本</p>", images: [] });

    expect(upserts).toHaveLength(3);
    expect(tombstoneDeletes).toEqual([["q1"], ["q2"], ["q3"]]);
  });
});
