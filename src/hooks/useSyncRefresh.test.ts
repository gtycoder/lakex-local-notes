// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getSyncPendingSummary: vi.fn(async () => ({ documents: 0, folders: 0, resources: 0, generatedAt: "" })),
  onPendingSummaryChanged: vi.fn(() => () => {}),
  onLibraryChanged: vi.fn(() => () => {}),
  listDraftJournals: vi.fn(async () => []),
  listTreeNodes: vi.fn(async () => []),
  listNoteSummaries: vi.fn(async () => []),
  readNote: vi.fn(),
  deleteDraftJournal: vi.fn(async () => {}),
}));
vi.mock("../lib/native", () => ({ native: h }));

import { useSyncRefresh } from "./useSyncRefresh";
import { createNoteReloadGuard } from "../core/requestVersion";
import { TRASH_NOTEBOOK_ID } from "../core/syncDecisions";
import type { OpenTab } from "../desktop/desktopTypes";

let handleTrashRestored: ((restoredId?: string) => void) | null = null;
let refreshDraftEntries: (() => Promise<void>) | null = null;
let reloadNoteTab: ((noteId: string) => void) | null = null;
let draftEntries: unknown[] = [];
const openTabsRef: { current: OpenTab[] } = { current: [] };
function applyDraftEntries(updater: any) {
  draftEntries = typeof updater === "function" ? updater(draftEntries) : updater;
}

function Harness() {
  const noteReloadGuardRef = useRef(createNoteReloadGuard());
  const api = useSyncRefresh({
    setPendingSummary: () => {},
    setDraftEntries: applyDraftEntries as never,
    setTreeNodes: () => {},
    setNotes: () => {},
    setOpenTabs: ((updater: unknown) => {
      openTabsRef.current = typeof updater === "function"
        ? (updater as (t: OpenTab[]) => OpenTab[])(openTabsRef.current)
        : (updater as OpenTab[]);
    }) as never,
    noteReloadGuardRef,
    openTabsRef,
    bumpRevision: () => {},
  });
  handleTrashRestored = api.handleTrashRestored;
  refreshDraftEntries = api.refreshDraftEntries;
  reloadNoteTab = api.reloadNoteTab;
  return null;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  h.readNote.mockReset();
  h.deleteDraftJournal.mockClear();
  draftEntries = [];
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); handleTrashRestored = null; reloadNoteTab = null; });

const note = (id: string, parentId: string | null, syncState: string) => ({
  id, title: id.toUpperCase(), content: `<p>${id}</p>`, parentId, syncState,
  updatedAt: "2026-10-01T00:00:00.000Z", sortOrder: 0, isConflict: false, kind: "doc" as const,
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useSyncRefresh.handleTrashRestored（审计 F04）", () => {
  it("恢复 b 不解除仍在回收站/purged 的 a 的只读标记", async () => {
    // a：仍 purged（读回成功 ≠ 已恢复）；b：本次恢复（回到活跃父 + local）
    h.readNote.mockImplementation(async (id: string) => id === "b" ? note("b", "nb", "local") : note("a", "nb", "purged"));
    openTabsRef.current = [
      { noteId: "a", title: "A", content: "<p>a</p>", dirty: false, lastAccessedAt: 1, deleted: true },
      { noteId: "b", title: "B", content: "<p>b</p>", dirty: false, lastAccessedAt: 2, deleted: true },
    ];
    act(() => root.render(createElement(Harness)));
    await act(async () => { handleTrashRestored!("b"); await tick(); await tick(); });
    expect(openTabsRef.current.find((t) => t.noteId === "b")!.deleted).toBe(false);
    // R04：a 读回成功但真实状态仍是 purged → 必须保持只读，不能被"恢复任意条目"顺手解锁
    expect(openTabsRef.current.find((t) => t.noteId === "a")!.deleted).toBe(true);
  });

  it("仍在回收站笔记本（parentId=trash）的标签同样保持 deleted", async () => {
    h.readNote.mockImplementation(async (id: string) => id === "b"
      ? note("b", "nb", "local")
      : note("a", TRASH_NOTEBOOK_ID, "local"));
    openTabsRef.current = [
      { noteId: "a", title: "A", content: "<p>a</p>", dirty: false, lastAccessedAt: 1, deleted: true },
      { noteId: "b", title: "B", content: "<p>b</p>", dirty: false, lastAccessedAt: 2, deleted: true },
    ];
    act(() => root.render(createElement(Harness)));
    await act(async () => { handleTrashRestored!("b"); await tick(); await tick(); });
    expect(openTabsRef.current.find((t) => t.noteId === "b")!.deleted).toBe(false);
    expect(openTabsRef.current.find((t) => t.noteId === "a")!.deleted).toBe(true);
  });
});

