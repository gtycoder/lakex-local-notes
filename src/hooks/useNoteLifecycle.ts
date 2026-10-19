import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { reportNativeActionError } from "../lib/nativeErrors";
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
  scheduleDraftJournal: (noteId: string, content?: string) => void;
  scheduleSave: (noteId: string, content?: string) => void;
  evictTabsForLimit: (nextTabs: OpenTab[], openedId: string) => Promise<{ evictedIds: string[]; failedIds: string[] }>;
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
  const handleContentChange = useCallback((noteId: string, content?: string) => {
    // 审计 §6.1/§7.4：每键只涨 revision + 重置防抖；正文不在这里序列化，也不每键全量 setState。
    // sheet/board 显式给 content（它们内部已防抖）；doc 走捕获契约——保存/草稿/关闭时按需 capture。
    bumpRevision(noteId);
    const existing = openTabsRef.current.find((tab) => tab.noteId === noteId);
    if (content !== undefined) {
      setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === noteId ? { ...tab, content, dirty: true } : tab));
    } else if (!existing?.dirty) {
      // 只有 clean→dirty 的第一次才更新 tab（避免每键 setState 大数组）。
      setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === noteId ? { ...tab, dirty: true } : tab));
    }
    scheduleDraftJournal(noteId, content);
    scheduleSave(noteId, content);
  }, [bumpRevision, setOpenTabs, openTabsRef, scheduleDraftJournal, scheduleSave]);

  async function createNoteIn(parentId: string | null) {
    const note = parentId === null ? await native.createNote("无标题文档") : await native.createNoteIn(parentId, "无标题文档");
    setNotes((items) => [...items, summaryOf(note)]);
    setTreeNodes(await native.listTreeNodes());
    {
      resetRevision(note.id, 0);
      const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now(), kind: "doc" };
      const { evictedIds, failedIds } = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
      setOpenTabs((tabs) => {
        const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
        // 审计 F01：保存失败的标签受保护，不因封顶被顺手淘汰。
        return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: note.id, pinnedNoteIds, protectNoteIds: new Set(failedIds) });
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

  /** 新建表格文档（kind=usheet）：正文是 Univer IWorkbookData 快照 JSON；与文档同流程（进树、开 tab、可重命名）。 */
  async function createUsheetIn(parentId: string | null) {
    const note = await native.createUsheetIn(parentId, "无标题表格");
    setNotes((items) => [...items, summaryOf(note)]);
    setTreeNodes(await native.listTreeNodes());
    resetRevision(note.id, 0);
    const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now(), kind: "usheet" };
    const { evictedIds, failedIds } = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
    setOpenTabs((tabs) => {
      const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
      return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: note.id, pinnedNoteIds, protectNoteIds: new Set(failedIds) });
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
    const { evictedIds, failedIds } = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
    setOpenTabs((tabs) => {
      const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
      // 审计 F01：保存失败的标签受保护，不因封顶被顺手淘汰。
      return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: note.id, pinnedNoteIds, protectNoteIds: new Set(failedIds) });
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
    const { evictedIds, failedIds } = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
    setOpenTabs((tabs) => {
      const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
      // 审计 F01：保存失败的标签受保护，不因封顶被顺手淘汰。
      return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: note.id, pinnedNoteIds, protectNoteIds: new Set(failedIds) });
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

  /** 新建手写板文档（kind=ink）：正文是矢量墨迹 JSON；与文档同流程（进树、开 tab、可重命名）。 */
  async function createInkIn(parentId: string | null) {
    const note = await native.createInkIn(parentId, "无标题手写板");
    setNotes((items) => [...items, summaryOf(note)]);
    setTreeNodes(await native.listTreeNodes());
    resetRevision(note.id, 0);
    const newTab: OpenTab = { noteId: note.id, title: note.title, content: note.content, dirty: false, lastAccessedAt: Date.now(), kind: "ink" };
    const { evictedIds, failedIds } = await evictTabsForLimit([...openTabsRef.current, newTab], note.id);
    setOpenTabs((tabs) => {
      const base = tabs.some((t) => t.noteId === note.id) ? tabs : [...tabs, newTab];
      return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: note.id, pinnedNoteIds, protectNoteIds: new Set(failedIds) });
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
      await Promise.all([...removedNoteIds].map((noteId) => native.deleteDraftJournal(noteId).catch((error) => reportNativeActionError("删除关闭标签草稿", error))));
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

  return { handleContentChange, createNoteIn, createNote, createUsheetIn, createBitableIn, createBoardIn, createInkIn, deleteTreeNode };
}
