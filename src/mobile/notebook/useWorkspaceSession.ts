import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { bridge } from "../bridge";
import { useAutoSave } from "../hooks/useAutoSave";
import { reportMobileActionError } from "../lib/reportMobileActionError";
import { successFeedback } from "../ui/haptics";
import type { NotebookTab } from "./useNotebookTabs";
import { toastActionError } from "../lib/actionError";

/**
 * 工作区「会话与保存屏障」逻辑（261103 P10-①，原 NotebookWorkspace 内联代码逐字搬移，未改行为）：
 * 自动保存（useAutoSave）/ capture-and-save / 返回首页·切换笔记本·关闭标签的统一保存屏障 /
 * Android 返回键注册 / 进后台落盘 / 编辑完成（toggleEdit）/ pane 的正文与实例 capture 接线。
 * 输入为显式 refs 与回调（refs 由父层创建，交给 useNotebookTabs 的 onDrop 使用，时序不变）。
 */
export interface UseWorkspaceSessionOptions {
  /** keep-alive 标签快照（保存屏障要遍历全部 tab，不能只读渲染态）。 */
  tabsRef: MutableRefObject<NotebookTab[]>;
  active: NotebookTab | null;
  updateTab: (id: string, patch: Partial<Omit<NotebookTab, "id">>) => void;
  removeTab: (id: string) => void;
  clearTabs: () => void;
  closeOverlay: (kind: "tabs") => void;
  onBack: () => void;
  onSwitchNotebook: (id: string) => void;
  notebookId: string;
  onRegisterBackHandler?: (handler: (() => Promise<void>) | null) => void;
  editorsRef: MutableRefObject<Map<string, LakeEditorInstance | null>>;
  liveBodyCapturesRef: MutableRefObject<Map<string, () => string | null>>;
}

