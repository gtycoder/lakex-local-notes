/**
 * 桌面目录「已收起」笔记本 —— **只存设备本地**（261120 用户点单）。
 *
 * 语义（与 pinnedTree.ts 同一套写法，刻意保持对称，便于对照）：
 * · 收起 = 给笔记本加一个归纳状态：**不改原目录结构、不移动、不写库、不进 S3**；
 * · 收起后从目录主列表消失，只在**目录底部「已收起」分区**出现（= 置顶的反向：置底）；
 * · 顺序 = 用户收起的先后顺序（追加）；分区里按该顺序渲染；
 * · 各端独立（本机 localStorage；移动端有自己的实现）。
 *
 * 判定（哪些本能收）= core/notebookCollapse.canCollapseNotebook（逻辑排除回收站/未分类/日记本）。
 * 本模块只做纯数据读写；渲染在 Sidebar 的「已收起」分区。
 */
import { normalizeCollapsedNotebookIds } from "../../core/notebookCollapse";

const KEY = "lakex-local-notes-v3.sidebar-collapsed-notebooks";
/** 分区展开态（默认**收起** ⇒ 缺省/false；261120 用户点单「默认收起来」）。 */
const OPEN_KEY = "lakex-local-notes-v3.sidebar-collapsed-open";

/** 读取已收起的笔记本 id（去重、保序；坏值静默回落空表）。 */
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

/** 写回（调用方保证已去重；坏 storage 静默忽略）。 */
export function writeCollapsedNotebookIds(ids: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeCollapsedNotebookIds(ids)));
  } catch {
    /* localStorage 不可用（隐私模式/配额满）⇒ 本次不记忆，但界面仍按刚点的状态渲染 */
  }
}

/** 切换某笔记本的收起状态；返回切换后是否已收起（true = 现在已收起）。 */
export function toggleCollapsedNotebook(id: string): boolean {
  const current = readCollapsedNotebookIds();
  const has = current.includes(id);
  writeCollapsedNotebookIds(has ? current.filter((item) => item !== id) : [...current, id]);
  return !has;
}

/** 「已收起」分区展开态（默认收起）。 */
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
    /* localStorage 不可用 ⇒ 展开态不记忆，本次交互照常 */
  }
}
