/**
 * 桌面目录**展开态**的设备本地记忆（261121 用户现场：退出前收起了所有笔记本，重开又全部展开）。
 *
 * 语义（与 collapsedNotebooks.ts / pinnedTree.ts 同一套写法）：
 * · 只记 **设备本地**（localStorage，不进正文 / 不进 S3 / 各端独立）；
 * · 记的是「**当前展开着的节点 id**」，**空数组 = 用户主动全部收起**（与"从没记过"必须区分）；
 * · 读的时候要按当前树裁剪：删掉的节点 id 不能永久占位（否则越积越多、还会误判"有记录"）；
 * · 首次运行（无记录）仍走 `autoExpanded`（笔记本/分组默认展开）—— 老用户升级不改观感。
 */
import type { TreeNode } from "../../core/sharedTypes";

const KEY = "lakex-local-notes-v3.sidebar-expanded";

/** 读展开态。**null = 没有记录**（调用方用默认展开）；数组（含空数组）= 用户的真实选择。 */
export function readExpandedNodeIds(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return null;
  }
}

/** 写展开态；本地存储不可用（隐私模式/配额满）时静默放弃（本次仍按内存状态渲染）。 */
export function writeExpandedNodeIds(ids: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* 不记忆，但不影响当次使用 */
  }
}

/** 按**当前树**裁剪：只留仍存在且可展开（有子级或本身就是容器）的节点 id。 */
export function pruneExpandedNodeIds(ids: readonly string[], nodes: readonly TreeNode[]): string[] {
  const alive = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!alive.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** 清除记忆（当前没有调用方；留给"重置目录"类入口，保持模块自洽）。 */
export function clearExpandedNodeIds(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
