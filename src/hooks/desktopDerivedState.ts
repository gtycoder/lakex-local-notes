import type { CSSProperties } from "react";
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

/**
 * 从 App 状态派生的「视图模型」：面包屑/大纲/锁/标签信息/顶栏样式（纯计算，从 App.tsx 抽出）。
 *
 * 261028 DT-14：这里**只出值**，不再读 DOM / 返回带副作用的闭包。原先的「活动标签滚回顶部」
 * 自 261008 面包屑下沉进 EditorTab 后已无调用方，回顶由各编辑器宿主自己负责
 * （`EditorTab.handleScrollTop`），故整段移除；滚动记忆/搜索定位两个纯函数搬到
 * `features/editor/editorViewport.ts`。
 */
export function deriveDesktopView(input: DesktopViewInput) {
  const {
    activeNoteId, treeNodes, notes, openTabs, iconByNoteId,
    fontSize, showToolbar, floatingToolbar, tocEnabled, outlineEnhance, desktopWorkspace,
    activeOutlineEmpty, outlineEmptyOverride, outlineMode,
    sidebarWidth, sidebarMode, narrowOverlay, outlineSidebarWidth,
  } = input;

  const activeNode = activeNoteId ? treeNodes.find((n) => n.noteFileId === activeNoteId) : undefined;
  const activeNodeDirty = activeNode?.isDirty === true;
  const activeNodeConflict = activeNode?.isConflict === true;

  // blockHandle：桌面编辑态的块悬浮手柄/块操作菜单（菜单只走内核原生命令，见 blockHandleMount）
  const editorPrefs = { fontSize, showToolbar, floatingToolbar, blockHandle: true };

  // 编辑器面包屑：活动文档路径（思源 protyle-breadcrumb）
  const activePath = activeNoteId ? treeNodePath(treeNodes, activeNoteId) : [];

  /** 每个文档 tab 的**笔记本名**（面包屑首段）：EditorTab 按自己的 noteId 取，不再依赖活动文档。 */
  const notePathTitle = (noteId: string): string | null => {
    const path = treeNodePath(treeNodes, noteId);
    return path.length > 0 ? (path[0].title || "无标题") : null;
  };

  const tabInfos: TabInfo[] = openTabs.map((tab) => ({
    noteId: tab.noteId, title: tab.title, content: tab.content, dirty: tab.dirty, deleted: tab.deleted,
    // 261023：正文文件缺失必须透传（漏掉 ⇒ 缺正文文档会被当正常文档挂编辑器，又回到 ENOENT 报错）。
    bodyMissing: tab.bodyMissing,
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
  const lockedNoteIds = new Set(notes.filter((n) => n.isEditLocked).map((n) => n.id));
  // v3「云端已删除 · 仅本地」：store 驱动（cloud_deleted，恢复并重新上传成功后自动清除）。
  const cloudDeletedNoteIds = new Set(notes.filter((n) => n.cloudDeleted).map((n) => n.id));

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
    activeNodeDirty, activeNodeConflict, editorPrefs, activePath, notePathTitle,
    tabInfos, outlineVisible, lockedNoteIds, cloudDeletedNoteIds, effectiveOutlineMode, shellStyle, activeKind,
  };
}
