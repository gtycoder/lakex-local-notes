// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => ({
  sort: "recent" as "recent" | "oldest" | "createdNew" | "createdOld",
  write: vi.fn(),
}));

vi.mock("../../lib/quickNoteSortPref", () => ({
  readQuickNoteSort: () => prefs.sort,
  writeQuickNoteSort: prefs.write,
}));

import { quickNoteTagId, type QuickNoteTag } from "../../core/quickNoteTags";
import type { QuickNoteDetail } from "./useQuickNoteDetailCache";
import { useQuickNoteListModel, type QuickNoteListSource } from "./useQuickNoteListModel";

const tagOf = (name: string, patch: Partial<QuickNoteTag> = {}): QuickNoteTag => ({
  id: quickNoteTagId(name),
  name,
  sortOrder: 0,
  pinned: false,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  deletedAt: null,
  ...patch,
});
const directoryOf = (names: string[]) => names.map((name) => tagOf(name));
const idsOf = (names: string[]) => names.map(quickNoteTagId);

const note = (id: string, updatedAt: string, createdAt: string, tagNames: string[] = []): QuickNoteListSource => ({
  id,
  previewText: id,
  imageCount: 0,
  createdAt,
  updatedAt,
  firstImage: null,
  tags: tagNames,
  tagIds: idsOf(tagNames),
});

const detail = (tagNames: string[], firstImage: string | null = null): QuickNoteDetail => ({
  body: "<p>x</p>",
  images: [],
  tags: tagNames,
  tagIds: idsOf(tagNames),
  firstImage,
  updatedAt: "2026-10-22T00:00:00.000Z",
});

type Model = ReturnType<typeof useQuickNoteListModel<QuickNoteListSource>>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let model: Model;

function Harness(props: { notes: QuickNoteListSource[]; details: Map<string, QuickNoteDetail>; tags: QuickNoteTag[] }) {
  model = useQuickNoteListModel(props.notes, props.details, props.tags);
  return null;
}

const render = (notes: QuickNoteListSource[], details = new Map<string, QuickNoteDetail>(), tags: QuickNoteTag[] = []) => {
  act(() => root.render(createElement(Harness, { notes, details, tags })));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  prefs.sort = "recent";
  prefs.write.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useQuickNoteListModel", () => {
  it("详情覆盖正文、标签与首图，并据此重建标签索引", () => {
    const details = new Map([["a", detail(["重要"], "cover.png")]]);
    render([note("a", "2026-10-22T00:00:02.000Z", "2026-10-22T00:00:00.000Z")], details, directoryOf(["重要"]));
    expect(model.displayedQuickNotes[0]).toMatchObject({ body: "<p>x</p>", tags: ["重要"], firstImage: "cover.png" });
    expect(model.quickTagIndex.tags.map((tag) => ({ name: tag.name, count: tag.count }))).toEqual([{ name: "重要", count: 1 }]);
  });

  it("先按标签筛选，再按当前排序输出，不改动原数组", () => {
    const notes = [
      note("a", "2026-10-22T00:00:03.000Z", "2026-10-20T00:00:00.000Z", ["重要"]),
      note("b", "2026-10-22T00:00:01.000Z", "2026-10-21T00:00:00.000Z", ["重要"]),
      note("c", "2026-10-22T00:00:02.000Z", "2026-10-22T00:00:00.000Z", []),
    ];
    render(notes, new Map(), directoryOf(["重要"]));
    act(() => model.setQuickTagFilter({ kind: "tag", id: quickNoteTagId("重要") }));
    expect(model.sortedQuickNotes.map((item) => item.id)).toEqual(["a", "b"]);

    act(() => model.setQuickSort("createdNew"));
    expect(model.sortedQuickNotes.map((item) => item.id)).toEqual(["b", "a"]);
    expect(prefs.write).toHaveBeenCalledWith("createdNew");
    expect(notes.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("当前标签从索引消失后自动回到全部", () => {
    render([note("a", "2026-10-22T00:00:01.000Z", "2026-10-22T00:00:00.000Z", ["旧标签"])], new Map(), directoryOf(["旧标签"]));
    act(() => model.setQuickTagFilter({ kind: "tag", id: quickNoteTagId("旧标签") }));
    render([note("a", "2026-10-22T00:00:01.000Z", "2026-10-22T00:00:00.000Z", [])], new Map(), []);
    expect(model.quickTagFilter).toEqual({ kind: "all" });
  });
});