export function useWorkspaceSession(options: UseWorkspaceSessionOptions) {
  const {
    tabsRef,
    active,
    updateTab,
    removeTab,
    clearTabs,
    closeOverlay,
    onBack,
    onSwitchNotebook,
    notebookId,
    onRegisterBackHandler,
    editorsRef,
    liveBodyCapturesRef,
  } = options;
  const closingRef = useRef(false);

  // 自动保存：编辑态内容变化防抖 1s 落盘；flush 返回真实写盘 Promise，失败保留界面并提示。
  const reportAutoSaveError = useCallback((_id: string, reason: unknown) => {
    toastActionError("保存", reason);
  }, []);
  const { schedule: scheduleAutoSave, flush: flushAutoSave, cancel: cancelAutoSave } = useAutoSave(async (id, title, content, plain) => {
    await bridge.saveNote(id, title, content, null, plain);
  }, { onError: reportAutoSaveError });

  /** 现取 usheet/board/ink 最新正文并等待保存完成；成功前不释放实例 capture，也不关闭界面。 */
  const captureAndSaveTab = useCallback(async (tab: NotebookTab): Promise<void> => {
    const captured = liveBodyCapturesRef.current.get(tab.id)?.();
    if (captured && captured !== tab.content) {
      scheduleAutoSave(tab.id, tab.title, captured);
    }
    await flushAutoSave(tab.id);
  }, [flushAutoSave, scheduleAutoSave]);

  /** 返回首页 / 切换笔记本 / 关闭全部前的统一保存屏障。 */
  const flushAllTabs = useCallback(async (): Promise<void> => {
    await Promise.all(tabsRef.current.map((tab) => captureAndSaveTab(tab)));
    await flushAutoSave();
  }, [captureAndSaveTab, flushAutoSave]);

  /** 关闭全部标签：任一保存失败都不清空界面，避免 UI 先假装成功。 */
  const closeAllTabs = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await flushAllTabs();
      clearTabs();
      closeOverlay("tabs");
    } catch (error) { /* useAutoSave.onError 已给出可见原因；保留全部标签供重试 */
      reportMobileActionError("关闭全部标签", error);
    }
    finally { closingRef.current = false; }
  }, [clearTabs, closeOverlay, flushAllTabs]);

  const closeTab = useCallback(async (id: string) => {
    if (closingRef.current) return;
    const closing = tabsRef.current.find((t) => t.id === id);
    if (!closing) return;
    closingRef.current = true;
    try {
      await captureAndSaveTab(closing);
      removeTab(id);
    } catch (error) { /* 保留当前 tab 与编辑器，允许重试 */
      reportMobileActionError("关闭标签", error);
    }
    finally { closingRef.current = false; }
  }, [captureAndSaveTab, removeTab]);

  /** 文档已进回收站后的关闭：不能再保存（写边界会正确拒绝），直接丢弃本地 tab。 */
  const discardTab = useCallback((id: string) => {
    removeTab(id);
  }, [removeTab]);

  /** 返回首页：等待所有正文与文档保存落盘后才交给路由转场；失败留在当前界面。 */
  const handleBack = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await flushAllTabs();
      onBack();
    } catch (error) { /* useAutoSave.onError 已给出可见原因 */
      reportMobileActionError("返回首页", error);
    }
    finally { closingRef.current = false; }
  }, [flushAllTabs, onBack]);

  /** 切换笔记本同属离开当前工作区，必须先过同一保存屏障。 */
  const switchNotebook = useCallback(async (id: string) => {
    if (id === notebookId || closingRef.current) return;
    closingRef.current = true;
    try {
      await flushAllTabs();
      onSwitchNotebook(id);
    } catch (error) { /* 保存失败时保持当前工作区 */
      reportMobileActionError("切换笔记本", error);
    }
    finally { closingRef.current = false; }
  }, [notebookId, flushAllTabs, onSwitchNotebook]);

  // Android 返回键由父层转交给这里（不能直接 closeWorkspace，否则异步保存会被卸载打断）。
  useEffect(() => {
    onRegisterBackHandler?.(handleBack);
    return () => onRegisterBackHandler?.(null);
  }, [handleBack, onRegisterBackHandler]);

  // 进后台是 WebView 可能被冻结前最后一次可靠落盘时机；只 best-effort，不销毁 capture/界面。
  const flushAllTabsRef = useRef(flushAllTabs);
  flushAllTabsRef.current = flushAllTabs;
  useEffect(() => {
    let remove: (() => void) | null = null;
    void import("@capacitor/app").then(async ({ App }) => {
      const handle = await App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) void flushAllTabsRef.current().catch(() => undefined);
      });
      remove = () => { void handle.remove(); };
    }).catch(() => undefined);
    return () => remove?.();
  }, []);

  const toggleEdit = useCallback(async () => {
    if (!active?.loaded) return;
    // usheet / board / ink 的正文在实例里；完成时同步 capture，不能只读父级 state
    // （可能还在 500ms/1s 防抖窗口内 —— 手写板「切完纸张立刻点完成」就会丢最后一笔纸张改动）。
    const captured = active.kind === "usheet" || active.kind === "board" || active.kind === "ink"
      ? liveBodyCapturesRef.current.get(active.id)?.() ?? null
      : null;
    const nextContent = captured ?? active.content;
    if (active.editing) {
      cancelAutoSave(active.id); // 旧 timer 里的 content 可能落后于 captured
      // 再等**在途**的自动保存落完，避免旧快照后落盘覆盖下面的新内容（261030 review）。
      try { await flushAutoSave(active.id); } catch { /* 旧快照失败已 toast；继续显式保存最新 */ }
      try {
        await bridge.saveNote(active.id, active.title, nextContent);
      } catch (reason) {
        toastActionError("保存", reason);
        return;
      }
      successFeedback(); // 只有真正落盘后才提示完成
    }
    updateTab(active.id, { content: nextContent, editing: !active.editing });
  }, [active, cancelAutoSave, updateTab]);

  // ---- pane 接线（P9-5b 的回调化，原为 NotebookWorkspace 内联箭头）----
  const handlePaneBodyChange = useCallback((tab: NotebookTab, content: string, plain?: string) => {
    updateTab(tab.id, { content });
    if (tab.editing) scheduleAutoSave(tab.id, tab.title, content, plain);
  }, [scheduleAutoSave, updateTab]);
  const persistBitableNow = useCallback(async (tab: NotebookTab, content: string) => {
    updateTab(tab.id, { content });
    await bridge.saveNote(tab.id, tab.title, content);
  }, [updateTab]);
  const handlePaneCapture = useCallback((id: string, capture: (() => string | null) | null) => {
    if (capture) liveBodyCapturesRef.current.set(id, capture);
    else liveBodyCapturesRef.current.delete(id);
  }, []);
  const handleEditorInstance = useCallback((id: string, editor: LakeEditorInstance | null) => {
    if (editor) editorsRef.current.set(id, editor);
    else editorsRef.current.delete(id);
  }, []);

  return {
    scheduleAutoSave,
    /** 统一保存屏障：创建副本前调用，保证副本读到最新正文（261106 用户确认）。 */
    flushAllTabs,
    toggleEdit,
    handleBack,
    switchNotebook,
    closeTab,
    closeAllTabs,
    discardTab,
    handlePaneBodyChange,
    persistBitableNow,
    handlePaneCapture,
    handleEditorInstance,
  };
}
