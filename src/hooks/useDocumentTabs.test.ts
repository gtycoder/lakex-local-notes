// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentTabs, type DocumentTabLike } from "./useDocumentTabs";
import type { PersistOutcome } from "./useSavePipeline";

type Tab = DocumentTabLike;
let closeTab: ((id: string) => Promise<void>) | null = null;
const refs: { current: Tab[] } = { current: [] };
const saveTimersRef = { current: new Map<string, number>() };

function Harness({ persistTab }: { persistTab: (id: string, title: string, content: string) => Promise<PersistOutcome> }) {
  const api = useDocumentTabs<Tab>({
    tabsRef: refs,
    activeNoteId: "a",
    setTabs: ((updater: unknown) => {
      refs.current = typeof updater === "function" ? (updater as (t: Tab[]) => Tab[])(refs.current) : (updater as Tab[]);
    }) as never,
    setActiveNoteId: () => {},
    setSaveState: () => {},
    saveTimers: saveTimersRef,
    persistTab,
    clearScrollMemory: () => {},
  });
  closeTab = api.closeTab;
  return null;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  refs.current = [{ noteId: "a", title: "A", content: "va", dirty: true, lastAccessedAt: 1 }];
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); closeTab = null; });

describe("useDocumentTabs 关闭契约（审计 F01）", () => {
  it("persistTab 失败 → 脏标签留在原文档，不关闭", async () => {
    const persistTab = vi.fn(async (): Promise<PersistOutcome> => ({ ok: false }));
    act(() => root.render(createElement(Harness, { persistTab })));
    await act(async () => { await closeTab!("a"); });
    expect(persistTab).toHaveBeenCalledTimes(1);
    expect(refs.current.map((t) => t.noteId)).toEqual(["a"]);
  });

  it("persistTab 成功 → 关闭", async () => {
    const persistTab = vi.fn(async (): Promise<PersistOutcome> => ({ ok: true }));
    act(() => root.render(createElement(Harness, { persistTab })));
    await act(async () => { await closeTab!("a"); });
    expect(refs.current).toEqual([]);
  });

  it("blocked（文档已在回收站，只读）→ 允许关闭", async () => {
    const persistTab = vi.fn(async (): Promise<PersistOutcome> => ({ ok: false, blocked: true }));
    act(() => root.render(createElement(Harness, { persistTab })));
    await act(async () => { await closeTab!("a"); });
    expect(refs.current).toEqual([]);
  });
});
