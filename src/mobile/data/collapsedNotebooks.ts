/**
 * 移动端「已收起」笔记本（知识库页底部折叠分组）——**只存设备本地**（261120 用户点单）。
 *
 * 与桌面同语义、各自独立实现（两端 UI 层不共享）：不移动、不写库、不进 S3；收起后从知识库主列表消失，
 * 只在底部「已收起」分组出现；书架/列表两种视图共用。
 * 判定单一来源 = core/notebookCollapse.canCollapseNotebook（逻辑排除回收站/未分类/日记本）。
 */
import { normalizeCollapsedNotebookIds } from "../../core/notebookCollapse";

const KEY = "lakex-local-notes-mobile.collapsed-notebooks";
/** 分组展开态（默认**收起**；261120 用户点单「默认都收起」）。 */
const OPEN_KEY = "lakex-local-notes-mobile.collapsedOpen";

export function readCollapsedNotebookIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeCollapsedNotebookIds(parsed);
  } catch {
    return [];
  }
}

export function writeCollapsedNotebookIds(ids: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeCollapsedNotebookIds(ids)));
  } catch {
    /* localStorage 不可用（WebView 隐私设置 / 配额满）⇒ 本次不落盘；当前会话仍按内存里的新状态渲染 */
  }
}

/** 切换收起；返回切换后是否已收起。 */
export function toggleCollapsedNotebook(id: string): boolean {
  const current = readCollapsedNotebookIds();
  const has = current.includes(id);
  writeCollapsedNotebookIds(has ? current.filter((item) => item !== id) : [...current, id]);
  return !has;
}

export function readCollapsedOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCollapsedOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* localStorage 不可用（WebView 隐私设置 / 配额满）⇒ 本次不落盘；当前会话仍按内存里的新状态渲染 */
  }
}
