// @vitest-environment jsdom
/**
 * 日记空间的搜索范围收窄（261109）：给定日记条目文档 id 集合时，全局搜索只保留这些文档命中。
 * 纯显示层过滤 —— FTS/索引/主进程 search_notes 不动（日记就是普通文档）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ searchNotes: vi.fn() }));
vi.mock("../../lib/native", () => ({ native: { searchNotes: mocks.searchNotes } }));
vi.mock("../../features/search/tagSearchIndex", () => ({ loadTagSearchIndex: vi.fn(async () => null) }));

import { SearchPanel } from "./SearchPanel";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.searchNotes.mockReset();
  mocks.searchNotes.mockResolvedValue([
    { id: "d1", kind: "note", title: "日记里的命中", snippet: "", matchType: "title", updatedAt: "2026-11-09" },
    { id: "n2", kind: "note", title: "普通文档命中", snippet: "", matchType: "title", updatedAt: "2026-11-08" },
    { id: "q1", kind: "quick-note", title: "小记命中", snippet: "", matchType: "title", updatedAt: "2026-11-07" },
  ]);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(220); });

function render(scopeNoteIds?: ReadonlySet<string>) {
  act(() => root.render(createElement(SearchPanel, {
    open: true,
    initialQuery: "命中",
    onOpenNote: vi.fn(),
    onOpenQuickNote: vi.fn(),
    onClose: vi.fn(),
    scopeNoteIds,
  })));
}

describe("SearchPanel 日记范围收窄", () => {
  it("给定日记集合时只留日记文档命中（小记与普通文档被排除）", async () => {
    render(new Set(["d1"]));
    await flush();
    expect(document.body.textContent).toContain("日记里的命中");
    expect(document.body.textContent).not.toContain("普通文档命中");
    expect(document.body.textContent).not.toContain("小记命中");
  });

  it("不传集合 = 全库范围（三种命中都出现）", async () => {
    render(undefined);
    await flush();
    expect(document.body.textContent).toContain("日记里的命中");
    expect(document.body.textContent).toContain("普通文档命中");
    expect(document.body.textContent).toContain("小记命中");
  });

  it("空集合 = 一篇都没有（不当成不过滤）", async () => {
    render(new Set());
    await flush();
    expect(document.body.textContent).toMatch(/没有匹配结果|无匹配结果/);
  });
});
