import { useCallback, useEffect } from "react";
import { writeLocalStorage } from "../lib/localStorageSafe";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { native } from "../lib/native";
import { reportNativeActionError } from "../lib/nativeErrors";
import { applyTheme } from "../lib/theme";
import { subscribeSettings, type AppSettings, type ThemeMode } from "../lib/settings";
import { OUTLINE_SIDEBAR_MAX_WIDTH, OUTLINE_SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, type OpenTab } from "../desktop/desktopTypes";
import type { PersistOutcome } from "./useSavePipeline";

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
  /** ⌘1/2/3 切空间（S1+A）；不传则不注册 */
  onSwitchDesktopWorkspace?: (workspace: "library" | "quick-notes" | "trash") => void;
}

/** 桌面全局/窗口生命周期：同步锚点、活动历史计数、草稿落盘、设置订阅、钉住清理、主题、快捷键、beforeunload。 */
export function useDesktopLifecycle({
  syncToast, syncBtnRef, setSyncAnchorRect, activeNoteId, conflictSnapshotCount, historyOpen,
  setActiveHistoryCount, openTabs, setPinnedNoteIds, theme, setSettings,
  setSearchPanelQuery, setSearchPanelOpen, flushTimers, openTabsRef, draftTimers, saveTimers,
  layoutWidthsRef, quickNotesDirty, persistTab, onSwitchDesktopWorkspace,
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
      writeLocalStorage("lake-notes-v3.sidebar-width", String(Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, widths.sidebar)))));
      writeLocalStorage("lake-notes-v3.outline-sidebar-width", String(Math.round(Math.min(OUTLINE_SIDEBAR_MAX_WIDTH, Math.max(OUTLINE_SIDEBAR_MIN_WIDTH, widths.outline)))));
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
      const map: Record<string, "library" | "quick-notes" | "trash"> = {
        "1": "library",
        "2": "quick-notes",
        "3": "trash",
      };
      const next = map[event.key];
      if (!next) return;
      event.preventDefault();
      onSwitchDesktopWorkspace(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setSearchPanelQuery, setSearchPanelOpen, onSwitchDesktopWorkspace]);

  useEffect(() => {
    // 审计 #23：窗口/应用关闭时若有未保存草稿，阻止关闭并提示（Electron 显示原生对话框）；
    // 同时立即触发一次保存，尽量在用户留下期间落盘
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const hasDirty = openTabsRef.current.some((tab) => tab.dirty) || quickNotesDirty;
      if (!hasDirty) return;
      for (const tab of openTabsRef.current) {
        if (!tab.dirty) continue;
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
        void persistTab(tab.noteId);
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [persistTab, quickNotesDirty, openTabsRef, saveTimers, draftTimers]);

  return { handleTogglePin };
}
