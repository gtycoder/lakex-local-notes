/**
 * 桌面专属类型/常量/纯函数（§20 Phase A：从 src/App.tsx 外移）。
 * - 只放桌面渲染层需要的类型、布局常量、初始化函数、状态更新器、路径/摘要纯函数；
 * - 不依赖 React 状态，可被 App.tsx / desktop/* 组件 / hooks 复用；
 * - 移动端不 import 本文件（移动端只依赖 src/core、src/lib、src/features/editor）。
 */
import type { LakeEditorInstance } from "../features/editor/lakeRuntime";
import type { OutlineMode } from "../features/outline/OutlineController";
import { cleanLakeMarkdown } from "../core/markdownClean";
import { stripAssetAccessToken } from "../lib/assetPort";
import { FIXED_RAIL_WIDTH } from "../lib/layoutMetrics";
import type { NoteDocument, NoteSummary, TreeNode } from "../lib/types";
import type { SidebarMode } from "../components/Sidebar";

export const SIDEBAR_HOVER_HIDE_DELAY_MS = 220;

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type DesktopWorkspace = "library" | "quick-notes" | "trash";

// 左侧资料库与右侧大纲面板各自维护宽度；两侧常驻 activity rail 才保持同宽。
export const SIDEBAR_DEFAULT_WIDTH = 224;
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 420;
export const OUTLINE_SIDEBAR_DEFAULT_WIDTH = 280;
export const OUTLINE_SIDEBAR_MIN_WIDTH = 200;
export const OUTLINE_SIDEBAR_MAX_WIDTH = 420;
// 左右桌面固定 rail 共用同一宽度，避免视觉 rail 与 grid 列错位。
export const OUTLINE_COLLAPSED_WIDTH = FIXED_RAIL_WIDTH;

export interface OpenTab {
  noteId: string;
  title: string;
  content: string;
  dirty: boolean;
  lastAccessedAt: number;
  /** P1：恢复历史后 bump，强制 EditorTab 重建（content 变化不会触发 Lake 实例重建） */
  reloadKey?: number;
  /** 远端删除（软删/墓碑/purge）后标记，保留正文供复制/从回收站恢复；保存会被拦截。 */
  deleted?: boolean;
  /** 上次同步后记录的轻量状态摘要（title+updatedAt），用于跳过未变化的全量重载。 */
  lastDigest?: { title: string; updatedAt: string } | null;
  /** v6/v7 文档类型（doc | sheet | bitable | board；缺省 doc）：宿主据此选择编辑器。 */
  kind?: "doc" | "sheet" | "bitable" | "board";
}

/** 状态栏提示：可选"点击动作"（查看历史/回收站）。 */
export interface NoticeState {
  text: string;
  action?: { label: string; onClick: () => void };
}

export function initialOutlineMode(): OutlineMode {
  const stored = localStorage.getItem("lake-notes-v2.outline-sidebar-mode");
  if (stored === "docked" || stored === "collapsed") return stored;
  // 首次进入默认只显示常驻窄 rail；点击或悬停后再显示大纲面板。
  return "collapsed";
}

export function initialSidebarMode(): SidebarMode {
  const stored = localStorage.getItem("lake-notes-v2.sidebar-mode");
  if (stored === "docked" || stored === "collapsed") return stored;
  return localStorage.getItem("lake-notes-v1.sidebar") === "collapsed" ? "collapsed" : "docked";
}

export function initialSidebarWidth(): number {
  const stored = Number(localStorage.getItem("lake-notes-v3.sidebar-width"));
  return Number.isFinite(stored)
    ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, stored))
    : SIDEBAR_DEFAULT_WIDTH;
}

export function initialOutlineSidebarWidth(): number {
  const stored = Number(localStorage.getItem("lake-notes-v3.outline-sidebar-width"));
  return Number.isFinite(stored)
    ? Math.min(OUTLINE_SIDEBAR_MAX_WIDTH, Math.max(OUTLINE_SIDEBAR_MIN_WIDTH, stored))
    : OUTLINE_SIDEBAR_DEFAULT_WIDTH;
}

/** 从编辑器实例读取派生缓存（markdown/plain）；无 getDocument（Viewer 锁定态）返回 null。
 * 单字段独立 try/catch（markdown/plain 各自失败不影响另一个），调用方决定兜底策略。 */
export function readEditorDocumentCaches(editor: LakeEditorInstance | undefined): { markdown: string | null; plain: string | null } | null {
  if (!editor || typeof editor.getDocument !== "function") return null;
  const caches: { markdown: string | null; plain: string | null } = { markdown: null, plain: null };
  try { caches.markdown = cleanLakeMarkdown(stripAssetAccessToken(editor.getDocument("text/markdown"))); } catch { /* 忽略 */ }
  try { caches.plain = stripAssetAccessToken(editor.getDocument("text/plain")); } catch { /* 忽略 */ }
  return caches;
}

// ---- 状态更新器（setX(items => items.map(...)) 模式的公共抽取；保持各调用点语义逐字等价） ----
export const replaceTreeNode = (node: TreeNode) => (items: TreeNode[]) => items.map((item) => item.id === node.id ? node : item);
export const patchNoteById = (id: string, patch: Partial<NoteSummary>) => (items: NoteSummary[]) => items.map((item) => item.id === id ? { ...item, ...patch } : item);
export const patchTabById = (noteId: string, patch: Partial<OpenTab>) => (tabs: OpenTab[]) => tabs.map((tab) => tab.noteId === noteId ? { ...tab, ...patch } : tab);

/** 思源式面包屑：从树节点沿 parentId 上溯到根，得到 [笔记本, 分组…, 文档] 路径 */
export function treeNodePath(nodes: TreeNode[], noteId: string): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const start = nodes.find((n) => n.noteFileId === noteId);
  if (!start) return [];
  const path: TreeNode[] = [];
  let cur: TreeNode | undefined = start;
  while (cur) { path.unshift(cur); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
  return path;
}

export const summaryOf = ({ content: _content, ...summary }: NoteDocument): NoteSummary => summary;
