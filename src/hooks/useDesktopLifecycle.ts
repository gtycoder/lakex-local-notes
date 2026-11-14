import { useCallback, useEffect } from "react";
import { writeLocalStorage } from "../lib/localStorageSafe";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { reportNativeActionError } from "../lib/nativeErrors";
import { applyTheme } from "../lib/theme";
import { subscribeSettings, type AppSettings, type ThemeMode } from "../lib/settings";
import { OUTLINE_SIDEBAR_MAX_WIDTH, OUTLINE_SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, type OpenTab } from "../desktop/desktopTypes";
import { getHiddenSpaces } from "../lib/hiddenSpacesStore";
import { DESKTOP_HIDEABLE_SPACES, DESKTOP_HIDDEN_SPACES_KEY, isDesktopHideableSpace } from "../desktop/spaceVisibility";
import type { PersistOutcome } from "./useSavePipeline";
import { blockingDirtyTabs } from "../core/unloadGuard";

export interface UseDesktopLifecycleOptions {
  syncToast: unknown;
  syncBtnRef: MutableRefObject<HTMLButtonElement | null>;
  setSyncAnchorRect: Dispatch<SetStateAction<DOMRect | null>>;
  activeNoteId: string | null;
  conflictSnapshotCount: number;
  historyOpen: boolean;
  setActiveHistoryCount: Dispatch<SetStateAction<number>>;
  openTabs: OpenTab[];
  setPinnedNoteIds: Dispatch<SetStateAction<Set<string>>>;
  theme: ThemeMode;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setSearchPanelQuery: Dispatch<SetStateAction<string>>;
  setSearchPanelOpen: Dispatch<SetStateAction<boolean>>;
  flushTimers: () => void;
  openTabsRef: MutableRefObject<OpenTab[]>;
  draftTimers: MutableRefObject<Map<string, number>>;
  saveTimers: MutableRefObject<Map<string, number>>;
  layoutWidthsRef: MutableRefObject<{ sidebar: number; outline: number }>;
  quickNotesDirty: boolean;
  persistTab: (noteId: string, title?: string, content?: string) => Promise<PersistOutcome>;
  /** 该文档最近一次保存是否已被拒绝（saveStates = "error"）。为 true 时内容已经明确存不进去，
   *  退出闸允许丢弃（261114 用户裁决：保存被拒时也要能正常退出）。 */
  isSaveFailed?: (noteId: string) => boolean;
  /** ⌘1–4 切空间（S1+A；261109 收敛为一张表）；不传则不注册 */
  onSwitchDesktopWorkspace?: (workspace: "library" | "quick-notes" | "diary" | "ai-writing" | "tags") => void;
}

