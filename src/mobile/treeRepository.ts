import type { DbLike } from "./sqliteDb";
import type { TreeNode, TreeNodeType } from "../lib/types";
import {
  assertMoveTarget,
  assertNodeIcon,
  assertOrderedChildren,
  assertRootConstraint,
  assertTreeNodeTitle,
  nextSortOrder,
} from "../core/treeRules.js";

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

export async function listTreeNodes(d: DbLike): Promise<TreeNode[]> {
  const rows = d.prepare(
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

export async function createNotebook(d: DbLike, input: { title: string; icon: string | null }): Promise<TreeNode> {
  const title = assertTreeNodeTitle(input.title);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxRow = d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id IS NULL AND trashed_at IS NULL").get() as { m: number | null } | undefined;
  const sortOrder = nextSortOrder(maxRow?.m ?? null);
  d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,NULL,?,?,?,?,'local')")
    .run(id, title, sortOrder, "notebook", null, now);
  if (input.icon) {
    d.prepare("UPDATE folders SET icon = ?, sync_state = 'local' WHERE id = ?").run(input.icon, id);
  }
  const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
  return folderRowToTreeNode(row, { title, updatedAt: now, icon: input.icon ?? null });
}

export async function createGroup(d: DbLike, parentId: string, title: string): Promise<TreeNode> {
  const trimmed = assertTreeNodeTitle(title);
  const parent = d.prepare("SELECT 1 FROM folders WHERE id = ? AND trashed_at IS NULL").get(parentId);
  if (!parent) throw new Error("父节点不存在: " + parentId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const maxRow = d.prepare("SELECT MAX(sort_order) AS m FROM folders WHERE parent_id = ? AND trashed_at IS NULL").get(parentId) as { m: number | null } | undefined;
  const sortOrder = nextSortOrder(maxRow?.m ?? null);
  d.prepare("INSERT INTO folders (id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state) VALUES (?,?,?,?,?,?,?,'local')")
    .run(id, trimmed, parentId, sortOrder, "group", null, now);
  const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
  return folderRowToTreeNode(row, { title: trimmed, updatedAt: now });
}

export async function renameTreeNode(d: DbLike, id: string, title: string): Promise<TreeNode> {
  const trimmed = assertTreeNodeTitle(title);
  const now = new Date().toISOString();
  const changed = d.prepare("UPDATE folders SET title=?, updated_at=?, sync_state='local' WHERE id=?").run(trimmed, now, id).changes;
  if (!changed) throw new Error("节点不存在: " + id);
  const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
  return folderRowToTreeNode(row, { title: trimmed, updatedAt: now });
}

export async function setNodeIcon(d: DbLike, id: string, icon: string | null): Promise<TreeNode> {
  assertNodeIcon(icon);
  const now = new Date().toISOString();
  const folder = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at, sync_state FROM folders WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (folder) {
    d.prepare("UPDATE folders SET icon=?, updated_at=?, sync_state='local' WHERE id=?").run(icon, now, id);
    const row = { ...folder, icon, updated_at: now, sync_state: "local" };
    return folderRowToTreeNode(row, { icon, updatedAt: now });
  }
  const note = d.prepare("SELECT id, title, parent_id, sort_order, icon, updated_at, sync_state, is_conflict FROM notes WHERE id=? AND trashed_at IS NULL").get(id) as Record<string, unknown> | undefined;
  if (!note) throw new Error("节点不存在: " + id);
  d.prepare("UPDATE notes SET icon=?, updated_at=?, sync_state='local' WHERE id=?").run(icon, now, id);
  const row = { ...note, icon, updated_at: now, sync_state: "local" };
  return noteRowToTreeNode(row, { icon, updatedAt: now });
}

export async function moveTreeNodeOrdered(d: DbLike, id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode> {
  const moving = d.prepare("SELECT node_type FROM folders WHERE id = ? AND trashed_at IS NULL").get(id) as { node_type: string } | undefined;
  if (!moving) throw new Error("节点不存在: " + id);
  assertRootConstraint(moving.node_type, parentId);

  const all = d.prepare("SELECT id, parent_id FROM folders WHERE trashed_at IS NULL").all() as Array<{ id: string; parent_id: string | null }>;
  const descendants = new Set<string>();
  const childrenMap = new Map<string, string[]>();
  for (const f of all) {
    const list = childrenMap.get(f.parent_id ?? "") ?? [];
    list.push(f.id);
    childrenMap.set(f.parent_id ?? "", list);
  }
  const walk = (nodeId: string) => {
    for (const c of childrenMap.get(nodeId) ?? []) {
      if (!descendants.has(c)) { descendants.add(c); walk(c); }
    }
  };
  walk(id);
  const parentExists = parentId === null || all.some((f) => f.id === parentId);
  assertMoveTarget(id, parentId, descendants, parentExists);
  const currentChildren = (childrenMap.get(parentId ?? "") ?? []).filter((cid) => cid !== id);
  assertOrderedChildren(orderedIds, currentChildren, id);

  const now = new Date().toISOString();
  const tx = d.transaction(() => {
    d.prepare("UPDATE folders SET parent_id=?, updated_at=?, sync_state='local' WHERE id=?").run(parentId, now, id);
    orderedIds.forEach((childId, index) => {
      d.prepare("UPDATE folders SET sort_order=?, updated_at=?, sync_state='local' WHERE id=?").run(index, now, childId);
    });
  });
  tx();
  const row = d.prepare("SELECT id, title, parent_id, sort_order, node_type, icon, updated_at FROM folders WHERE id=?").get(id) as Record<string, unknown>;
  return folderRowToTreeNode(row, { parentId, updatedAt: now });
}

export async function reorderSiblings(d: DbLike, parentId: string | null, orderedIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  const tx = d.transaction(() => {
    orderedIds.forEach((childId, index) => {
      d.prepare("UPDATE folders SET sort_order=?, updated_at=?, sync_state='local' WHERE id=? AND trashed_at IS NULL").run(index, now, childId);
    });
  });
  tx();
}
