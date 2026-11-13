import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { LakeEditorInstance } from "../../features/editor/lakeRuntime";
import { bridge } from "../bridge";
import { useAutoSave } from "../hooks/useAutoSave";
import { reportMobileActionError } from "../lib/reportMobileActionError";
import { successFeedback } from "../ui/haptics";
import type { NotebookTab } from "./useNotebookTabs";
import { toastActionError } from "../lib/actionError";
import { showToast } from "../ui/toastBus";
import { mobileReadonlyText } from "../lib/readonlyText";
import { isGoneNote } from "../../core/syncDecisions";
import { registerNoteTabDismisser } from "./tabDismissal";

/** 保存屏障遇到 gone 文档时的可见说明（AGENTS §3#16：保存被拦要明说，不静默丢弃）。 */
const GONE_TAB_DISCARDED = "文档已在回收站或已被删除，已关闭标签；可在回收站中恢复";

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
  /** 批量移除（删除级联一次关多张标签；不能循环 removeTab，见 useNotebookTabs.removeTabs）。 */
  removeTabs: (ids: readonly string[]) => void;
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
    removeTabs,
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

  /**
   * 标签对应的文档是否已 gone（本机回收站 / 他端 purge）。
   * 判据与打开入口同一份 core.isGoneNote；**trashedAt 必须传**：删笔记本/分组的级联只标 trashed_at、
   * 子文档 parent_id 不变 ⇒ 只看 parentId 会把回收站文档当活跃文档，保存屏障会被写边界永久拒绝（tab 关不掉）。
   */
  const tabIsGone = useCallback(async (id: string): Promise<boolean> => {
    try {
      const state = await bridge.noteGoneState(id);
      // 行已不存在（purge 后物理删除）= 同样不能再走保存（会撞墓碑判定），按 gone 丢弃。
      if (!state) return true;
      return isGoneNote({ parentId: state.parentId, syncState: state.syncState, trashedAt: state.trashedAt });
    } catch {
      // 判定失败不阻断关闭：仍走原保存路径，失败由 onError 给出可见原因。
      return false;
    }
  }, []);

  /** 丢弃一个标签：先取消待保存快照（否则全量 flush 仍会去写被拒的行、保存屏障继续失败）。 */
  const discardTab = useCallback((id: string) => {
    cancelAutoSave(id);
    removeTab(id);
  }, [cancelAutoSave, removeTab]);

  const discardGoneTab = useCallback((id: string) => {
    discardTab(id);
    showToast(GONE_TAB_DISCARDED, { type: "info" });
  }, [discardTab]);

  // 删除入口（首页删笔记本/日记页删条目/目录树/批量多选/缺正文彻底删除）通过模块通道报告
  // **数据层真正软删的 note id**（261114 task-8，对齐桌面 deleteTreeNode 先收标签再删）：
  // 这里统一 discardTab（取消待保存 + 移出标签；编辑器实例由 useNotebookTabs.onDrop 释放）。
  // 工作区未挂载时通道没人接 = no-op（此时没有内存标签）。
  useEffect(() => registerNoteTabDismisser((noteIds) => {
    for (const id of noteIds) cancelAutoSave(id); // 先取消失效待保存，再一次性移出（批量 API，避免旧快照互相覆盖）
    removeTabs(noteIds);
  }), [cancelAutoSave, removeTabs]);

  /** 现取 usheet/board/ink 最新正文并等待保存完成；成功前不释放实例 capture，也不关闭界面。
   *  写盘前先过 gone 判定：已进回收站/被他端 purge 的文档不再尝试保存（写边界必拒），交调用方走 discardTab。 */
  const captureAndSaveTab = useCallback(async (tab: NotebookTab): Promise<"saved" | "gone"> => {
    if (await tabIsGone(tab.id)) return "gone";
    const captured = liveBodyCapturesRef.current.get(tab.id)?.();
    if (captured && captured !== tab.content) {
      scheduleAutoSave(tab.id, tab.title, captured);
    }
    await flushAutoSave(tab.id);
    return "saved";
  }, [flushAutoSave, scheduleAutoSave, tabIsGone]);

  /** 返回首页 / 切换笔记本 / 关闭全部前的统一保存屏障。
   *  gone 标签先丢弃（并取消其待保存），否则全量 flush 仍会去写被拒的行、屏障永远失败（关不掉/退不出）。 */
  const flushAllTabs = useCallback(async (): Promise<void> => {
    const outcomes = await Promise.allSettled(tabsRef.current.map((tab) => captureAndSaveTab(tab)));
    let discarded = 0;
    let failure: unknown;
    outcomes.forEach((outcome, index) => {
      if (outcome.status === "rejected") { failure = outcome.reason; return; }
      if (outcome.value !== "gone") return;
      discardTab(tabsRef.current[index].id);
      discarded += 1;
    });
    if (discarded > 0) showToast(GONE_TAB_DISCARDED, { type: "info" });
    // 其它标签的保存失败仍要冒泡（调用方保留界面供重试），不能因 gone 处理被吞掉。
    if (failure !== undefined) throw failure;
    await flushAutoSave();
  }, [captureAndSaveTab, discardTab, flushAutoSave]);

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
      if ((await captureAndSaveTab(closing)) === "gone") {
        discardGoneTab(id);
        return;
      }
      removeTab(id);
    } catch (error) { /* 保留当前 tab 与编辑器，允许重试 */
      reportMobileActionError("关闭标签", error);
    }
    finally { closingRef.current = false; }
  }, [captureAndSaveTab, discardGoneTab, removeTab]);

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
    // 261112 task-56（N4）：编辑锁 = 只读（桌面端锁定）。入口统一拦在这里，文案明说怎么解锁。
    // task-67：文案取 core/capabilities/readonlyReason（移动端只覆盖解除动作措辞）。
    if (active.editLocked) {
      showToast(mobileReadonlyText({ locked: true }) ?? "文档已锁定（只读）", { type: "info" });
      return;
    }
    // usheet / board / ink 的正文在实例里；完成时同步 capture，不能只读父级 state
    // （可能还在 500ms/1s 防抖窗口内 —— 手写板「切完纸张立刻点完成」就会丢最后一笔纸张改动）。
    const captured = active.kind === "usheet" || active.kind === "board" || active.kind === "ink"
      ? liveBodyCapturesRef.current.get(active.id)?.() ?? null
      : null;
    const nextContent = captured ?? active.content;
    if (active.editing) {
      // 文档已进回收站/被他端 purge：显式保存必被写边界拒绝 ⇒ 与关闭同口径丢弃标签并明说（不静默丢编辑）。
      if (await tabIsGone(active.id)) {
        discardGoneTab(active.id);
        return;
      }
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
  }, [active, cancelAutoSave, discardGoneTab, tabIsGone, updateTab]);

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
