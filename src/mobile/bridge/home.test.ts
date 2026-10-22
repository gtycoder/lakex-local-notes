import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { name: "db" },
  ensureDb: vi.fn(),
  listTreeNodes: vi.fn(),
  listNotes: vi.fn(),
  listQuickNotes: vi.fn(),
}));

vi.mock("./context", () => ({ ensureDb: mocks.ensureDb }));
vi.mock("../data/treeRepository.js", () => ({ listTreeNodes: mocks.listTreeNodes }));
vi.mock("../data/noteRepository.js", () => ({ listNotes: mocks.listNotes }));
vi.mock("../data/quickNotesRepository.js", () => ({ listQuickNotes: mocks.listQuickNotes }));

import { homeDomain } from "./home";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureDb.mockResolvedValue(mocks.db);
  mocks.listTreeNodes.mockResolvedValue([{ id: "nb1", title: "笔记本" }]);
  mocks.listNotes.mockResolvedValue([{ id: "n1", title: "文档" }]);
  mocks.listQuickNotes.mockResolvedValue([{ id: "q1", previewText: "小记" }]);
});

describe("mobile home snapshot query", () => {
  it("一次返回首页所需的树、文档摘要与小记摘要投影", async () => {
    await expect(homeDomain.getHomeSnapshot()).resolves.toEqual({
      treeNodes: [{ id: "nb1", title: "笔记本" }],
      notes: [{ id: "n1", title: "文档" }],
      quickNotes: [{ id: "q1", previewText: "小记" }],
    });
    expect(mocks.ensureDb).toHaveBeenCalledTimes(1);
    expect(mocks.listTreeNodes).toHaveBeenCalledWith(mocks.db);
    expect(mocks.listNotes).toHaveBeenCalledWith(mocks.db);
    expect(mocks.listQuickNotes).toHaveBeenCalledWith(mocks.db);
  });

  it("任一投影读取失败时整体失败，不返回半份首页状态", async () => {
    mocks.listNotes.mockRejectedValueOnce(new Error("db"));
    await expect(homeDomain.getHomeSnapshot()).rejects.toThrow("db");
  });
});
