import { executeBatch, type MobileBatchStatement, type MobileDb } from "./sqliteDb";
import type { TreeNode, TreeNodeType } from "../../lib/types";
import {
  assertMoveTarget,
  assertNodeIcon,
  assertOrderedChildren,
  assertRootConstraint,
  assertTreeNodeTitle,
  nextSortOrder,
} from "../../core/treeRules.js";
import { DIARY_FOLDER_SPACE, normalizeFolderSpace, type DiaryFolderSpace } from "../../core/diary.js";

function noteRowToTreeNode(
  row: Record<string, unknown>,
  overrides: { updatedAt?: string; title?: string; icon?: string | null; parentId?: string | null } = {},
): TreeNode {
  return {
    id: String(row.id),
    workspaceId: "mobile",
    parentId: overrides.parentId !== undefined ? overrides.parentId : (row.parent_id ? String(row.parent_id) : null),
    nodeType: "note",
    title: overrides.title ?? String(row.title),
    noteFileId: String(row.id),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.updated_at),
    updatedAt: overrides.updatedAt ?? String(row.updated_at),
    isConflict: Boolean(row.is_conflict),
    icon: overrides.icon !== undefined ? overrides.icon : (row.icon ? String(row.icon) : null),
  };
}

function folderRowToTreeNode(
  row: Record<string, unknown>,
  overrides: { updatedAt?: string; title?: string; icon?: string | null; parentId?: string | null } = {},
): TreeNode {
  return {
    id: String(row.id),
    workspaceId: "mobile",
    parentId: overrides.parentId !== undefined ? overrides.parentId : (row.parent_id ? String(row.parent_id) : null),
    nodeType: String(row.node_type) as TreeNodeType,
    title: overrides.title ?? String(row.title),
    noteFileId: null,
    sortOrder: Number(row.sort_order),
    createdAt: String(row.updated_at),
    updatedAt: overrides.updatedAt ?? String(row.updated_at),
    isConflict: false,
    icon: overrides.icon !== undefined ? overrides.icon : (row.icon ? String(row.icon) : null),
    // 空间标记（261109）：未知值一律当非日记（core/diary.normalizeFolderSpace），wire 读取同口径。
    space: normalizeFolderSpace(row.space),
  };
}

export async function listTreeNodes(d: MobileDb): Promise<TreeNode[]> {
  const rows = await d.prepare(
    "SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, trashed_at, deleted_from_parent_id, space FROM folders WHERE trashed_at IS NULL ORDER BY parent_id, sort_order",
  ).all() as Array<{
    id: string; title: string; parent_id: string | null; sort_order: number; node_type: string; icon: string | null; updated_at: string; trashed_at: string | null; deleted_from_parent_id: string | null; space: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id, workspaceId: "mobile", parentId: r.parent_id, nodeType: r.node_type as TreeNodeType,
    title: r.title, noteFileId: null, sortOrder: r.sort_order, createdAt: r.updated_at, updatedAt: r.updated_at,
    isConflict: false, icon: r.icon ?? null, space: normalizeFolderSpace(r.space),
  }));
}

export async function createNotebook(
  d: MobileDb,
  input: { title: string; icon: string | null; /** 空间标记（261109 日记本 = "diary"）；缺省/null = 普通知识库。 */ space?: DiaryFolderSpace | null },
): Promise<TreeNode> {
  const title = assertTreeNodeTitle(input.title);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxRow = await d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id IS NULL AND trashed_at IS NULL").get() as { m: number | null } | undefined;
  const sortOrder = nextSortOrder(maxRow?.m ?? null);
  await d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, is_dirty, space) VALUES (?,?,NULL,?,?,?,?,1,?)")
    .run(id, title, sortOrder, "notebook", null, now, normalizeFolderSpace(input.space));
  if (input.icon) {
    await d.prepare("UPDATE folders SET icon = ?, is_dirty = 1 WHERE id = ?").run(input.icon, id);
  }
  const row = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, space FROM folders WHERE id=?").get(id) as Record<string, unknown>;
  return folderRowToTreeNode(row, { title, updatedAt: now, icon: input.icon ?? null });
}

