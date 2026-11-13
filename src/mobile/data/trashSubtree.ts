/**
 * 移动端回收站「子树」收集 + 软删级联（261114 追加）。
 *
 * 背景：移动端 notes 与 folders 都可以作为父节点（同一棵树），删除**必须整棵子树一起移动**：
 * 桌面 trashLifecycle.deleteTreeNode 是级联；移动端旧实现只动被点的单个 note，
 * 文档下的子文档/子分组会变成 trashed_at=NULL 的悬空行（树里不可见、搜索里还在）。
 *
 * 收集口径与 purge/restore 共用：
 *  - ① parent_id 边（常规未扁平化子树）；
 *  - ② deleted_from_parent_id + trashed_at 边（被同步扁平化成回收站容器后的原始父链）。
 */
import { executeBatchInTransaction, type MobileBatchStatement, type MobileDb } from "./sqliteDb";

export interface ParentedNode {
  id: string;
  parent_id: string | null;
  /** 删除前原始父（回收站平铺后仍保留）：purge/restore 收集塌陷子树时与 parent 一起作为边。 */
  deleted_from_parent_id?: string | null;
  trashed_at?: string | null;
}

export interface SubtreeIds {
  folderIds: Set<string>;
  noteIds: Set<string>;
  allIds: Set<string>;
}

/** P1-6 父环防护：坏库/注入数据下 visited 已保证收敛，这里再加硬上限防算法外异常（内存/耗时兜底）。 */
const MAX_SUBTREE_NODES = 200_000;

/** 收集 folder + note 子树（含自身）：note 也可作为父节点，供删除/恢复/purge 复用。 */
export function collectSubtree(folders: ParentedNode[], notes: ParentedNode[], rootId: string): SubtreeIds {
  const children = new Map<string, Array<{ id: string; kind: "folder" | "note" }>>();
  const addChild = (parentId: string, id: string, kind: "folder" | "note") => {
    const list = children.get(parentId) ?? [];
    list.push({ id, kind });
    children.set(parentId, list);
  };
  for (const folder of folders) {
    if (folder.parent_id) addChild(folder.parent_id, folder.id, "folder");
  }
  for (const note of notes) {
    if (note.parent_id) addChild(note.parent_id, note.id, "note");
  }
  // F-01 同类防护（261112 P0，与桌面 trashLifecycle.purgeSubtreeIds 同口径）：回收站子树可能被同步
  // 「扁平化」——子文档 parent 归一成回收站容器/空，原始父只剩 deleted_from_parent_id。只按 parent_id
  // 遍历会漏掉这些后代 ⇒ purge 只删根、子文档残留并继续以 trashed 条目发布。这里把原始父链也当作一条边
  // （仅对 trashed 行；visited 去重 + MAX_SUBTREE_NODES 上限保证收敛）。
  for (const folder of folders) {
    if (folder.trashed_at && folder.deleted_from_parent_id) addChild(folder.deleted_from_parent_id, folder.id, "folder");
  }
  for (const note of notes) {
    if (note.trashed_at && note.deleted_from_parent_id) addChild(note.deleted_from_parent_id, note.id, "note");
  }

  const rootNode = folders.find((node) => node.id === rootId) ?? notes.find((node) => node.id === rootId);
  const subtree: SubtreeIds = { folderIds: new Set(), noteIds: new Set(), allIds: new Set() };
  if (!rootNode) return subtree;

  const queue: Array<{ id: string; kind: "folder" | "note" }> = [];
  const visit = (id: string, kind: "folder" | "note") => {
    if (subtree.allIds.has(id)) return;
    subtree.allIds.add(id);
    if (kind === "folder") subtree.folderIds.add(id);
    else subtree.noteIds.add(id);
    queue.push({ id, kind });
  };
  visit(rootId, folders.some((node) => node.id === rootId) ? "folder" : "note");

  while (queue.length > 0) {
    if (subtree.allIds.size >= MAX_SUBTREE_NODES) {
      console.warn("[trash] 子树节点数超过防御上限，已截断收集:", rootId, subtree.allIds.size);
      break;
    }
    const parent = queue.shift()!;
    for (const child of children.get(parent.id) ?? []) visit(child.id, child.kind);
  }
  return subtree;
}

/** 读全量 folders + notes 供 collectSubtree 使用（一次查询，避免 N+1）。 */
export async function loadParentedNodes(d: MobileDb): Promise<{ folders: ParentedNode[]; notes: ParentedNode[] }> {
  const folders = await d.prepare("SELECT id, parent_id, deleted_from_parent_id, trashed_at FROM folders").all() as unknown as ParentedNode[];
  const notes = await d.prepare("SELECT id, parent_id, deleted_from_parent_id, trashed_at FROM notes").all() as unknown as ParentedNode[];
  return { folders, notes };
}

/** 软删整棵子树（含根）：parent_id 不动、全部标 trashed_at + 删除前父；返回子树内 note id。 */
export async function trashSubtree(d: MobileDb, rootId: string, now = new Date().toISOString()): Promise<string[]> {
  const { folders, notes } = await loadParentedNodes(d);
  const subtree = collectSubtree(folders, notes, rootId);
  if (subtree.allIds.size === 0) return [];
  const statements: MobileBatchStatement[] = [];
  for (const fid of Array.from(subtree.folderIds)) {
    statements.push({
      statement: "UPDATE folders SET trashed_at=?, is_dirty=1, updated_at=?, deleted_from_parent_id=COALESCE(deleted_from_parent_id, parent_id) WHERE id=? AND trashed_at IS NULL",
      values: [now, now, fid],
    });
  }
  for (const nid of Array.from(subtree.noteIds)) {
    statements.push({
      statement: "UPDATE notes SET trashed_at=?, is_dirty=1, restore_pending_at=NULL, deleted_from_parent_id=COALESCE(deleted_from_parent_id, parent_id), updated_at=? WHERE id=? AND trashed_at IS NULL",
      values: [now, now, nid],
    });
  }
  await executeBatchInTransaction(d, statements);
  return Array.from(subtree.noteIds);
}
