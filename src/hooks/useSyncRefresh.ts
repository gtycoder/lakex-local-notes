import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { reportNativeActionError } from "../lib/nativeErrors";
import { rlog } from "../lib/log";
import type { DraftJournalEntry, NoteSummary, SyncPendingSummary, TreeNode } from "../lib/types";
import type { OpenTab } from "../desktop/desktopTypes";
import type { NoteReloadGuard } from "../core/requestVersion";
import { isGoneNote } from "../core/syncDecisions";

export interface UseSyncRefreshOptions {
  setPendingSummary: Dispatch<SetStateAction<SyncPendingSummary>>;
  setDraftEntries: Dispatch<SetStateAction<DraftJournalEntry[]>>;
  setTreeNodes: Dispatch<SetStateAction<TreeNode[]>>;
  setNotes: Dispatch<SetStateAction<NoteSummary[]>>;
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>;
  noteReloadGuardRef: MutableRefObject<NoteReloadGuard>;
  openTabsRef: MutableRefObject<OpenTab[]>;
  bumpRevision: (noteId: string) => void;
}

/** 同步/回收站/历史恢复后的刷新与 tab 重载（从 App.tsx 收拢）。 */
export function useSyncRefresh({
  setPendingSummary, setDraftEntries, setTreeNodes, setNotes, setOpenTabs,
  noteReloadGuardRef, openTabsRef, bumpRevision,
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

  /** 回收站恢复后：刷新草稿/树/摘要；重载曾被标记"已删除"的 tab。
   * 审计 F04：回调必须带本次恢复的 id；每个 tab 的只读状态按**真实 gone 判定**（isGoneNote）重算——
   * 软删本来就保留正文，"能读"不等于"已恢复"；恢复 b 绝不能把仍在回收站的 a 一起解锁。 */
  const handleTrashRestored = useCallback((restoredId?: string) => {
    void refreshDraftEntries();
    void native.listTreeNodes().then(setTreeNodes).catch((error) => reportNativeActionError("刷新同步摘要", error));
    void native.listNoteSummaries().then(setNotes).catch((error) => reportNativeActionError("刷新同步摘要", error));
    void (async () => {
      const t0 = performance.now();
      // 目标 = 本次恢复的 id（若提供）+ 所有仍标记 deleted 的标签（逐个按真实状态复核）。
      for (const tab of openTabsRef.current.filter((t) => t.deleted || (restoredId !== undefined && t.noteId === restoredId))) {
        // 审计 F03：取消作用域按文档——不同 tab 的重载互不取消；同一 tab 的更新一次胜出。
        const token = noteReloadGuardRef.current.next(tab.noteId);
        try {
          const readT0 = performance.now();
          const note = await native.readNote(tab.noteId);
          if (!noteReloadGuardRef.current.isCurrent(token)) continue;
          const gone = isGoneNote(note);
          rlog.debug("sync-tab", "trash-restore reload", { noteId: tab.noteId, restoredId: restoredId ?? null, gone, readMs: Math.round(performance.now() - readT0) });
          setOpenTabs((tabs) => tabs.map((t) => t.noteId === tab.noteId
            ? { ...t, title: note.title, content: note.content, dirty: false, deleted: gone, reloadKey: (t.reloadKey ?? 0) + 1, lastDigest: { title: note.title, updatedAt: note.updatedAt } }
            : t));
        } catch { /* 该文档未恢复或仍不存在，保持标记 */ }
      }
      rlog.perf("sync-tab.trash-restore", performance.now() - t0);
    })();
  }, [refreshDraftEntries, setTreeNodes, setNotes, setOpenTabs, noteReloadGuardRef, openTabsRef]);

  /** 历史恢复后：刷新树/摘要；若该文档正开在 tab 里，重载正文 + bump reloadKey 强制重建 Lake 实例。 */
  const handleHistoryRestored = useCallback((restoredId: string) => {
    void native.listTreeNodes().then(setTreeNodes).catch((error) => reportNativeActionError("刷新同步摘要", error));
    void native.listNoteSummaries().then(setNotes).catch((error) => reportNativeActionError("刷新同步摘要", error));
    void (async () => {
      const token = noteReloadGuardRef.current.next(restoredId);
      try {
        const t0 = performance.now();
        const updated = await native.readNote(restoredId);
        if (!noteReloadGuardRef.current.isCurrent(token)) return;
        rlog.debug("sync-tab", "history-restore reload", { noteId: restoredId, readMs: Math.round(performance.now() - t0) });
        setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === restoredId
          ? { ...tab, title: updated.title, content: updated.content, dirty: false, reloadKey: (tab.reloadKey ?? 0) + 1 }
          : tab));
        bumpRevision(restoredId);
      } catch { /* 文档未打开或读取失败则跳过 */ }
    })();
  }, [setTreeNodes, setNotes, setOpenTabs, noteReloadGuardRef, bumpRevision]);

  /** 外部改动正文后重载某个 tab（bump reloadKey 强制重建 Lake 实例）。用于附件重命名等主进程写正文的场景。 */
  const reloadNoteTab = useCallback((noteId: string) => {
    void (async () => {
      const token = noteReloadGuardRef.current.next(noteId);
      try {
        const updated = await native.readNote(noteId);
        if (!noteReloadGuardRef.current.isCurrent(token)) return;
        setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === noteId
          ? { ...tab, title: updated.title, content: updated.content, dirty: false, reloadKey: (tab.reloadKey ?? 0) + 1 }
          : tab));
        bumpRevision(noteId);
      } catch { /* 文档未打开则跳过 */ }
    })();
  }, [setOpenTabs, noteReloadGuardRef, bumpRevision]);

  return { refreshPendingSummary, refreshDraftEntries, handleTrashRestored, handleHistoryRestored, reloadNoteTab };
}