export async function createGroup(d: MobileDb, parentId: string, title: string): Promise<TreeNode> {
  const trimmed = assertTreeNodeTitle(title);
  const parent = await d.prepare("SELECT 1 FROM folders WHERE id = ? AND trashed_at IS NULL").get(parentId);
  if (!parent) throw new Error("父节点不存在: " + parentId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxRow = await d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id = ? AND trashed_at IS NULL").get(parentId) as { m: number | null } | undefined;
  const sortOrder = nextSortOrder(maxRow?.m ?? null);
  await d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, is_dirty) VALUES (?,?,?,?,?,?,?,1)")
    .run(id, trimmed, parentId, sortOrder, "group", null, now);
  const row = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
  return folderRowToTreeNode(row, { title: trimmed, updatedAt: now });
}

/**
 * 日记子树归属（261113 用户裁决，AGENTS §3#25②；与桌面 `noteMetadataRepository.diaryNotebookOf` 同口径）：
 * 沿 parent 链（folders ∪ notes —— 移动端文档也能作父）向上找 `space="diary"` 的笔记本，只认 space 不看标题。
 * 返回日记本 id；null = 不在日记子树（节点不存在也返回 null，交给调用方的 NotFound 判据）。visited 防坏库成环。
 *
 * **判据只有一个**（调用方不要另写）：
 *  · `diaryNotebookOf(id) === id` ⇒ 日记本**本身**：改名 / 换图标放行；
 *  · `diaryNotebookOf(id) !== null && !== id` ⇒ 日记子树（年/月分组、日记条目）：改名/图标/移动/排序/删除全部拒绝。
 */
export async function diaryNotebookOf(d: MobileDb, id: string): Promise<string | null> {
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = await d.prepare("SELECT node_type, space, parent_id FROM folders WHERE id=?").get(current) as
      { node_type?: string; space?: string | null; parent_id?: string | null } | undefined;
    if (folder) {
      if (folder.node_type === "notebook" && normalizeFolderSpace(folder.space) === DIARY_FOLDER_SPACE) return current;
      current = folder.parent_id ?? null;
      continue;
    }
    const note = await d.prepare("SELECT parent_id FROM notes WHERE id=?").get(current) as { parent_id?: string | null } | undefined;
    if (!note) return null;
    current = note.parent_id ?? null;
  }
  return null;
}

export async function renameTreeNode(d: MobileDb, id: string, title: string): Promise<TreeNode> {
  const trimmed = assertTreeNodeTitle(title);
  const now = new Date().toISOString();
  const diaryNotebookId = await diaryNotebookOf(d, id);
  const folderRow = await d.prepare("SELECT id FROM folders WHERE id=?").get(id);
  if (folderRow) {
    // 261113 用户裁决：日记本**本身**可以改名；年/月分组仍拒绝（顺序与标题都由日期派生）。
    if (diaryNotebookId !== null && diaryNotebookId !== id) {
      throw new Error("日记里的分组不能改名（只有日记本本身可以）");
    }
    await d.prepare("UPDATE folders SET title=?, updated_at=?, is_dirty=1 WHERE id=?").run(trimmed, now, id);
    const row = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
    return folderRowToTreeNode(row, { title: trimmed, updatedAt: now });
  }
  // 文档（notes）也是目录树节点：移动端长按重命名 / 顶栏改名都走这里；与桌面 renameTreeNode 语义对齐。
  // 261110 标题锁：日记条目标题只能是日期（与桌面 core.isDiaryEntryNode 同一契约，数据层最后一道闸）。
  if (diaryNotebookId !== null) {
    throw new Error("日记标题就是日期，不能改");
  }
  const changedNote = (await d.prepare("UPDATE notes SET title=?, updated_at=?, is_dirty=1 WHERE id=? AND trashed_at IS NULL").run(trimmed, now, id)).changes;
  if (changedNote) {
    const row = await d.prepare("SELECT id, title, parent_id, sort_order, icon, updated_at, is_dirty, is_conflict FROM notes WHERE id=?").get(id) as Record<string, unknown>;
    return noteRowToTreeNode(row, { title: trimmed, updatedAt: now });
  }
  throw new Error("节点不存在: " + id);
}

