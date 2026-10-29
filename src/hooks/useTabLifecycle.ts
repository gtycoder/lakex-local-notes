import { isGoneNote } from "../core/syncDecisions";
import { flushDirtyBeforeLifecycle } from "../core/lifecycleFlush";
import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorMessage } from "../lib/nativeErrors";
import { rlog } from "../lib/log";
import { reportNativeActionError } from "../lib/nativeErrors";
import { clearScrollMemory, locateEditorSearchHit } from "../features/editor/editorViewport";
import { selectEvictionIds, trimTabsToLimit } from "../core/tabLimit";
import { runPoolSettled } from "../core/s3v3Pool";
import type { DraftJournalEntry, NoteDocument } from "../lib/types";
import type { OpenTab } from "../desktop/desktopTypes";
import type { PersistOutcome, SaveState } from "./useSavePipeline";

/** 「正文缺失」提示每篇文档每个会话只弹一次（用户 261023：缺数据不要每次都提示）。 */
const bodyMissingNotified = new Set<string>();

/** 标签会话恢复时的正文读取并发（DT-15）：有界并发，别为 N 个标签拉满 IPC/读盘。 */
export const TAB_RESTORE_READ_CONCURRENCY = 4;

export interface UseTabLifecycleOptions {
  settingsMaxOpenTabs: number;
  pinnedNoteIds: Set<string>;
  openTabsRef: MutableRefObject<OpenTab[]>;
  persistTab: (noteId: string, title?: string, content?: string) => Promise<PersistOutcome>;
  scheduleSave: (noteId: string, content: string) => void;
  resetRevision: (noteId: string, revision?: number) => void;
  showNotice: (text: string) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setOpenTabs: Dispatch<SetStateAction<OpenTab[]>>;
  setActiveNoteId: Dispatch<SetStateAction<string | null>>;
  setPinnedNoteIds: Dispatch<SetStateAction<Set<string>>>;
  setDraftEntries: Dispatch<SetStateAction<DraftJournalEntry[]>>;
  /** 写某文档的保存状态（按文档，不再是全局单值）。 */
  setSaveState: (noteId: string, state: SaveState) => void;
}

