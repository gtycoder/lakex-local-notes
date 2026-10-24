import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileDb, MobileDbStatement } from "./sqliteDb";

const bodyMocks = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock("./noteBodies.js", () => ({
  readQuickNoteBody: bodyMocks.read,
  writeQuickNoteBody: vi.fn(async () => 0),
  restoreQuickNoteBody: vi.fn(async () => undefined),
}));

import { backfillQuickNoteListMetadata, listQuickNotePage, listQuickNotes } from "./quickNotesRepository";

function statement(overrides: Partial<MobileDbStatement> = {}): MobileDbStatement {
  return {
    async get() { return undefined; },
    async all() { return []; },
    async run() { return { changes: 1, lastInsertRowid: 0 }; },
    ...overrides,
  };
}

describe("小记列表轻量投影", () => {
  beforeEach(() => bodyMocks.read.mockReset());

  it("listQuickNotes 只读 SQLite 元数据，不读正文文件", async () => {
    const db: MobileDb = {
      prepare(sql) {
        if (sql.includes("SELECT id, created_at")) return statement({ all: async () => [{
          id: "q1", created_at: "2026-01-01", preview_text: "摘要", image_count: 1,
          updated_at: "2026-01-02", first_image: "a.png", tags_json: '["工作","重要"]', tag_ids_json: '["t_0123456789abcdef","t_abcdef0123456789"]',
        }] });
        return statement();
      },
      async transaction<T extends (...args: never[]) => Promise<unknown>>(fn: T): Promise<Awaited<ReturnType<T>>> { return await fn() as Awaited<ReturnType<T>>; },
      async pragma() { return undefined; },
      async exec() { return undefined; },
      async databaseSizeBytes() { return 0; },
      async close() { return undefined; },
    };

    await expect(listQuickNotes(db)).resolves.toEqual([{
      id: "q1", createdAt: "2026-01-01", previewText: "摘要", imageCount: 1,
      updatedAt: "2026-01-02", firstImage: "a.png", tags: ["工作", "重要"],
      tagIds: ["t_0123456789abcdef", "t_abcdef0123456789"],
    }]);
    expect(bodyMocks.read).not.toHaveBeenCalled();
  });

  it("旧行一次性回填标签/首图并写完成标记", async () => {
    const updates: Array<{ statement: string; values: unknown[] }> = [];
    const runs: string[] = [];
    bodyMocks.read.mockResolvedValue(JSON.stringify({
      version: 3, text: "正文", body: "<p>正文</p>", tagIds: ["t_0123456789abcdef"],
      images: [{ id: "i1", filename: "a.png", mimeType: "image/png", width: 1, height: 1, size: 1, hash: "h" }],
    }));
    const db: MobileDb = {
      prepare(sql) {
        if (sql.includes("SELECT value FROM device_state")) return statement();
        if (sql.includes("SELECT id FROM quick_notes")) return statement({ all: async () => [{ id: "q1" }] });
        if (sql.includes("FROM quick_note_tags")) return statement({ all: async () => [{ id: "t_0123456789abcdef", name: "工作" }] });
        return statement({ run: async () => { runs.push(sql); return { changes: 1, lastInsertRowid: 0 }; } });
      },
      async executeSet(set) { updates.push(...set); },
      async transaction<T extends (...args: never[]) => Promise<unknown>>(fn: T): Promise<Awaited<ReturnType<T>>> { return await fn() as Awaited<ReturnType<T>>; },
      async pragma() { return undefined; },
      async exec() { return undefined; },
      async databaseSizeBytes() { return 0; },
      async close() { return undefined; },
    };

    await backfillQuickNoteListMetadata(db);

    expect(updates).toEqual([{
      statement: "UPDATE quick_notes SET tags_json=?, tag_ids_json=?, first_image=?, list_metadata_version=1 WHERE id=?",
      values: ['["工作"]', '["t_0123456789abcdef"]', "a.png", "q1"],
    }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain("quick_note_list_metadata_v1");
  });

  it("QuickNotePage 使用 keyset cursor + LIMIT，返回下一页游标而不读正文", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const rows = [
      { id: "q3", created_at: "c3", preview_text: "3", image_count: 0, updated_at: "2026-01-03", first_image: null, tags_json: "[]" },
      { id: "q2", created_at: "c2", preview_text: "2", image_count: 0, updated_at: "2026-01-02", first_image: null, tags_json: "[]" },
      { id: "q1", created_at: "c1", preview_text: "1", image_count: 0, updated_at: "2026-01-01", first_image: null, tags_json: "[]" },
    ];
    let call = 0;
    const db: MobileDb = {
      prepare(sql) {
        return statement({
          all: async (...values: unknown[]) => {
            calls.push({ sql, values });
            call += 1;
            return call === 1 ? rows : rows.slice(2);
          },
        });
      },
      async transaction<T extends (...args: never[]) => Promise<unknown>>(fn: T): Promise<Awaited<ReturnType<T>>> { return await fn() as Awaited<ReturnType<T>>; },
      async pragma() { return undefined; },
      async exec() { return undefined; },
      async databaseSizeBytes() { return 0; },
      async close() { return undefined; },
    };

    const first = await listQuickNotePage(db, { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(["q3", "q2"]);
    expect(first.nextCursor).toEqual({ updatedAt: "2026-01-02", id: "q2" });
    expect(calls[0]?.sql).toContain("ORDER BY updated_at DESC, id DESC LIMIT ?");
    expect(calls[0]?.values).toEqual([3]);

    const second = await listQuickNotePage(db, { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.id)).toEqual(["q1"]);
    expect(second.nextCursor).toBeNull();
    expect(calls[1]?.sql).toContain("updated_at < ? OR (updated_at = ? AND id < ?)");
    expect(calls[1]?.values).toEqual(["2026-01-02", "2026-01-02", "q2", 3]);
    expect(bodyMocks.read).not.toHaveBeenCalled();
  });
});
