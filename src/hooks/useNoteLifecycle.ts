import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { clearScrollMemory } from "../features/editor/EditorTab";
import { trimTabsToLimit } from "../core/tabLimit";
import { subtreeIds } from "../core/tree";
import { summaryOf } from "../desktop/desktopTypes";
import type { DraftJournalEntry, NoteSummary, TreeNode } from "../lib/types";
import type { OpenTab } from "../desktop/desktopTypes";

export interface UseNoteLifecycleOptions {
  bumpRevision: (noteId: string) => void;
  resetRevision: (noteId: string, revision?: number) => void;
  clearNote: (noteId: string) => void;
  scheduleDraftJournal: (noteId: string, title: string, content: string) => void;
  scheduleSave: (noteId: string, content: string) => void;
  evictTabsForLimit: (nextTabs: OpenTab[], openedId: string) => Promise<string[]>;
  showNotice: (text: string) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  treeNodes: TreeNode[];
  notes: NoteSummary[];
  openTabsRef: MutableRefObject<OpenTab[]>;
  settingsMaxOpenTabs: number;
  pinnedNoteIds: Set<string>;
  activeNoteId: string | null;
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>;
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>;
  setActiveNoteId: Dispatch<SetStateAction<string | null>>;
  setPinnedNoteIds: Dispatch<SetStateAction<Set<string>>>;
  setPendingRenameId: Dispatch<SetStateAction<string | null>>;
  setDraftEntries: Dispatch<SetStateAction<DraftJournalEntry[]>>;
}

