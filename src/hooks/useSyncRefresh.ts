import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { reportNativeActionError } from "../lib/nativeErrors";
import type { DraftJournalEntry, NoteSummary, SyncPendingSummary, TreeNode } from "../lib/types";
import type { OpenTab } from "../desktop/desktopTypes";
import type { RequestVersion } from "../core/requestVersion";

export interface UseSyncRefreshOptions {
  setPendingSummary: Dispatch<SetStateAction<SyncPendingSummary>>;
  setDraftEntries: Dispatch<SetStateAction<DraftJournalEntry[]>>;
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>;
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>;
  tabReloadVersionRef: MutableRefObject<RequestVersion>;
  openTabsRef: MutableRefObject<OpenTab[]>;
  bumpRevision: (noteId: string) => void;
}

/** 同步/回收站/历史恢复后的刷新与 tab 重载（从 App.tsx 收拢）。 */
export function useSyncRefresh({
  setPendingSummary, setDraftEntries, setTreeNodes, setNotes, setOpenTabs,
  tabReloadVersionRef, openTabsRef, bumpRevision,
}: UseSyncRefreshOptions) {
  const refreshPendingSummary = useCallback(() => {
    void native.getSyncPendingSummary().then(setPendingSummary).catch((error) => reportNativeActionError("刷新同步摘要", error));
  }, [setPendingSummary]);
  useEffect(() => {
    refreshPendingSummary();
    return native.onPendingSummaryChanged(setPendingSummary);
  }, [refreshPendingSummary, setPendingSummary]);

  // 其它窗口 / 浏览器端写入后：重读目录树 + 摘要（此前没有 library-changed，目录不刷新，用户 260924 报）。
  useEffect(() => {
    return native.onLibraryChanged(() => {
      void native.listTreeNodes().then(setTreeNodes).catch((error) => reportNativeActionError("刷新同步摘要", error));
      void native.listNoteSummaries().then(setNotes).catch((error) => reportNativeActionError("刷新同步摘要", error));
    });
  }, [setTreeNodes, setNotes]);

  const refreshDraftEntries = useCallback(async () => {
    try {
      // 审计 F09：孤儿草稿（对应文档不存在）是最后的恢复出口，不能自动删。
      // 保留在列表里；恢复入口对 missing 文档会提示「草稿仍保留，可手动丢弃」，显式丢弃才删。
      const entries = await native.listDraftJournals();
      setDraftEntries(entries);
    } catch (error) {
      // 草稿恢复是 best-effort，不能阻塞回收站/主界面的正常操作。
      reportNativeActionError("刷新草稿", error);
    }
  }, [setDraftEntries]);

  /** 回收站恢复后：刷新草稿/树/摘要；若恢复的文档正开在 tab 里且曾被标记"已删除"，重载正文并清除标记。 */
  const handleTrashRestored = useCallback(() => {
    void refreshDraftEntries();
    void native.listTreeNodes().then(setTreeNodes).catch((error) => reportNativeActionError("刷新同步摘要", error));
    void native.listNoteSummaries().then(setNotes).catch((error) => reportNativeActionError("刷新同步摘要", error));
    void (async () => {
      const reloadVersion = tabReloadVersionRef.current.next();
      const t0 = performance.now();
      for (const tab of openTabsRef.current.filter((t) => t.deleted)) {
        if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
        try {
          const readT0 = performance.now();
          const note = await native.readNote(tab.noteId);
          if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
          console.log("[sync-tab] trash-restore reload", JSON.stringify({ noteId: tab.noteId, readMs: Math.round(performance.now() - readT0) }));
          setOpenTabs((tabs) => tabs.map((t) => t.noteId === tab.noteId
            ? { ...t, title: note.title, content: note.content, dirty: false, deleted: false, reloadKey: (t.reloadKey ?? 0) + 1, lastDigest: { title: note.title, updatedAt: note.updatedAt } }
            : t));
        } catch { /* 该文档未恢复或仍不存在，保持标记 */ }
      }
      console.log("[sync-tab] trash-restore done", JSON.stringify({ totalMs: Math.round(performance.now() - t0) }));
    })();
  }, [refreshDraftEntries, setTreeNodes, setNotes, setOpenTabs, tabReloadVersionRef, openTabsRef]);

  /** 历史恢复后：刷新树/摘要；若该文档正开在 tab 里，重载正文 + bump reloadKey 强制重建 Lake 实例。 */
  const handleHistoryRestored = useCallback((restoredId: string) => {
    void native.listTreeNodes().then(setTreeNodes).catch((error) => reportNativeActionError("刷新同步摘要", error));
    void native.listNoteSummaries().then(setNotes).catch((error) => reportNativeActionError("刷新同步摘要", error));
    void (async () => {
      const reloadVersion = tabReloadVersionRef.current.next();
      try {
        const t0 = performance.now();
        const updated = await native.readNote(restoredId);
        if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
        console.log("[sync-tab] history-restore reload", JSON.stringify({ noteId: restoredId, readMs: Math.round(performance.now() - t0) }));
        setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === restoredId
          ? { ...tab, title: updated.title, content: updated.content, dirty: false, reloadKey: (tab.reloadKey ?? 0) + 1 }
          : tab));
        bumpRevision(restoredId);
      } catch { /* 文档未打开或读取失败则跳过 */ }
    })();
  }, [setTreeNodes, setNotes, setOpenTabs, tabReloadVersionRef, bumpRevision]);

  /** 外部改动正文后重载某个 tab（bump reloadKey 强制重建 Lake 实例）。用于附件重命名等主进程写正文的场景。 */
  const reloadNoteTab = useCallback((noteId: string) => {
    void (async () => {
      const reloadVersion = tabReloadVersionRef.current.next();
      try {
        const updated = await native.readNote(noteId);
        if (!tabReloadVersionRef.current.isCurrent(reloadVersion)) return;
        setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === noteId
          ? { ...tab, title: updated.title, content: updated.content, dirty: false, reloadKey: (tab.reloadKey ?? 0) + 1 }
          : tab));
        bumpRevision(noteId);
      } catch { /* 文档未打开则跳过 */ }
    })();
  }, [setOpenTabs, tabReloadVersionRef, bumpRevision]);

  return { refreshPendingSummary, refreshDraftEntries, handleTrashRestored, handleHistoryRestored, reloadNoteTab };
}
