// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const editorMocks = vi.hoisted(() => ({ clearScrollMemory: vi.fn(), locateEditorSearchHit: vi.fn() }));
vi.mock("../lib/native", () => ({ native: {} }));
vi.mock("../features/editor/EditorTab", () => ({
  clearScrollMemory: editorMocks.clearScrollMemory,
  locateEditorSearchHit: editorMocks.locateEditorSearchHit,
}));

import { useTabLifecycle } from "./useTabLifecycle";
import { trimTabsToLimit } from "../core/tabLimit";
import type { OpenTab } from "../desktop/desktopTypes";
import type { PersistOutcome } from "./useSavePipeline";

let evict: ((tabs: OpenTab[], openedId: string) => Promise<{ evictedIds: string[]; failedIds: string[] }>) | null = null;
const openTabsRef: { current: OpenTab[] } = { current: [] };

function Harness({ persistTab, maxOpenTabs }: { persistTab: (id: string, title?: string, content?: string) => Promise<PersistOutcome>; maxOpenTabs: number }) {
  const api = useTabLifecycle({
    settingsMaxOpenTabs: maxOpenTabs,
    pinnedNoteIds: new Set<string>(),
    openTabsRef,
    persistTab,
    scheduleSave: () => {},
    resetRevision: () => {},
    showNotice: () => {},
    setError: () => {},
    setOpenTabs: ((updater: unknown) => {
      openTabsRef.current = typeof updater === "function" ? (updater as (t: OpenTab[]) => OpenTab[])(openTabsRef.current) : (updater as OpenTab[]);
    }) as never,
    setActiveNoteId: () => {},
    setPinnedNoteIds: () => {},
    setDraftEntries: () => {},
    setSaveState: () => {},
  });
  evict = api.evictTabsForLimit;
  return null;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  editorMocks.clearScrollMemory.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); evict = null; });

const tab = (over: Partial<OpenTab> & { noteId: string }): OpenTab => ({ title: over.noteId, content: "c", dirty: false, lastAccessedAt: 1000, ...over });

describe("useTabLifecycle 淘汰契约（审计 F01）", () => {
  it("脏标签保存失败则保留（failedIds），只淘汰已确认持久化的", async () => {
    openTabsRef.current = [
      tab({ noteId: "a", lastAccessedAt: 200 }),
      tab({ noteId: "b", dirty: true, lastAccessedAt: 100 }),
      tab({ noteId: "c", lastAccessedAt: 300 }),
      tab({ noteId: "d", lastAccessedAt: 50 }),
    ];
    const persistTab = vi.fn(async (id: string): Promise<PersistOutcome> => id === "b" ? { ok: false } : { ok: true });
    act(() => root.render(createElement(Harness, { persistTab, maxOpenTabs: 2 })));
    let out!: { evictedIds: string[]; failedIds: string[] };
    await act(async () => { out = await evict!([...openTabsRef.current], "c"); });
    expect(out.failedIds).toEqual(["b"]);
    expect(out.evictedIds).toEqual(["d"]);
    // 封顶时受保护标签不被顺手淘汰（不补位）
    const trimmed = trimTabsToLimit(openTabsRef.current, { limit: 2, activeNoteId: "c", pinnedNoteIds: new Set(), protectNoteIds: new Set(out.failedIds) });
    expect(trimmed.map((t) => t.noteId)).toEqual(["a", "b", "c"]);
    expect(editorMocks.clearScrollMemory).not.toHaveBeenCalledWith("b");
  });
});
