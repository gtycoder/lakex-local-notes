import type { CSSProperties } from "react";
import { clearScrollMemory } from "../features/editor/EditorTab";
import { resolveScrollNode } from "../features/editor/lakeRuntime";
import type { TabInfo } from "../features/editor/MultiTabEditor";
import type { OutlineMode } from "../features/outline/OutlineController";
import { getOutlineTab } from "../features/outline/registry";
import { DOCK_GUTTER } from "../lib/layoutMetrics";
import { OUTLINE_HOVER_TRIGGER_WIDTH, OUTLINE_SCROLLBAR_CLEARANCE } from "../features/outline/outlineInteraction";
import { treeNodePath, OUTLINE_COLLAPSED_WIDTH, type DesktopWorkspace, type OpenTab } from "../desktop/desktopTypes";
import type { NoteSummary, TreeNode } from "../lib/types";
import type { SidebarMode } from "../components/Sidebar";

export interface DesktopViewInput {
  activeNoteId: string | null;
  treeNodes: TreeNode[];
  notes: NoteSummary[];
  openTabs: OpenTab[];
  iconByNoteId: Map<string, string | null>;
  fontSize: number;
  tocEnabled: boolean;
  outlineEnhance: boolean;
  desktopWorkspace: DesktopWorkspace;
  activeOutlineEmpty: boolean;
  outlineEmptyOverride: boolean;
  outlineMode: OutlineMode;
  sidebarWidth: number;
  sidebarMode: SidebarMode;
  /** 窄窗（≤760px）：目录/大纲一律浮层呈现，不占列 —— 与 `sidebarRenderMode` 同一口径。 */
  narrowOverlay: boolean;
  outlineSidebarWidth: number;
}

/** 从 App 状态派生的「视图模型」：面包屑/大纲/锁/标签信息/顶栏样式（纯计算，从 App.tsx 抽出）。 */
export function deriveDesktopView(input: DesktopViewInput) {
  const {
    activeNoteId, treeNodes, notes, openTabs, iconByNoteId,
    fontSize, tocEnabled, outlineEnhance, desktopWorkspace,
    activeOutlineEmpty, outlineEmptyOverride, outlineMode,
    sidebarWidth, sidebarMode, narrowOverlay, outlineSidebarWidth,
  } = input;

  const activeNodeSyncState = activeNoteId ? (treeNodes.find((n) => n.noteFileId === activeNoteId)?.syncState ?? "synced") : "synced";

  const editorPrefs = { fontSize };

  // 编辑器面包屑：活动文档路径（思源 protyle-breadcrumb）
  const activePath = activeNoteId ? treeNodePath(treeNodes, activeNoteId) : [];

  const scrollActiveEditorToTop = () => {
    if (!activeNoteId) return;
    clearScrollMemory(activeNoteId);
    const activeHost = document.querySelector<HTMLElement>(`.lake-editor-tab[data-note-id="${CSS.escape(activeNoteId)}"]`);
    // 正常路径按 activeNoteId 定位；多标签切换/懒加载的瞬间如果属性还未回流，
    // 再兜底处理当前可见的编辑器，避免点击后仍停留在旧滚动位置。
    const hosts = activeHost
      ? [activeHost]
      : [...document.querySelectorAll<HTMLElement>(".lake-editor-tab")].filter((host) => getComputedStyle(host).display !== "none");
    for (const host of hosts) {
      const scroller = resolveScrollNode(host);
      try {
        scroller.scrollTop = 0;
        scroller.scrollTo({ top: 0, behavior: "auto" });
      } catch {
        scroller.scrollTop = 0;
      }
    }
  };

  const navigateToHeading = (id: string) => {
    getOutlineTab(activeNoteId)?.navigate(id);
  };

  // 大纲路径：从当前滚动标题沿 parentId 上溯（H1→H2→…），与目录路径可区分
  const headingPath: Array<{ id: string; level: number; text: string }> = (() => {
    const handle = getOutlineTab(activeNoteId);
    const selectedId = handle?.controller.getSelectedId() ?? null;
    if (!handle || !selectedId) return [];
    const path: Array<{ id: string; level: number; text: string }> = [];
    let node = handle.controller.getNode(selectedId);
    while (node) {
      path.unshift({ id: node.id, level: node.level, text: node.text });
      node = node.parentId ? handle.controller.getNode(node.parentId) : null;
    }
    return path;
  })();

  const tabInfos: TabInfo[] = openTabs.map((tab) => ({
    noteId: tab.noteId, title: tab.title, content: tab.content, dirty: tab.dirty, deleted: tab.deleted,
    icon: iconByNoteId.get(tab.noteId) ?? null,
    reloadKey: tab.reloadKey ?? 0,
  }));

  // 大纲增强=开 → 应用自建大纲侧栏；关 → 用 Lake 原生大纲（此侧栏隐藏），原生 by toc.enable。
  const outlineVisible = tocEnabled && outlineEnhance && desktopWorkspace === "library";
  // 只读锁：store 驱动（可同步），派生集合供多标签 viewer 重建
  const lockedNoteIds = new Set(notes.filter((n) => n.isLocked).map((n) => n.id));

  // 窄窗：锁定态（docked）也按收起态渲染 —— 窄窗不允许大纲占列，只保留右侧 rail + 悬停浮层。
  const effectiveOutlineMode: OutlineMode = narrowOverlay && outlineMode === "docked"
    ? "collapsed"
    : activeOutlineEmpty && !outlineEmptyOverride ? "collapsed" : outlineMode;

  const shellStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    "--sidebar-grid-w": sidebarMode === "docked" ? `${sidebarWidth}px` : "0px",
    "--outline-sidebar-width": `${outlineSidebarWidth}px`,
    "--outline-hover-trigger-width": `${OUTLINE_HOVER_TRIGGER_WIDTH}px`,
    "--outline-scrollbar-clearance": `${OUTLINE_SCROLLBAR_CLEARANCE}px`,
    "--outline-grid-w": outlineVisible
      ? effectiveOutlineMode === "docked"
        ? `${outlineSidebarWidth + OUTLINE_COLLAPSED_WIDTH + DOCK_GUTTER}px`
        : `${OUTLINE_COLLAPSED_WIDTH}px`
      : "0px",
  } as CSSProperties;

  return {
    activeNodeSyncState, editorPrefs, activePath, scrollActiveEditorToTop, navigateToHeading,
    headingPath, tabInfos, outlineVisible, lockedNoteIds, effectiveOutlineMode, shellStyle,
  };
}
