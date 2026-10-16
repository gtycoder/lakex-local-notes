import type { MobileDb } from "./sqliteDb";
import type { TreeNode, TreeNodeType } from "../../lib/types";
import {
  assertMoveTarget,
  assertNodeIcon,
  assertOrderedChildren,
  assertRootConstraint,
  assertTreeNodeTitle,
  nextSortOrder,
} from "../../core/treeRules.js";

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
    syncState: String(row.sync_state ?? "local") as TreeNode["syncState"],
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
    syncState: "local",
    isConflict: false,
    icon: overrides.icon !== undefined ? overrides.icon : (row.icon ? String(row.icon) : null),
  };
}

export async function listTreeNodes(d: MobileDb): Promise<TreeNode[]> {
  const rows = await d.prepare(
    "SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, trashed_at, deleted_from_parent_id, sync_state FROM folders WHERE trashed_at IS NULL ORDER BY parent_id, sort_order",
  ).all() as Array<{
    id: string; title: string; parent_id: string | null; sort_order: number; node_type: string; icon: string | null; updated_at: string; trashed_at: string | null; deleted_from_parent_id: string | null; sync_state: string;
  }>;
  return rows.map((r) => ({
    id: r.id, workspaceId: "mobile", parentId: r.parent_id, nodeType: r.node_type as TreeNodeType,
    title: r.title, noteFileId: null, sortOrder: r.sort_order, createdAt: r.updated_at, updatedAt: r.updated_at,
    syncState: r.sync_state as TreeNode["syncState"], isConflict: false, icon: r.icon ?? null,
  }));
}

export async function createNotebook(d: MobileDb, input: { title: string; icon: string | null }): Promise<TreeNode> {
  const title = assertTreeNodeTitle(input.title);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxRow = await d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id IS NULL AND trashed_at IS NULL").get() as { m: number | null } | undefined;
  const sortOrder = nextSortOrder(maxRow?.m ?? null);
  await d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,NULL,?,?,?,?,'local')")
    .run(id, title, sortOrder, "notebook", null, now);
  if (input.icon) {
    await d.prepare("UPDATE folders SET icon = ?, sync_state = 'local' WHERE id = ?").run(input.icon, id);
  }
  const row = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
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
  await d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,?,?,?,?,?,'local')")
    .run(id, trimmed, parentId, sortOrder, "group", null, now);
  const row = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
  return folderRowToTreeNode(row, { title: trimmed, updatedAt: now });
}

export async function renameTreeNode(d: MobileDb, id: string, title: string): Promise<TreeNode> {
  const trimmed = assertTreeNodeTitle(title);
  const now = new Date().toISOString();
  const changedFolder = (await d.prepare("UPDATE folders SET title=?, updated_at=?, sync_state='local' WHERE id=?").run(trimmed, now, id)).changes;
  if (changedFolder) {
    const row = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
    return folderRowToTreeNode(row, { title: trimmed, updatedAt: now });
  }
  // 文档（notes）也是目录树节点：移动端长按重命名 / 顶栏改名都走这里；与桌面 renameTreeNode 语义对齐。
  const changedNote = (await d.prepare("UPDATE notes SET title=?, updated_at=?, sync_state='local' WHERE id=? AND trashed_at IS NULL").run(trimmed, now, id)).changes;
  if (changedNote) {
    const row = await d.prepare("SELECT id, title, parent_id, sort_order, icon, updated_at, sync_state, is_conflict FROM notes WHERE id=?").get(id) as Record<string, unknown>;
    return noteRowToTreeNode(row, { title: trimmed, updatedAt: now });
  }
  throw new Error("节点不存在: " + id);
}

export async function setNodeIcon(d: MobileDb, id: string, icon: string | null): Promise<TreeNode> {
  assertNodeIcon(icon);
  const now = new Date().toISOString();
  const folder = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state FROM folders WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (folder) {
    await d.prepare("UPDATE folders SET icon=?, updated_at=?, sync_state='local' WHERE id=?").run(icon, now, id);
    const row = { ...folder, icon, updated_at: now, sync_state: "local" };
    return folderRowToTreeNode(row, { icon, updatedAt: now });
  }
  const note = await d.prepare("SELECT id, title, parent_id, sort_order, icon, updated_at, sync_state, is_conflict FROM notes WHERE id=? AND trashed_at IS NULL").get(id) as Record<string, unknown> | undefined;
  if (!note) throw new Error("节点不存在: " + id);
  await d.prepare("UPDATE notes SET icon=?, updated_at=?, sync_state='local' WHERE id=?").run(icon, now, id);
  const row = { ...note, icon, updated_at: now, sync_state: "local" };
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
  await d.transaction(async () => {
    if (movedInFolders) {
      await d.prepare("UPDATE folders SET parent_id=?, updated_at=?, sync_state='local' WHERE id=?").run(parentId, now, id);
    } else {
      await d.prepare("UPDATE notes SET parent_id=?, updated_at=?, sync_state='local' WHERE id=?").run(parentId, now, id);
    }
    for (const [index, childId] of orderedIds.entries()) {
      if (folderIds.has(childId)) {
        await d.prepare("UPDATE folders SET sort_order=?, updated_at=?, sync_state='local' WHERE id=?").run(index, now, childId);
      } else {
        await d.prepare("UPDATE notes SET sort_order=?, updated_at=?, sync_state='local' WHERE id=?").run(index, now, childId);
      }
    }
  });
  if (movedInFolders) {
    const row = await d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
    return folderRowToTreeNode(row, { parentId, updatedAt: now });
  }
  const row = await d.prepare("SELECT id, title, parent_id, sort_order, icon, updated_at, sync_state, is_conflict FROM notes WHERE id=?").get(id) as Record<string, unknown>;
  return noteRowToTreeNode(row, { parentId, updatedAt: now });
}

export async function reorderSiblings(d: MobileDb, parentId: string | null, orderedIds: string[]): Promise<void> {
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
  await d.transaction(async () => {
    for (const [index, childId] of orderedIds.entries()) {
      if (folderIds.has(childId)) {
        await d.prepare("UPDATE folders SET sort_order=?, updated_at=?, sync_state='local' WHERE id=? AND trashed_at IS NULL").run(index, now, childId);
      } else {
        await d.prepare("UPDATE notes SET sort_order=?, updated_at=?, sync_state='local' WHERE id=? AND trashed_at IS NULL").run(index, now, childId);
      }
    }
  });
}
