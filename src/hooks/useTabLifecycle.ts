import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { clearScrollMemory, locateEditorSearchHit } from "../features/editor/EditorTab";
import { selectEvictionIds, trimTabsToLimit } from "../core/tabLimit";
import type { DraftJournalEntry } from "../lib/types";
import type { OpenTab } from "../desktop/desktopTypes";
import type { SaveState } from "./useSavePipeline";

export interface UseTabLifecycleOptions {
  settingsMaxOpenTabs: number;
  pinnedNoteIds: Set<string>;
  openTabsRef: MutableRefObject<OpenTab[]>;
  persistTab: (noteId: string, title: string, content: string) => Promise<unknown>;
  scheduleSave: (noteId: string, content: string) => void;
  resetRevision: (noteId: string, revision?: number) => void;
  showNotice: (text: string) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>;
  setActiveNoteId: Dispatch<SetStateAction<string | null>>;
  setPinnedNoteIds: Dispatch<SetStateAction<Set<string>>>;
  setDraftEntries: Dispatch<SetStateAction<DraftJournalEntry[]>>;
  setSaveState: Dispatch<SetStateAction<SaveState>>;
}

/** 标签生命周期：打开/切换、超限淘汰、草稿恢复/丢弃（从 App.tsx 收拢）。 */
export function useTabLifecycle({
  settingsMaxOpenTabs, pinnedNoteIds, openTabsRef, persistTab, scheduleSave, resetRevision,
  showNotice, setError, setOpenTabs, setActiveNoteId, setPinnedNoteIds, setDraftEntries, setSaveState,
}: UseTabLifecycleOptions) {
  const evictTabsForLimit = useCallback(async (nextTabs: OpenTab[], openedId: string): Promise<string[]> => {
    const limit = settingsMaxOpenTabs;
    if (limit <= 0) return [];
    const evictedIds = selectEvictionIds(nextTabs, { limit, activeNoteId: openedId, pinnedNoteIds });
    for (const id of evictedIds) {
      const tab = openTabsRef.current.find((t) => t.noteId === id);
      if (tab?.dirty) await persistTab(id, tab.title, tab.content);
      // V5 Phase 4：淘汰路径同步清理滚动记忆（避免残留导致下次打开位置错乱）
      clearScrollMemory(id);
    }
    return evictedIds;
  }, [settingsMaxOpenTabs, pinnedNoteIds, persistTab, openTabsRef]);

  const openNote = useCallback(async (id: string, locateQuery = "", _newTab = false): Promise<boolean> => {
    const locate = () => {
      if (!locateQuery) return;
      let attempts = 0;
      const tryLocate = () => {
        if (locateEditorSearchHit(id, locateQuery) || attempts++ >= 8) return;
        window.setTimeout(tryLocate, 120);
      };
      window.setTimeout(tryLocate, 180);
    };
    const existing = openTabsRef.current.find((tab) => tab.noteId === id);
    if (existing) {
      // 标签曾被标记"已删除"（远端删除）：文档可能已从回收站恢复，重新拉取最新内容刷新标签。
      if (existing.deleted) {
        try {
          const t0 = performance.now();
          const note = await native.readNote(id);
          console.log("[sync-tab] openNote reload-deleted", JSON.stringify({ noteId: id, readMs: Math.round(performance.now() - t0) }));
          if (openTabsRef.current.some((t) => t.noteId === id)) {
            setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === id
              ? { ...tab, title: note.title, content: note.content, dirty: false, deleted: false, reloadKey: (tab.reloadKey ?? 0) + 1, lastDigest: { title: note.title, updatedAt: note.updatedAt } }
              : tab));
          }
        } catch { /* 尚未恢复，保持标记 */ }
      }
      setActiveNoteId(id);
      setOpenTabs((tabs) => tabs.map((tab) =>
        tab.noteId === id ? { ...tab, lastAccessedAt: Date.now() } : tab
      ));
      locate();
      return true;
    }
    try {
      const note = await native.readNote(id);
      if (openTabsRef.current.some((t) => t.noteId === id)) {
        setActiveNoteId(id);
        return true;
      }
      resetRevision(note.id, 0);
      const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now() };
      const nextForEvict = openTabsRef.current.some((t) => t.noteId === id)
        ? openTabsRef.current
        : [...openTabsRef.current, newTab];
      const evictedIds = await evictTabsForLimit(nextForEvict, id);
      setOpenTabs((tabs) => {
        const base = tabs.some((t) => t.noteId === id) ? tabs : [...tabs, newTab];
        // 更新器内再次封顶：并发打开时以最新已提交状态为准，杜绝旧 ref 竞态超限。
        return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: id, pinnedNoteIds });
      });
      if (evictedIds.length > 0) {
        setPinnedNoteIds((prev) => {
          const next = new Set(prev);
          for (const ev of evictedIds) next.delete(ev);
          return next.size === prev.size ? prev : next;
        });
        showNotice(`已自动关闭最旧的标签（上限 ${settingsMaxOpenTabs}）`);
      }
      setActiveNoteId(id);
      locate();
      return true;
    } catch (reason) {
      setError(getNativeErrorMessage(reason));
      return false;
    }
  }, [evictTabsForLimit, settingsMaxOpenTabs, pinnedNoteIds, showNotice, openTabsRef, setOpenTabs, setActiveNoteId, setPinnedNoteIds, resetRevision]);

  const restoreDraft = useCallback(async (entry: DraftJournalEntry) => {
    // 先确认正式文档仍存在。否则不能从恢复对话框中静默移除草稿，让用户误以为恢复成功。
    try { await native.readNote(entry.noteId); }
    catch {
      showNotice("草稿对应的文档已不存在；草稿仍保留，可手动丢弃。");
      return;
    }
    await openNote(entry.noteId);
    setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === entry.noteId ? { ...tab, title: entry.title || tab.title, content: entry.content, dirty: true, reloadKey: (tab.reloadKey ?? 0) + 1 } : tab));
    setActiveNoteId(entry.noteId);
    setDraftEntries((entries) => entries.filter((item) => item.noteId !== entry.noteId));
    setSaveState("dirty");
    scheduleSave(entry.noteId, entry.content);
  }, [openNote, scheduleSave, showNotice, setOpenTabs, setActiveNoteId, setDraftEntries, setSaveState]);

  const discardDraft = useCallback((noteId: string) => {
    void native.deleteDraftJournal(noteId).catch(() => undefined);
    setDraftEntries((entries) => entries.filter((entry) => entry.noteId !== noteId));
  }, [setDraftEntries]);

  return { evictTabsForLimit, openNote, restoreDraft, discardDraft };
}
