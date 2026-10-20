import type { CSSProperties } from "react";
import { activeEditorHost } from "../features/editor/activeEditor";
import { clearScrollMemory } from "../features/editor/EditorTab";
import { escapeId } from "../lib/cssEscape";
import { resolveScrollNode } from "../features/editor/lakeRuntime";
import type { TabInfo } from "../features/editor/MultiTabEditor";
import type { OutlineMode } from "../features/outline/OutlineController";
import { OUTLINE_HOVER_TRIGGER_WIDTH, OUTLINE_SCROLLBAR_CLEARANCE } from "../features/outline/outlineInteraction";
import { treeNodePath, type DesktopWorkspace, type OpenTab } from "../desktop/desktopTypes";
import type { NoteSummary, TreeNode } from "../lib/types";
import type { SidebarMode } from "../components/app/Sidebar";

export interface DesktopViewInput {
  activeNoteId: string | null;
  treeNodes: TreeNode[];
  notes: NoteSummary[];
  openTabs: OpenTab[];
  iconByNoteId: Map<string, string | null>;
  fontSize: number;
  showToolbar: boolean;
  floatingToolbar: boolean;
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
    fontSize, showToolbar, floatingToolbar, tocEnabled, outlineEnhance, desktopWorkspace,
    activeOutlineEmpty, outlineEmptyOverride, outlineMode,
    sidebarWidth, sidebarMode, narrowOverlay, outlineSidebarWidth,
  } = input;

  const activeNodeSyncState = activeNoteId ? (treeNodes.find((n) => n.noteFileId === activeNoteId)?.syncState ?? "synced") : "synced";

  // blockHandle：桌面编辑态的块悬浮手柄/块操作菜单（菜单只走内核原生命令，见 blockHandleMount）
  const editorPrefs = { fontSize, showToolbar, floatingToolbar, blockHandle: true };

  // 编辑器面包屑：活动文档路径（思源 protyle-breadcrumb）
  const activePath = activeNoteId ? treeNodePath(treeNodes, activeNoteId) : [];

  const scrollActiveEditorToTop = () => {
    if (!activeNoteId) return;
    clearScrollMemory(activeNoteId);
    const activeHost = document.querySelector<HTMLElement>(`.lake-editor-tab[data-note-id="${escapeId(activeNoteId)}"]`);
    // 正常路径按 activeNoteId 定位；多标签切换/懒加载的瞬间如果属性还未回流，
    // 再兜底处理**当前显示中**的编辑器，避免点击后仍停留在旧滚动位置。
    // ⚠️ 兜底判据用显式信号 data-active（activeEditorHost），**不要**再用 display/几何猜可见：
    // 261005 起非活动标签保留布局尺寸（opacity+visibility 隐藏），display 恒为 block ⇒ 会命中的所有标签。
    const fallback = activeEditorHost();
    const hosts = activeHost ? [activeHost] : fallback ? [fallback] : [];
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

  /** 每个文档 tab 的**笔记本名**（面包屑首段）：EditorTab 按自己的 noteId 取，不再依赖活动文档。 */
  const notePathTitle = (noteId: string): string | null => {
    const path = treeNodePath(treeNodes, noteId);
    return path.length > 0 ? (path[0].title || "无标题") : null;
  };

  const tabInfos: TabInfo[] = openTabs.map((tab) => ({
    noteId: tab.noteId, title: tab.title, content: tab.content, dirty: tab.dirty, deleted: tab.deleted,
    icon: iconByNoteId.get(tab.noteId) ?? null,
    reloadKey: tab.reloadKey ?? 0,
    // v6：必须透传文档类型。漏掉它 ⇒ MultiTabEditor 收不到 kind=usheet，表格会被当成 Lake 文档用 EditorTab 渲染。
    kind: tab.kind ?? "doc",
  }));

  // 大纲增强=开 → 应用自建大纲侧栏；关 → 用 Lake 原生大纲（此侧栏隐藏），原生 by toc.enable。
  // v6：非 doc（表格/多维表）没有可导航大纲，且统计口径不适用 → 一律隐藏大纲侧栏。
  const activeKind: "doc" | "usheet" | "bitable" | "board" | "ink" =
    (activeNoteId ? openTabs.find((t) => t.noteId === activeNoteId)?.kind : undefined) ?? "doc";
  const outlineVisible = tocEnabled && outlineEnhance && desktopWorkspace === "library" && activeKind === "doc";
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
    // 与内核原生大纲同口径：面板整体右让，给编辑器垂直滚动条留出可点/可拖的位置。
    "--lake-outline-clearance": `${OUTLINE_SCROLLBAR_CLEARANCE}px`,
    // 04 §4：收起**不占列**（整边触发悬浮）；固定只占面板宽（无右侧固定轨）
    // 260922：大纲搬进编辑区 —— 不再占栅格列；固定态 = pane 右内推（= 面板宽，正文被推开），
    // 收起/悬停 = 0（浮层覆盖）。同一变量也供状态栏让位（document-status.css）使用。
    "--lake-outline-inset": outlineVisible && effectiveOutlineMode === "docked"
      ? `${outlineSidebarWidth}px`
      : "0px",
  } as CSSProperties;

  return {
    activeNodeSyncState, editorPrefs, activePath, scrollActiveEditorToTop, notePathTitle,
    tabInfos, outlineVisible, lockedNoteIds, effectiveOutlineMode, shellStyle, activeKind,
  };
}
