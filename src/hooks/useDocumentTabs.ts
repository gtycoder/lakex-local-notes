import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PersistOutcome } from "./useSavePipeline";
import { flushDirtyBeforeLifecycle } from "../core/lifecycleFlush";
import { flushPendingLockedTextCommits } from "../features/editor/lockedTextFlush";

export interface DocumentTabLike {
  noteId: string;
  title: string;
  content: string;
  dirty: boolean;
  lastAccessedAt: number;
}
export type SaveStateLike = "idle" | "dirty" | "saving" | "saved" | "error";

interface UseDocumentTabsInput<T extends DocumentTabLike> {
  tabsRef: MutableRefObject<T[]>;
  activeNoteId: string | null;
  setTabs: Dispatch<SetStateAction<T[]>>;
  setActiveNoteId: Dispatch<SetStateAction<string | null>>;
  /** 写某文档的保存状态（按文档，不再是全局单值）。 */
  setSaveState: (noteId: string, state: SaveStateLike) => void;
  saveTimers: MutableRefObject<Map<string, number>>;
  persistTab: (noteId: string, title?: string, content?: string) => Promise<PersistOutcome>;
  clearScrollMemory: (noteId: string) => void;
}

/** Document tab mutation boundary: switching, closing and drag reordering only. */
export function useDocumentTabs<T extends DocumentTabLike>({
  tabsRef,
  activeNoteId,
  setTabs,
  setActiveNoteId,
  setSaveState,
  saveTimers,
  persistTab,
  clearScrollMemory,
}: UseDocumentTabsInput<T>) {
  const handleTabChange = useCallback((noteId: string) => {
    setActiveNoteId(noteId);
    setTabs((tabs) => tabs.map((tab) => tab.noteId === noteId ? { ...tab, lastAccessedAt: Date.now() } : tab));
    const tab = tabsRef.current.find((item) => item.noteId === noteId);
    setSaveState(noteId, tab?.dirty ? "dirty" : "idle");
  }, [setActiveNoteId, setTabs, setSaveState, tabsRef]);

  const reorderTabs = useCallback((noteIds: string[]) => {
    setTabs((current) => {
      const byId = new Map(current.map((tab) => [tab.noteId, tab]));
      const next = noteIds.map((id) => byId.get(id)).filter((tab): tab is T => Boolean(tab));
      for (const tab of current) if (!noteIds.includes(tab.noteId)) next.push(tab);
      return next;
    });
  }, [setTabs]);

  const closeTab = useCallback(async (noteId: string) => {
    const tab = tabsRef.current.find((item) => item.noteId === noteId);
    if (!tab) return;
    const pendingTimer = saveTimers.current.get(noteId);
    if (pendingTimer !== undefined) {
      window.clearTimeout(pendingTimer);
      saveTimers.current.delete(noteId);
    }
    {
      // 加密文本卡：明文可能还在防抖窗口里（此时 tab 还不脏）⇒ 先把密文补写回 cardValue，
      // 再走 F01 闸门；补写过就等于"有过未落盘内容"，必须 persist 一次。
      const flushedCard = await flushPendingLockedTextCommits();
      const { proceed } = await flushDirtyBeforeLifecycle(
        flushedCard ? { ...tab, dirty: true } : tab,
        () => persistTab(noteId),
      );
      if (!proceed) return;
    }
    clearScrollMemory(noteId);
    const currentTabs = tabsRef.current;
    const closedIndex = currentTabs.findIndex((item) => item.noteId === noteId);
    if (closedIndex === -1) return;
    let nextActiveId: string | null = null;
    if (activeNoteId === noteId) {
      const without = currentTabs.filter((item) => item.noteId !== noteId);
      nextActiveId = without[Math.min(closedIndex, without.length - 1)]?.noteId ?? null;
    }
    setTabs((tabs) => tabs.filter((item) => item.noteId !== noteId));
    if (nextActiveId !== null) setActiveNoteId(nextActiveId);
  }, [activeNoteId, clearScrollMemory, persistTab, saveTimers, setActiveNoteId, setTabs, tabsRef]);

  return { handleTabChange, reorderTabs, closeTab };
}