describe("useSyncRefresh.refreshDraftEntries（审计 F09）", () => {
  it("孤儿草稿（对应文档不存在）仍列出，不自动 deleteDraftJournal", async () => {
    const orphan = { noteId: "missing-doc", title: "孤儿草稿", content: "<p>last input</p>", updatedAt: "2026-09-30T00:00:00.000Z" };
    h.listDraftJournals.mockResolvedValue([orphan] as never);
    act(() => root.render(createElement(Harness)));
    await act(async () => { await refreshDraftEntries!(); });
    expect(draftEntries).toEqual([orphan]);
    // 审计 F09：不存在的草稿是最后的恢复出口，刷新路径绝不允许自动删除。
    expect(h.deleteDraftJournal).not.toHaveBeenCalled();
  });
});

describe("useSyncRefresh reload guard（审计 F03）", () => {
  it("reload(a) 后 reload(b)：b 的请求不取消 a（不同文档互不取消，R03）", async () => {
    const reads: Array<{ id: string; resolve: (v: unknown) => void }> = [];
    h.readNote.mockImplementation((id: string) => new Promise((resolve) => { reads.push({ id, resolve }); }));
    openTabsRef.current = [
      { noteId: "a", title: "A", content: "<p>old-a</p>", dirty: false, lastAccessedAt: 1 },
      { noteId: "b", title: "B", content: "<p>old-b</p>", dirty: false, lastAccessedAt: 2 },
    ];
    act(() => root.render(createElement(Harness)));
    act(() => { reloadNoteTab!("a"); reloadNoteTab!("b"); });
    await act(async () => { await tick(); });
    const readOf = (id: string) => reads.find((r) => r.id === id)!;
    await act(async () => { readOf("b").resolve(note("b", "nb", "local")); await tick(); });
    await act(async () => { readOf("a").resolve(note("a", "nb", "local")); await tick(); });
    expect(openTabsRef.current.find((t) => t.noteId === "b")!.content).toBe("<p>b</p>");
    // 旧实现：b 的 next() 会把 a 的 token 判为过期 ⇒ a 被丢弃、保持旧正文
    expect(openTabsRef.current.find((t) => t.noteId === "a")!.content).toBe("<p>a</p>");
  });

  it("同一文档连续两次 reload：旧响应作废，最新一次胜出", async () => {
    const reads: Array<{ id: string; resolve: (v: unknown) => void }> = [];
    h.readNote.mockImplementation((id: string) => new Promise((resolve) => { reads.push({ id, resolve }); }));
    openTabsRef.current = [{ noteId: "a", title: "A", content: "<p>old</p>", dirty: false, lastAccessedAt: 1 }];
    act(() => root.render(createElement(Harness)));
    act(() => { reloadNoteTab!("a"); reloadNoteTab!("a"); });
    await act(async () => { await tick(); });
    // 第二次（最新）先回，第一次（旧）后回：旧响应不得覆盖新正文
    await act(async () => { reads[1]!.resolve(note("a", "nb", "local")); await tick(); });
    await act(async () => { reads[0]!.resolve({ ...note("a", "nb", "local"), content: "<p>stale</p>" }); await tick(); });
    expect(openTabsRef.current.find((t) => t.noteId === "a")!.content).toBe("<p>a</p>");
  });
});
