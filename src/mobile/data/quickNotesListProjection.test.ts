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
          updated_at: "2026-01-02", first_image: "a.png",
        }] });
        if (sql.includes("tag_links")) return statement({ all: async () => [
          { target_id: "q1", tag_id: "t_0123456789abcdef" },
          { target_id: "q1", tag_id: "t_abcdef0123456789" },
        ] });
        if (sql.includes("FROM tags")) return statement({ all: async () => [
          { id: "t_0123456789abcdef", name: "工作", sort_order: 0, pinned: 0, created_at: "c", updated_at: "u", deleted_at: null },
          { id: "t_abcdef0123456789", name: "重要", sort_order: 1, pinned: 0, created_at: "c", updated_at: "u", deleted_at: null },
        ] });
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

  it("旧行一次性回填首图并写完成标记（标签在关联表，不回填到行里）", async () => {
    const updates: Array<{ statement: string; values: unknown[] }> = [];
    const runs: string[] = [];
    bodyMocks.read.mockResolvedValue(JSON.stringify({
      version: 3, text: "正文", body: "<p>正文</p>",
      images: [{ id: "i1", filename: "a.png", mimeType: "image/png", width: 1, height: 1, size: 1, hash: "h" }],
    }));
    const db: MobileDb = {
      prepare(sql) {
        if (sql.includes("SELECT value FROM device_state")) return statement();
        if (sql.includes("SELECT id FROM quick_notes")) return statement({ all: async () => [{ id: "q1" }] });
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

    // 261027：回填也补 preview_text/image_count（同步后导入的行按旧逻辑永远轮不到一次性的首图回填）。
    expect(updates).toEqual([{
      statement: "UPDATE quick_notes SET preview_text=?, image_count=?, first_image=?, list_metadata_version=1 WHERE id=?",
      values: ["正文", 1, "a.png", "q1"],
    }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain("quick_note_list_metadata_v1");
  });

  it("QuickNotePage 使用 keyset cursor + LIMIT，返回下一页游标而不读正文", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const rows = [
      { id: "q3", created_at: "c3", preview_text: "3", image_count: 0, updated_at: "2026-01-03", first_image: null },
      { id: "q2", created_at: "c2", preview_text: "2", image_count: 0, updated_at: "2026-01-02", first_image: null },
      { id: "q1", created_at: "c1", preview_text: "1", image_count: 0, updated_at: "2026-01-01", first_image: null },
    ];
    let pageCalls = 0;
    const db: MobileDb = {
      prepare(sql) {
        if (sql.includes("FROM quick_notes")) {
          return statement({
            all: async (...values: unknown[]) => {
              pageCalls += 1;
              calls.push({ sql, values });
              return pageCalls === 1 ? rows : rows.slice(2);
            },
          });
        }
        // 关联表 / 标签目录：本用例只关心分页 SQL，给空结果。
        return statement();
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
