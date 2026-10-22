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

import { backfillQuickNoteListMetadata, listQuickNotes } from "./quickNotesRepository";

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
          updated_at: "2026-01-02", first_image: "a.png", tags_json: '["工作","重要"]',
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
    }]);
    expect(bodyMocks.read).not.toHaveBeenCalled();
  });

  it("旧行一次性回填标签/首图并写完成标记", async () => {
    const updates: Array<{ statement: string; values: unknown[] }> = [];
    const runs: string[] = [];
    bodyMocks.read.mockResolvedValue(JSON.stringify({
      version: 2, text: "正文", body: "<p>正文</p>", tags: ["工作"],
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

    expect(updates).toEqual([{
      statement: "UPDATE quick_notes SET tags_json=?, first_image=?, list_metadata_version=1 WHERE id=?",
      values: ['["工作"]', "a.png", "q1"],
    }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toContain("quick_note_list_metadata_v1");
  });
});
