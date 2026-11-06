/**
 * 桌面目录「置顶」——**只存设备本地**（用户 261107 点单）。
 *
 * 语义：
 * · 置顶 = 给节点（文档 / 分组 / 笔记本）加一个**入口**，不改原目录结构、不移动、不写库、不进 S3；
 * · 顺序 = 用户加入顺序（多选批量按选择顺序追加），置顶区内部可拖拽重排；
 * · 多个端各自独立（各机 localStorage 各一份；移动端有自己的「置顶」= 原「常用」实现，完全独立）；
 * · 分组/含子文档的父节点置顶 = 渲染时连同子级一起显示（渲染层递归，不复制数据）。
 *
 * 本模块只做纯数据读写 + 事件通知；渲染与拖拽在 SidebarPinnedSection。
 */
const KEY = "lakex-local-notes-v3.sidebar-pinned";
const OPEN_KEY = "lakex-local-notes-v3.sidebar-pinned-open";
const EVENT = "lakex-local-notes-v3.sidebar-pinned-change";

function isNodeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** 读取置顶根节点 id（去重、保序；坏值静默回落空表）。 */
export function readPinnedTreeIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter(isNodeId))];
  } catch {
    return [];
  }
}

/** 写回（调用方保证已去重；坏 storage 静默忽略）。 */
export function writePinnedTreeIds(ids: readonly string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set(ids.filter(isNodeId))])); } catch { /* 忽略 */ }
  emit();
}

export function isPinnedTreeId(id: string): boolean {
  return readPinnedTreeIds().includes(id);
}

/** 切换单节点置顶；返回切换后是否置顶（true = 现在已置顶）。 */
export function togglePinnedTreeId(id: string): boolean {
  const current = readPinnedTreeIds();
  const has = current.includes(id);
  writePinnedTreeIds(has ? current.filter((item) => item !== id) : [...current, id]);
  return !has;
}

/**
 * 批量置顶/取消：置顶按传入顺序追加（已置顶的保持原位），取消只删这些 id。
 * 多选入口用这个，保证「一次操作一个写事件」。
 */
export function setPinnedTreeIds(ids: readonly string[], pinned: boolean): string[] {
  const current = readPinnedTreeIds();
  const target = ids.filter(isNodeId);
  const next = pinned
    ? [...current, ...target.filter((id) => !current.includes(id))]
    : current.filter((id) => !target.includes(id));
  writePinnedTreeIds(next);
  return readPinnedTreeIds();
}

/** 置顶区内拖拽重排：把 dragId 放到 targetId 的前/后；两者都不存在时原样返回。 */
export function reorderPinnedTreeIds(
  ids: readonly string[],
  dragId: string,
  targetId: string,
  position: "before" | "after",
): string[] {
  const next = [...ids];
  const from = next.indexOf(dragId);
  const targetIndex = next.indexOf(targetId);
  if (from < 0 || targetIndex < 0 || dragId === targetId) return next;
  next.splice(from, 1);
  const insertAt = next.indexOf(targetId) + (position === "after" ? 1 : 0);
  next.splice(insertAt, 0, dragId);
  return next;
}

/** 「置顶」分组展开/收起（设备本地偏好；默认展开）。 */
export function readPinnedOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) !== "0"; } catch { return true; }
}

export function writePinnedOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* 忽略 */ }
}

/** 订阅置顶变化（同一窗口内多处视图同步；不触网）。 */
export function subscribePinnedTree(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const handler = (): void => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

function emit(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(EVENT));
  }
}
