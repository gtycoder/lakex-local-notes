import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureDb: vi.fn(),
  readNote: vi.fn(),
  listHistory: vi.fn(),
}));

vi.mock("./context", () => ({
  ensureDb: mocks.ensureDb,
  runWrite: (_op: string, fn: () => unknown) => fn(),
  runMaintenance: (_op: string, fn: () => unknown) => fn(),
  assets: new Map(),
  dbPort: {},
}));
vi.mock("../data/searchIndex.js", () => ({ reconcileIndex: vi.fn() }));
vi.mock("../data/noteRepository.js", () => ({ readNote: mocks.readNote }));
vi.mock("../data/trashRepository.js", () => ({}));
vi.mock("../data/historyRepository.js", () => ({ listNoteHistory: mocks.listHistory }));
vi.mock("./sync", () => ({ downloadDeclaredAssetsFor: vi.fn() }));

import { notesDomain } from "./notes";

describe("getNoteInfo 文本统计", () => {
  beforeEach(() => {
    mocks.ensureDb.mockReset();
    mocks.readNote.mockReset();
    mocks.listHistory.mockReset().mockResolvedValue([]);
  });

  it("非 doc 正文按 kind 派生，不把表格 JSON 当 Lake HTML 解析", async () => {
    const content = JSON.stringify({
      kind: "usheet",
      version: 1,
      workbook: { id: "wb", sheets: { s1: { id: "s1", name: "Sheet1", cellData: { "0": { "0": { v: "你好", m: "你好" } } } } } },
    });
    mocks.readNote.mockResolvedValue({ id: "n1", title: "表格", content, updatedAt: "2026-01-01T00:00:00.000Z", parentId: null, kind: "usheet" });
    mocks.ensureDb.mockResolvedValue({
      prepare: (sql: string) => ({
        get: async () => sql.includes("sync_state") ? { sync_state: "local", is_conflict: 0, updated_at: "2026-01-01T00:00:00.000Z" } : undefined,
      }),
    });

    const info = await notesDomain.getNoteInfo("n1");

    expect(info.charCount).toBe(2);
    expect(info.wordCount).toBe(2);
  });
});