export async function setNodeIcon(d: MobileDb, id: string, icon: string | null): Promise<TreeNode> {
  assertNodeIcon(icon);
  const now = new Date().toISOString();
  const folder = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown> | undefined;
  const diaryNotebookId = await diaryNotebookOf(d, id);
  if (folder) {
    // 261113 用户裁决：日记本本身可以换图标；年/月分组仍拒绝（与桌面 setNodeIcon 同口径）。
    if (diaryNotebookId !== null && diaryNotebookId !== id) {
      throw new Error("日记里的分组不能换图标（只有日记本本身可以）");
    }
    await d.prepare("UPDATE folders SET icon=?, updated_at=?, is_dirty=1 WHERE id=?").run(icon, now, id);
    const row = { ...folder, icon, updated_at: now };
    return folderRowToTreeNode(row, { icon, updatedAt: now });
  }
  const note = await d.prepare("SELECT id, title, parent_id, sort_order, icon, updated_at, is_dirty, is_conflict FROM notes WHERE id=? AND trashed_at IS NULL").get(id) as Record<string, unknown> | undefined;
  if (!note) throw new Error("节点不存在: " + id);
  // 日记条目同样属于日记子树（标题/图标都由日期派生；桌面 setNodeIcon 也拒绝）。
  if (diaryNotebookId !== null) throw new Error("日记条目不能换图标");
  await d.prepare("UPDATE notes SET icon=?, updated_at=?, is_dirty=1 WHERE id=?").run(icon, now, id);
  const row = { ...note, icon, updated_at: now };
  return noteRowToTreeNode(row, { icon, updatedAt: now });
}

