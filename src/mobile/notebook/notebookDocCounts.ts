/**
 * 首页「知识库」卡片的文档计数（纯函数，不碰 React / DB）。
 *
 * 口径（261119 用户点单）：卡片显示**整棵子树的文档总数** —— 笔记本下任意深度的分组/子分组、
 * 以及嵌套文档（note 也可作父节点）里的 kind=note 节点都算；**不是只数根目录直属文档**
 * （旧实现只按 parentId 归组 ⇒ 文档全在分组里时卡片显示「0 篇」）。
 *
 * 不计（与 core.isGoneNote / 树可见性同口径）：
 *  · 回收站：trashed_at 墓碑（删除笔记本/分组的级联只标它、parent_id 不变）、parentId 指向回收站、
 *    回收站子树的后代（沿父链碰到 TRASH_NOTEBOOK_ID 即整支不计）；
 *  · purge：is_purged / syncState === "purged"；
 *  · 父节点不在位的悬空行、坏库成环（树里看不见的，卡片也不数）。
 *
 * 性能（AGENTS §1：2 万文档量级）：父→根解析带 memo，整体一次 O(n)；调用方在树聚合处
 * （MobileApp 的 docCounts useMemo）一次算好整张表，**不做每卡遍历全库**。
 */
import { isGoneNote, TRASH_NOTEBOOK_ID } from "../../core/syncDecisions.js";

/** 目录行（folders）：树可见的目录节点（listTreeNodes 已滤 trashed_at）。 */
export interface DocCountFolderLike {
  id: string;
  parentId: string | null;
}

/** 文档行（notes）：id/parentId 必给；其余是 core.isGoneNote 的判定原料（缺省 = 活文档）。
 *  调用方喂预滤过 trashed_at 的列表（listNotes）即可，或喂全量行自带 trashedAt —— 两种都按同一判据剔除。 */
export interface DocCountNoteLike {
  id: string;
  parentId: string | null;
  /** 回收站墓碑（级联软删只标它）：非 null 即 gone，不计。 */
  trashedAt?: string | null;
  /** purge 标记行（行保留可恢复）：不计。 */
  isPurged?: boolean;
  /** 同步侧 gone 判定原料（syncState === "purged" 不计）。 */
  syncState?: string;
}

/**
 * 每个树根节点（笔记本卡按笔记本 id 查）子树内的活文档总数。
 * 根节点解析不到（悬空/成环/回收站子树）的文档不计入任何键。
 */
export function notebookSubtreeDocCounts(
  folders: readonly DocCountFolderLike[],
  notes: readonly DocCountNoteLike[],
): Record<string, number> {
  // 父表：folders 与 notes 都可作父（文档下可有多级子文档）；重复 id 取第一个（与树索引同语义）。
  // gone 的文档不进父表：它的子文档在树里同样不可见（listNotebookTree 的 CTE 只沿活跃行下钻）⇒ 链在此断开。
  const parents = new Map<string, string | null>();
  for (const folder of folders) if (!parents.has(folder.id)) parents.set(folder.id, folder.parentId ?? null);
  const gone = (note: DocCountNoteLike): boolean =>
    isGoneNote({ parentId: note.parentId, trashedAt: note.trashedAt, isPurged: note.isPurged, syncState: note.syncState });
  for (const note of notes) if (!gone(note) && !parents.has(note.id)) parents.set(note.id, note.parentId ?? null);

  // id → 所在树根 id；null = 不计（回收站子树 / 悬空 / 成环）。memo 让整链均摊 O(1)。
  const rootOf = new Map<string, string | null>();
  const resolveRoot = (startId: string): string | null => {
    const memo = rootOf.get(startId);
    if (memo !== undefined) return memo;
    const chain: string[] = [];
    const seen = new Set<string>();
    let result: string | null = null;
    let current: string | undefined = startId;
    while (current !== undefined) {
      const cached = rootOf.get(current);
      if (cached !== undefined) { result = cached; break; }
      if (seen.has(current)) { result = null; break; } // 坏库成环：不计
      seen.add(current);
      chain.push(current);
      const parent = parents.get(current);
      if (parent === undefined) { result = null; break; } // 父不在位（悬空）：不计
      if (parent === TRASH_NOTEBOOK_ID) { result = null; break; } // 回收站子树：整支不计
      if (parent === null) { result = current; break; } // 到顶：当前节点就是树根
      current = parent;
    }
    for (const id of chain) rootOf.set(id, result);
    return result;
  };

  const counts: Record<string, number> = {};
  for (const note of notes) {
    if (gone(note)) continue;
    const root = resolveRoot(note.id);
    if (root === null) continue;
    counts[root] = (counts[root] ?? 0) + 1;
  }
  return counts;
}
