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
import { createRequestVersion } from "../core/requestVersion";
import { TRASH_NOTEBOOK_ID } from "../core/syncDecisions";
import type { OpenTab } from "../desktop/desktopTypes";

let handleTrashRestored: ((restoredId?: string) => void) | null = null;
let refreshDraftEntries: (() => Promise<void>) | null = null;
let draftEntries: unknown[] = [];
const openTabsRef: { current: OpenTab[] } = { current: [] };
function applyDraftEntries(updater: any) {
  draftEntries = typeof updater === "function" ? updater(draftEntries) : updater;
}

function Harness() {
  const tabReloadVersionRef = useRef(createRequestVersion());
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
    tabReloadVersionRef,
    openTabsRef,
    bumpRevision: () => {},
  });
  handleTrashRestored = api.handleTrashRestored;
  refreshDraftEntries = api.refreshDraftEntries;
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
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); handleTrashRestored = null; });

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
