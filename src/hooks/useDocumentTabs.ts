import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { withViewTransition } from "../lib/viewTransition";

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
  setSaveState: Dispatch<SetStateAction<SaveStateLike>>;
  saveTimers: MutableRefObject<Map<string, number>>;
  persistTab: (noteId: string, title: string, content: string) => Promise<unknown>;
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
    withViewTransition(() => {
      setActiveNoteId(noteId);
      setTabs((tabs) => tabs.map((tab) => tab.noteId === noteId ? { ...tab, lastAccessedAt: Date.now() } : tab));
    });
    const tab = tabsRef.current.find((item) => item.noteId === noteId);
    setSaveState(tab?.dirty ? "dirty" : "idle");
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
    clearScrollMemory(noteId);
    const pendingTimer = saveTimers.current.get(noteId);
    if (pendingTimer !== undefined) {
      window.clearTimeout(pendingTimer);
      saveTimers.current.delete(noteId);
    }
    if (tab.dirty) await persistTab(noteId, tab.title, tab.content);
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