/** 桌面全局/窗口生命周期：同步锚点、活动历史计数、草稿落盘、设置订阅、钉住清理、主题、快捷键、beforeunload。 */
export function useDesktopLifecycle({
  syncToast, syncBtnRef, setSyncAnchorRect, activeNoteId, conflictSnapshotCount, historyOpen,
  setActiveHistoryCount, openTabs, setPinnedNoteIds, theme, setSettings,
  setSearchPanelQuery, setSearchPanelOpen, flushTimers, openTabsRef, draftTimers, saveTimers,
  layoutWidthsRef, quickNotesDirty, persistTab, isSaveFailed, onSwitchDesktopWorkspace,
}: UseDesktopLifecycleOptions) {
  useEffect(() => {
    if (!syncToast) { setSyncAnchorRect(null); return; }
    setSyncAnchorRect(syncBtnRef.current?.getBoundingClientRect() ?? null);
  }, [syncToast, syncBtnRef, setSyncAnchorRect]);

  useEffect(() => {
    if (!activeNoteId) { setActiveHistoryCount(0); return; }
    let alive = true;
    void native.listNoteHistory(activeNoteId)
      .then((items) => { if (alive) setActiveHistoryCount(items.length); })
      .catch((error) => { reportNativeActionError("读取历史数量", error); if (alive) setActiveHistoryCount(0); });
    return () => { alive = false; };
  }, [activeNoteId, conflictSnapshotCount, historyOpen, setActiveHistoryCount]);

  useEffect(() => {
    return () => {
      flushTimers();
      for (const tab of openTabsRef.current) {
        if (!tab.dirty) continue;
        void native.saveDraftJournal({ noteId: tab.noteId, title: tab.title, content: tab.content, updatedAt: new Date().toISOString() }).catch((error) => reportNativeActionError("保存退出草稿", error));
      }
      draftTimers.current.forEach((timer) => window.clearTimeout(timer));
      draftTimers.current.clear();
      // 拖动过程只更新视觉状态；卸载时补一次合法的最终布局提交。
      const widths = layoutWidthsRef.current;
      writeLocalStorage("lakex-local-notes-v3.sidebar-width", String(Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, widths.sidebar)))));
      writeLocalStorage("lakex-local-notes-v3.outline-sidebar-width", String(Math.round(Math.min(OUTLINE_SIDEBAR_MAX_WIDTH, Math.max(OUTLINE_SIDEBAR_MIN_WIDTH, widths.outline)))));
    };
  }, [flushTimers, openTabsRef, draftTimers, layoutWidthsRef]);

  useEffect(() => {
    return subscribeSettings((next) => setSettings(next));
  }, [setSettings]);

  // 钉住状态由 App 持有：自动淘汰/关闭后可感知并清理残留，淘汰逻辑能保护钉住标签。
  useEffect(() => {
    const activeIds = new Set(openTabs.map((t) => t.noteId));
    setPinnedNoteIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (activeIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [openTabs, setPinnedNoteIds]);

  const handleTogglePin = useCallback((noteId: string) => {
    setPinnedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, [setPinnedNoteIds]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchPanelQuery("");
        setSearchPanelOpen(true);
        return;
      }
      if (!onSwitchDesktopWorkspace) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      // 用户 261006：只有上半「空间」有快捷键；回收站/资源/偏好设置都不给。
      // 261114 用户点单：⌘1 知识库 / ⌘2 小记 / ⌘3 标签 / ⌘4 AI 写作 / ⌘5 日记
      // （可关闭的 AI/日记 放最后，关掉后 1–3 连续；**单一来源**，别在别处再注册 keydown）。
      const map: Record<string, "library" | "quick-notes" | "tags" | "ai-writing" | "diary"> = {
        "1": "library",
        "2": "quick-notes",
        "3": "tags",
        "4": "ai-writing",
        "5": "diary",
      };
      const next = map[event.key];
      if (!next) return;
      // 261114：已关闭的空间不响应快捷键（提示也不在菜单里显示）。
      if (isDesktopHideableSpace(next) && getHiddenSpaces(DESKTOP_HIDDEN_SPACES_KEY, DESKTOP_HIDEABLE_SPACES).includes(next)) return;
      event.preventDefault();
      onSwitchDesktopWorkspace(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setSearchPanelQuery, setSearchPanelOpen, onSwitchDesktopWorkspace]);

  useEffect(() => {
    // 审计 #23：窗口/应用关闭时若有**还能保存**的未落盘内容，阻止关闭并尽量落盘；
    // 261114 用户裁决：回收站/已 purge、以及「保存已被拒绝（error）」的标签允许丢弃内容、**不得卡退出**
    // （否则一个永远存不进去的标签会把 ⌘Q/关窗/关机永久拦住）。判据单一来源 = core/unloadGuard。
    const isFailed = isSaveFailed ?? (() => false);
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const dirtyTabs = openTabsRef.current.filter((tab) => tab.dirty);
      const blocking = blockingDirtyTabs(dirtyTabs, isFailed);
      const hasDirty = blocking.length > 0 || quickNotesDirty;
      if (dirtyTabs.length === 0 && !hasDirty) return;
      for (const tab of dirtyTabs) {
        // 草稿兜底：三类脏标签都写（保存失败/已删除也不例外，下次打开还能看到本机草稿）。
        const pendingTimer = saveTimers.current.get(tab.noteId);
        if (pendingTimer !== undefined) {
          window.clearTimeout(pendingTimer);
          saveTimers.current.delete(tab.noteId);
        }
        const draftTimer = draftTimers.current.get(tab.noteId);
        if (draftTimer !== undefined) {
          window.clearTimeout(draftTimer);
          draftTimers.current.delete(tab.noteId);
        }
        void native.saveDraftJournal({ noteId: tab.noteId, title: tab.title, content: tab.content, updatedAt: new Date().toISOString() }).catch((error) => reportNativeActionError("保存退出草稿", error));
      }
      // 只有「还能保存」的脏标签才触发保存并阻止退出；其余允许丢弃。
      for (const tab of blocking) void persistTab(tab.noteId);
      if (!hasDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [persistTab, quickNotesDirty, openTabsRef, saveTimers, draftTimers, isSaveFailed]);

  return { handleTogglePin };
}