/** 笔记生命周期：内容变更、新建、删除（从 App.tsx 收拢）。 */
export function useNoteLifecycle({
  bumpRevision, resetRevision, clearNote, scheduleDraftJournal, scheduleSave,
  evictTabsForLimit, showNotice, setError, treeNodes, notes, openTabsRef,
  settingsMaxOpenTabs, pinnedNoteIds, activeNoteId,
  setNotes, setTreeNodes, setOpenTabs, setActiveNoteId, setPinnedNoteIds, setPendingRenameId, setDraftEntries,
}: UseNoteLifecycleOptions) {
  const handleContentChange = useCallback((noteId: string, content: string) => {
    bumpRevision(noteId);
    setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === noteId ? { ...tab, content, dirty: true } : tab));
    const title = openTabsRef.current.find((tab) => tab.noteId === noteId)?.title ?? "无标题";
    scheduleDraftJournal(noteId, title, content);
    scheduleSave(noteId, content);
  }, [bumpRevision, setOpenTabs, openTabsRef, scheduleDraftJournal, scheduleSave]);

  async function createNoteIn(parentId: string | null) {
    const note = parentId === null ? await native.createNote("无标题文档") : await native.createNoteIn(parentId, "无标题文档");
    setNotes((items) => [...items, summaryOf(note)]);
    setTreeNodes(await native.listTreeNodes());
    {
      resetRevision(note.id, 0);
      const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now(), kind: "doc" };
      const evictedIds = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
      setOpenTabs((tabs) => {
        const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
        return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: note.id, pinnedNoteIds });
      });
      if (evictedIds.length > 0) {
        setPinnedNoteIds((prev) => {
          const next = new Set(prev);
          for (const ev of evictedIds) next.delete(ev);
          return next.size === prev.size ? prev : next;
        });
        showNotice(`已自动关闭最旧的标签（上限 ${settingsMaxOpenTabs}）`);
      }
      setActiveNoteId(note.id);
      setPendingRenameId(note.id);
    }
  }

  async function createNote() {
    const notebookId = treeNodes.find((node) => node.nodeType === "notebook")?.id ?? null;
    await createNoteIn(notebookId);
  }

  /** 新建表格文档（kind=sheet）：与文档同流程（进树、开 tab、可重命名），只是正文是 CE 快照 JSON。 */
  async function createSheetIn(parentId: string | null) {
    const note = await native.createSheetIn(parentId, "无标题表格");
    setNotes((items) => [...items, summaryOf(note)]);
    setTreeNodes(await native.listTreeNodes());
    resetRevision(note.id, 0);
    const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now(), kind: "sheet" };
    const evictedIds = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
    setOpenTabs((tabs) => {
      const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
      return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: note.id, pinnedNoteIds });
    });
    if (evictedIds.length > 0) {
      setPinnedNoteIds((prev) => {
        const next = new Set(prev);
        for (const ev of evictedIds) next.delete(ev);
        return next.size === prev.size ? prev : next;
      });
      showNotice(`已自动关闭最旧的标签（上限 ${settingsMaxOpenTabs}）`);
    }
    setActiveNoteId(note.id);
    setPendingRenameId(note.id);
  }

  /** 新建多维表文档（kind=bitable）：正文是自研 record-based JSON；与文档同流程（进树、开 tab、可重命名）。 */
  async function createBitableIn(parentId: string | null) {
    const note = await native.createBitableIn(parentId, "无标题数据表");
    setNotes((items) => [...items, summaryOf(note)]);
    setTreeNodes(await native.listTreeNodes());
    resetRevision(note.id, 0);
    const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now(), kind: "bitable" };
    const evictedIds = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
    setOpenTabs((tabs) => {
      const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
      return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: note.id, pinnedNoteIds });
    });
    if (evictedIds.length > 0) {
      setPinnedNoteIds((prev) => {
        const next = new Set(prev);
        for (const ev of evictedIds) next.delete(ev);
        return next.size === prev.size ? prev : next;
      });
      showNotice("已自动关闭最旧的标签（上限 " + settingsMaxOpenTabs + "）");
    }
    setActiveNoteId(note.id);
    setPendingRenameId(note.id);
  }

  /** 新建画板文档（kind=board）：正文是 Drawnix/Plait 场景 JSON；与文档同流程（进树、开 tab、可重命名）。 */
  async function createBoardIn(parentId: string | null) {
    const note = await native.createBoardIn(parentId, "无标题画板");
    setNotes((items) => [...items, summaryOf(note)]);
    setTreeNodes(await native.listTreeNodes());
    resetRevision(note.id, 0);
    const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now(), kind: "board" };
    const evictedIds = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
    setOpenTabs((tabs) => {
      const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
      return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: note.id, pinnedNoteIds });
    });
    if (evictedIds.length > 0) {
      setPinnedNoteIds((prev) => {
        const next = new Set(prev);
        for (const ev of evictedIds) next.delete(ev);
        return next.size === prev.size ? prev : next;
      });
      showNotice("已自动关闭最旧的标签（上限 " + settingsMaxOpenTabs + "）");
    }
    setActiveNoteId(note.id);
    setPendingRenameId(note.id);
  }

  async function deleteTreeNode(id: string) {
    try {
      const removedNodeIds = subtreeIds(treeNodes, id);
      const removedNoteIds = new Set(
        treeNodes.filter((node) => removedNodeIds.has(node.id) && node.noteFileId).map((node) => node.noteFileId!)
      );
      removedNoteIds.forEach((noteId) => {
        clearNote(noteId);
        clearScrollMemory(noteId);
      });
      await native.deleteTreeNode(id);
      await Promise.all([...removedNoteIds].map((noteId) => native.deleteDraftJournal(noteId).catch(() => undefined)));
      setDraftEntries((entries) => entries.filter((entry) => !removedNoteIds.has(entry.noteId)));
      const remaining = notes.filter((note) => !removedNoteIds.has(note.id));
      setNotes(remaining);
      setTreeNodes(await native.listTreeNodes());
      const next = openTabsRef.current.filter((tab) => !removedNoteIds.has(tab.noteId));
      setOpenTabs(next);
      if (activeNoteId && removedNoteIds.has(activeNoteId)) {
        setActiveNoteId(next[next.length - 1]?.noteId ?? null);
      }
    } catch (reason) { setError(getNativeErrorMessage(reason)); }
  }

  return { handleContentChange, createNoteIn, createNote, createSheetIn, createBitableIn, createBoardIn, deleteTreeNode };
}
