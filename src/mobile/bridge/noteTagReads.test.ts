/**
 * P2-D：文档标签批量读取——分批读全 + 截断可见（不再静默只读前 2000 篇）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureDb: vi.fn(async () => ({ fake: "db" })),
  listNoteTagIdsForNotes: vi.fn(),
}));
vi.mock("./context", () => ({ ensureDb: mocks.ensureDb }));
vi.mock("../data/noteTagLinksRepository", () => ({ listNoteTagIdsForNotes: mocks.listNoteTagIdsForNotes }));

import { NOTE_TAG_READ_BATCH, NOTE_TAG_READ_MAX, loadNoteTagIdsForNotes } from "./noteTagReads";

const ids = (count: number, prefix = "n") => Array.from({ length: count }, (_, index) => prefix + index);

beforeEach(() => {
  mocks.ensureDb.mockClear();
  mocks.listNoteTagIdsForNotes.mockReset();
  mocks.listNoteTagIdsForNotes.mockImplementation(async (_db: unknown, part: readonly string[]) =>
    new Map(part.map((id) => [id, ["t_" + id]] as const)));
});

describe("loadNoteTagIdsForNotes（P2-D 分批 + 截断）", () => {
  it("空请求 / 非法输入 ⇒ 空结果，且不打开 DB", async () => {
    await expect(loadNoteTagIdsForNotes([])).resolves.toEqual({ byNoteId: {}, truncated: false, requested: 0, loaded: 0 });
    await expect(loadNoteTagIdsForNotes(null as unknown as string[])).resolves.toEqual({ byNoteId: {}, truncated: false, requested: 0, loaded: 0 });
    expect(mocks.ensureDb).not.toHaveBeenCalled();
  });

  it("超过单批（2500 篇）⇒ 分批读全，不截断、不丢篇", async () => {
      const list = ids(2500);
      const result = await loadNoteTagIdsForNotes(list);
      expect(mocks.listNoteTagIdsForNotes).toHaveBeenCalledTimes(2);
      const calls = mocks.listNoteTagIdsForNotes.mock.calls.map((call) => (call[1] as string[]).length);
      expect(calls).toEqual([NOTE_TAG_READ_BATCH, 500]);
      expect(result.truncated).toBe(false);
      expect(result.requested).toBe(2500);
      expect(result.loaded).toBe(2500);
      expect(Object.keys(result.byNoteId)).toHaveLength(2500);
      expect(result.byNoteId.n0).toEqual(["t_n0"]);
      expect(result.byNoteId.n2499).toEqual(["t_n2499"]);
  });

  it("去重后再计数（同一 id 重复不放大请求）", async () => {
    const result = await loadNoteTagIdsForNotes(["a", "b", "a", "", null as unknown as string]);
    expect(result.requested).toBe(2);
    expect(mocks.listNoteTagIdsForNotes).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.byNoteId).sort()).toEqual(["a", "b"]);
  });

  it("超过全库量级上限 ⇒ 截断并如实回报 requested/loaded（调用方要提示）", async () => {
    const result = await loadNoteTagIdsForNotes(ids(25_000));
    expect(result.truncated).toBe(true);
    expect(result.requested).toBe(25_000);
    expect(result.loaded).toBe(NOTE_TAG_READ_MAX);
    expect(mocks.listNoteTagIdsForNotes).toHaveBeenCalledTimes(NOTE_TAG_READ_MAX / NOTE_TAG_READ_BATCH);
    for (const call of mocks.listNoteTagIdsForNotes.mock.calls) {
      expect((call[1] as string[]).length).toBeLessThanOrEqual(NOTE_TAG_READ_BATCH);
    }
    expect(Object.keys(result.byNoteId)).toHaveLength(NOTE_TAG_READ_MAX);
  });

  it("确保只打开一次 DB（不随批次数放大）", async () => {
    await loadNoteTagIdsForNotes(ids(2500));
    expect(mocks.ensureDb).toHaveBeenCalledTimes(1);
  });
});
