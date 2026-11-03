import { useCallback, useEffect, type MutableRefObject } from "react";
import { bridge } from "../bridge";
import { pushBackHandler } from "../ui/backStack";
import { showToast } from "../ui/toastBus";
import { SELF_REGISTERED_OVERLAY_KINDS, type WorkspaceOverlayKind } from "./useWorkspaceOverlays";
import type { NotebookTab } from "./useNotebookTabs";
import type { NotebookTreeItem } from "./useNotebookTreeData";

/**
 * 工作区「返回栈 + 同步」逻辑（261103 P11-②，原 NotebookWorkspace 内联代码逐字搬移，未改行为）：
 * 浮层返回键登记（MOB-01/MOB-02）、手动同步（runSync）、活动文档上报。
 * 两个 effect 的相对顺序与依赖数组逐字保留（浮层登记 → 同步 → 上报）。
 */
export interface UseWorkspaceSyncOptions {
  overlayKind: WorkspaceOverlayKind | null;
  closeOverlay: (kind: WorkspaceOverlayKind) => void;
  loadTree: () => Promise<NotebookTreeItem[]>;
  /** keep-alive 标签快照（同步后在阅读态重读当前文档）。 */
  tabsRef: MutableRefObject<NotebookTab[]>;
  activeId: string | null;
  loadTabBody: (id: string, force?: boolean) => Promise<void>;
  /** 依赖数组与旧实现逐字一致（openTab 未在体内使用，但保留在原 deps 里）。 */
  openTab: (id: string, options?: { enterEditor?: boolean }) => Promise<void>;
  onActiveNoteChange?: (id: string | null) => void;
}

export function useWorkspaceSync(options: UseWorkspaceSyncOptions) {
  const { overlayKind, closeOverlay, loadTree, tabsRef, activeId, loadTabBody, openTab, onActiveNoteChange } = options;

  /**
   * 返回键（MOB-01）：工作区浮层必须自己消费返回，否则会落回父层「退出工作区」
   * （整轮 flushAllTabs + 出场转场回首页），用户以为只是关抽屉。
   * 浮层现在只有一个（MOB-02 的 overlay）⇒ 一次只可能关这一层。
   * 自带返回栈的种类（菜单 Sheet / 底部 Sheet 原语，见 SELF_REGISTERED_OVERLAY_KINDS）
   * 不在这里重复登记 —— 否则返回键会跳过子菜单下钻直接关面板。
   * 无浮层时不登记 ⇒ 返回键走原有「退工作区（含保存屏障）」。
   */
  useEffect(() => {
    // 单一 owner（MOB-02）之后只剩一条判据：overlay.kind。任一浮层打开就登记 ⇒ 返回键只关它。
    if (!overlayKind || SELF_REGISTERED_OVERLAY_KINDS.has(overlayKind)) return;
    return pushBackHandler(() => { closeOverlay(overlayKind); return true; });
  }, [overlayKind, closeOverlay]);

  // 立即同步（思源顶栏右侧的云图标就是同步状态/触发器）
  const runSync = useCallback(async () => {
    try {
      const r = await bridge.syncNow();
      // 同步可能改了远端标题/正文：刷新目录，并在阅读态强制重读当前文档（编辑态不打断）。
      await loadTree();
      const activeTab = tabsRef.current.find((t) => t.id === activeId);
      if (activeTab && !activeTab.editing) await loadTabBody(activeTab.id, true);
      const w = r.warnings?.length ?? 0;
      showToast((r.message || "已同步") + (w > 0 ? `，${w} 项被跳过` : ""));
    } catch (e) { showToast("同步失败：" + (e as Error).message, { type: "error" }); }
  }, [loadTree, openTab, activeId]);

  // 活动文档上报（MobileApp 的定时自动快照按当前文档留档）
  useEffect(() => { onActiveNoteChange?.(activeId); }, [activeId, onActiveNoteChange]);

  return { runSync };
}