export async function moveTreeNodeOrdered(d: MobileDb, id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode> {
  // 被移动节点可能是 folder（notebook/group）或 note（文档）。此前只查 folders，
  // 导致文档"移动到…"必然抛"节点不存在"（长按菜单里点了就报"移动失败"）。
  // 对齐桌面 moveTreeNodeOrdered：同时处理两表（移动端 notes 也能作父，见 listNotebookTree）。
  const movingFolder = await d.prepare("SELECT node_type FROM folders WHERE id = ? AND trashed_at IS NULL").get(id) as { node_type: string } | undefined;
  const movingNote = movingFolder ? undefined : await d.prepare("SELECT id FROM notes WHERE id = ? AND trashed_at IS NULL").get(id) as { id: string } | undefined;
  if (!movingFolder && !movingNote) throw new Error("节点不存在: " + id);
  const nodeType = movingFolder ? movingFolder.node_type : "note";
  // 日记守卫（261113；与桌面 noteMetadataRepository.assertDiaryMove 同口径，判据只用 diaryNotebookOf）：
  // 日记本本身不可移、日记子树里的分组不可移、日记内部不可调位置、日记空间不可作为移动目标。
  // 唯一放行 = 「单篇日记整篇移出到普通笔记本」（= 出口①「转为文档」）。
  const movingDiary = await diaryNotebookOf(d, id);
  const targetDiary = parentId === null ? null : await diaryNotebookOf(d, parentId);
  if (movingDiary === id) throw new Error("日记本是固定特殊笔记本，不能移动；只允许把里面的单篇日记转成文档移出: " + id);
  if (movingDiary !== null && nodeType !== "note") throw new Error("日记里的分组不能移动；只允许把单篇日记转成文档移出: " + id);
  if (movingDiary !== null && targetDiary !== null) throw new Error("日记内容顺序是派生的，不能调整位置/排序: " + id);
  if (targetDiary !== null) throw new Error("日记本不能作为移动目标（不支持把文档移入日记空间）: " + parentId);
  assertRootConstraint(nodeType, parentId);

  const folderRows = await d.prepare("SELECT id, parent_id FROM folders WHERE trashed_at IS NULL").all() as Array<{ id: string; parent_id: string | null }>;
  const noteRows = await d.prepare("SELECT id, parent_id FROM notes WHERE trashed_at IS NULL").all() as Array<{ id: string; parent_id: string | null }>;
  const all = [...folderRows, ...noteRows];
  const descendants = new Set<string>();
  const childrenMap = new Map<string, string[]>();
  for (const n of all) {
    const list = childrenMap.get(n.parent_id ?? "") ?? [];
    list.push(n.id);
    childrenMap.set(n.parent_id ?? "", list);
  }
  const walk = (nodeId: string) => {
    for (const c of childrenMap.get(nodeId) ?? []) {
      if (!descendants.has(c)) { descendants.add(c); walk(c); }
    }
  };
  walk(id);
  const validIds = new Set(all.map((n) => n.id));
  const parentExists = parentId === null || validIds.has(parentId);
  assertMoveTarget(id, parentId, descendants, parentExists);
  const currentChildren = (childrenMap.get(parentId ?? "") ?? []).filter((cid) => cid !== id);
  assertOrderedChildren(orderedIds, currentChildren, id);

  const now = new Date().toISOString();
  const folderIds = new Set(folderRows.map((r) => r.id));
  const movedInFolders = folderIds.has(id);
  const statements: MobileBatchStatement[] = [movedInFolders
    ? { statement: "UPDATE folders SET parent_id=?, updated_at=?, is_dirty=1 WHERE id=?", values: [parentId, now, id] }
    : { statement: "UPDATE notes SET parent_id=?, updated_at=?, is_dirty=1 WHERE id=?", values: [parentId, now, id] }];
  for (const [index, childId] of orderedIds.entries()) {
    statements.push(folderIds.has(childId)
      ? { statement: "UPDATE folders SET sort_order=?, updated_at=?, is_dirty=1 WHERE id=?", values: [index, now, childId] }
      : { statement: "UPDATE notes SET sort_order=?, updated_at=?, is_dirty=1 WHERE id=?", values: [index, now, childId] });
  }
  await executeBatch(d, statements);
  if (movedInFolders) {
    const row = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
    return folderRowToTreeNode(row, { parentId, updatedAt: now });
  }
  const row = await d.prepare("SELECT id, title, parent_id, sort_order, icon, updated_at, is_dirty, is_conflict FROM notes WHERE id=?").get(id) as Record<string, unknown>;
  return noteRowToTreeNode(row, { parentId, updatedAt: now });
}

export async function reorderSiblings(d: MobileDb, parentId: string | null, orderedIds: string[]): Promise<void> {
  // 日记内容的顺序是 core 派生（年→月→日期），sort_order 不可由用户改（261113；与桌面 reorderTreeNodes 同口径）。
  // 父级在日记子树（含日记本本身）⇒ 整批拒绝；日记本本身也不得参与任何父级下的排序。
  if (parentId !== null) {
    const parentDiary = await diaryNotebookOf(d, parentId);
    if (parentDiary !== null) throw new Error("日记内容顺序是派生的，不能排序: " + parentId);
  }
  for (const id of orderedIds) {
    if (await diaryNotebookOf(d, id) === id) throw new Error("日记本是固定特殊笔记本，不能参与排序: " + id);
  }
  const now = new Date().toISOString();
  // 同级列表是 folders + notes 混合（listNotebookTree 混合排序）——必须按 id 归属写回各自表，
  // 否则文档的 sort_order 永远不动（与"移动"同一个坑）。
  const folderRows = await d.prepare("SELECT id, parent_id FROM folders WHERE trashed_at IS NULL").all() as Array<{ id: string; parent_id: string | null }>;
  const noteRows = await d.prepare("SELECT id, parent_id FROM notes WHERE trashed_at IS NULL").all() as Array<{ id: string; parent_id: string | null }>;
  const folderIds = new Set(folderRows.map((r) => r.id));
  // 服务端校验（对齐桌面 reorderTreeNodes）：列表不得重复、必须恰好是该父节点的全部子节点。
  const currentChildren = [...folderRows, ...noteRows].filter((r) => (r.parent_id ?? null) === parentId).map((r) => r.id);
  if (currentChildren.length > 0) {
    assertOrderedChildren(orderedIds, currentChildren, currentChildren[0]);
  } else if (orderedIds.length > 0) {
    throw new Error("重排列表包含不属于该父节点的节点");
  }
  await executeBatch(d, orderedIds.map((childId, index) => folderIds.has(childId)
    ? { statement: "UPDATE folders SET sort_order=?, updated_at=?, is_dirty=1 WHERE id=? AND trashed_at IS NULL", values: [index, now, childId] }
    : { statement: "UPDATE notes SET sort_order=?, updated_at=?, is_dirty=1 WHERE id=? AND trashed_at IS NULL", values: [index, now, childId] }));
}