/** 标签生命周期：打开/切换、超限淘汰、草稿恢复/丢弃（从 App.tsx 收拢）。 */
export function useTabLifecycle({
  settingsMaxOpenTabs, pinnedNoteIds, openTabsRef, persistTab, scheduleSave, resetRevision,
  showNotice, setError, setOpenTabs, setActiveNoteId, setPinnedNoteIds, setDraftEntries, setSaveState,
}: UseTabLifecycleOptions) {
  /** 返回本次真正淘汰的 id 与因保存失败而必须保留的 id（审计 F01：未确认持久化不得淘汰）。 */
  const evictTabsForLimit = useCallback(async (nextTabs: OpenTab[], openedId: string): Promise<{ evictedIds: string[]; failedIds: string[] }> => {
    const limit = settingsMaxOpenTabs;
    if (limit <= 0) return { evictedIds: [], failedIds: [] };
    const candidates = selectEvictionIds(nextTabs, { limit, activeNoteId: openedId, pinnedNoteIds });
    const evictedIds: string[] = [];
    const failedIds: string[] = [];
    for (const id of candidates) {
      const tab = openTabsRef.current.find((t) => t.noteId === id);
      if (tab) {
        // 审计 F01：未确认持久化的标签不得淘汰（失败留在原处）。
        const { proceed } = await flushDirtyBeforeLifecycle(tab, () => persistTab(id));
        if (!proceed) { failedIds.push(id); continue; }
      }
      evictedIds.push(id);
      // V5 Phase 4：淘汰路径同步清理滚动记忆（避免残留导致下次打开位置错乱）
      clearScrollMemory(id);
    }
    return { evictedIds, failedIds };
  }, [settingsMaxOpenTabs, pinnedNoteIds, persistTab, openTabsRef]);

  /** note → OpenTab（含"打开即只读"判定与缺正文一次性提示）：openNote 与 restoreTabs 共用，避免两套构造逻辑漂移。 */
  const openTabFromNote = useCallback((note: NoteDocument, lastAccessedAt: number): OpenTab => {
    resetRevision(note.id, 0);
    // 打开即判定：回收站里 / 已被他端 purge 的文档直接以"已删除"标签打开（只读 + 不保存），
    // 不等下一次同步才标记——否则重启自动重开"最后文档"时会看到能编辑的已删文档。
    const bodyMissing = note.bodyMissing === true;
    if (bodyMissing && !bodyMissingNotified.has(note.id)) {
      bodyMissingNotified.add(note.id);
      // 一次性提示（不挡操作）：详细处置在标签内的专用面板里。
      showNotice(`《${note.title || "无标题"}》的正文文件已丢失（可能被手动删除）：已按只读打开，可恢复历史或删除该文档。`);
    }
    return {
      noteId: note.id,
      title: note.title,
      content: note.content,
      dirty: false,
      lastAccessedAt,
      deleted: isGoneNote(note),
      bodyMissing,
      kind: note.kind ?? "doc",
    };
  }, [resetRevision, showNotice]);

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
      // 曾被标记"已删除"的标签：重新读一次落库状态再决定——可能已从回收站恢复（清标记），
      // 也可能仍在回收站（必须保持标记；旧实现无条件 deleted:false 会把守卫解开）。
      if (existing.deleted) {
        try {
          const t0 = performance.now();
          const note = await native.readNote(id);
          rlog.debug("sync-tab", "openNote reload-deleted", { noteId: id, readMs: Math.round(performance.now() - t0) });
          const gone = isGoneNote(note);
          if (openTabsRef.current.some((t) => t.noteId === id)) {
            setOpenTabs((tabs) => tabs.map((tab) => tab.noteId === id
              ? { ...tab, title: note.title, content: note.content, dirty: false, deleted: gone, bodyMissing: note.bodyMissing === true, reloadKey: (tab.reloadKey ?? 0) + 1, lastDigest: { title: note.title, updatedAt: note.updatedAt } }
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
      const newTab: OpenTab = openTabFromNote(note, Date.now());
      const nextForEvict = openTabsRef.current.some((t) => t.noteId === id)
        ? openTabsRef.current
        : [...openTabsRef.current, newTab];
      const { evictedIds, failedIds } = await evictTabsForLimit(nextForEvict, id);
      setOpenTabs((tabs) => {
        const base = tabs.some((t) => t.noteId === id) ? tabs : [...tabs, newTab];
        // 更新器内再次封顶：并发打开时以最新已提交状态为准，杜绝旧 ref 竞态超限。
        // 保存失败的标签受保护，不因封顶被顺手淘汰。
        return trimTabsToLimit(base, { limit: settingsMaxOpenTabs, activeNoteId: id, pinnedNoteIds, protectNoteIds: new Set(failedIds) });
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
  }, [evictTabsForLimit, settingsMaxOpenTabs, pinnedNoteIds, showNotice, openTabsRef, setOpenTabs, setActiveNoteId, setPinnedNoteIds, openTabFromNote]);

  /**
   * DT-15：启动时批量恢复上次标签会话。
   * - 有界并发读正文（TAB_RESTORE_READ_CONCURRENCY），不再 N 次串行 `await openNote()`；
   * - **一次** setOpenTabs 提交（不再逐篇提交 + 途中淘汰）；
   * - 会话顺序 / 活动标签 / 淘汰语义不变：调用方已按 maxOpenTabs 截断（这里再防御性截一次），
   *   lastAccessedAt 按位置递增（越靠后越新），仍由 trimTabsToLimit 兜底封顶。
   * 返回真正恢复的标签数（全部失败 = 0，调用方据此回落冷启动落点）。
   */
  const restoreTabs = useCallback(async (ids: readonly string[], activeId: string | null): Promise<number> => {
    const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)));
    // 会话按打开顺序存（末尾最新）⇒ 超限时保留最近 N 个，与"自动淘汰最旧"同向。
    const planned = settingsMaxOpenTabs > 0 ? unique.slice(-settingsMaxOpenTabs) : unique;
    if (planned.length === 0) return 0;
    const startedAt = Date.now();
    const { results, errors } = await runPoolSettled(planned, TAB_RESTORE_READ_CONCURRENCY, async (id, index) => {
      const note = await native.readNote(id);
      return openTabFromNote(note, startedAt - (planned.length - 1) + index);
    });
    const tabs = results.filter((tab): tab is OpenTab => tab !== undefined);
    if (errors.length > 0) setError(getNativeErrorMessage(errors[0].error));
    if (tabs.length === 0) return 0;
    const resolvedActiveId = activeId && tabs.some((tab) => tab.noteId === activeId)
      ? activeId
      : tabs[tabs.length - 1].noteId;
    setOpenTabs((current) => {
      if (current.length === 0) return tabs;
      // 启动时通常为空；万一已有并发打开的标签，按 id 去重后仍强制封顶（不丢已打开标签）。
      const restoredIds = new Set(tabs.map((tab) => tab.noteId));
      const merged = [...current.filter((tab) => !restoredIds.has(tab.noteId)), ...tabs];
      return trimTabsToLimit(merged, { limit: settingsMaxOpenTabs, activeNoteId: resolvedActiveId, pinnedNoteIds });
    });
    setActiveNoteId(resolvedActiveId);
    return tabs.length;
  }, [settingsMaxOpenTabs, pinnedNoteIds, openTabFromNote, setOpenTabs, setActiveNoteId, setError]);

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
    setSaveState(entry.noteId, "dirty");
    scheduleSave(entry.noteId, entry.content);
  }, [openNote, scheduleSave, showNotice, setOpenTabs, setActiveNoteId, setDraftEntries, setSaveState]);

  const discardDraft = useCallback((noteId: string) => {
    void native.deleteDraftJournal(noteId).catch((error) => reportNativeActionError("删除草稿", error));
    setDraftEntries((entries) => entries.filter((entry) => entry.noteId !== noteId));
  }, [setDraftEntries]);

  return { evictTabsForLimit, openNote, restoreTabs, restoreDraft, discardDraft };
}
