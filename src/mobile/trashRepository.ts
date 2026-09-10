import { sqlParameterBatches } from "../core/sqlParameterBatch.js";
import type { DbLike } from "./sqliteDb";

interface ParentedNode {
  id: string;
  parent_id: string | null;
}

interface SubtreeIds {
  folderIds: Set<string>;
  noteIds: Set<string>;
  allIds: Set<string>;
}

/** 收集 folder + note 子树（含自身）：note 也可作为父节点，供删除/恢复/purge 复用。 */
function collectSubtree(folders: ParentedNode[], notes: ParentedNode[], rootId: string): SubtreeIds {
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
  visit(rootNode.id, folders.some((node) => node.id === rootId) ? "folder" : "note");

  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of children.get(parent.id) ?? []) visit(child.id, child.kind);
  }
  return subtree;
}

export function trashTreeItem(d: DbLike, id: string, kind: "folder" | "note"): void {
  const tx = d.transaction(() => {
    const now = new Date().toISOString();
    if (kind === "note") {
      d.prepare("UPDATE notes SET trashed_at=?, sync_state='local', restore_pending_at=NULL WHERE id=?").run(now, id);
      return;
    }

    const allFolders = d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
    const allNotes = d.prepare("SELECT id, parent_id FROM notes").all() as Array<{ id: string; parent_id: string | null }>;
    const subtree = collectSubtree(allFolders, allNotes, id);
    const folderIdList = Array.from(subtree.folderIds);
    if (folderIdList.length === 0) return;

    const noteRows: Array<{ id: string }> = [];
    for (const batch of sqlParameterBatches(folderIdList)) {
      const ph = batch.map(() => "?").join(",");
      d.prepare("UPDATE folders SET trashed_at=?, sync_state='local', updated_at=? WHERE id IN (" + ph + ") AND trashed_at IS NULL").run(now, now, ...batch);
    }
    for (const batch of sqlParameterBatches(Array.from(subtree.allIds))) {
      const ph = batch.map(() => "?").join(",");
      noteRows.push(...d.prepare("SELECT id FROM notes WHERE parent_id IN (" + ph + ") AND trashed_at IS NULL").all(...batch) as Array<{ id: string }>);
    }
    for (const n of noteRows) {
      d.prepare("UPDATE notes SET trashed_at=?, sync_state='local', restore_pending_at=NULL, updated_at=? WHERE id=?").run(now, now, n.id);
    }
  });
  tx();
}

export function listTrashTree(d: DbLike): Array<{ id: string; title: string; kind: "folder" | "note"; parentId: string | null; deletedAt: string | null }> {
  const folders = d.prepare("SELECT id, title, parent_id, trashed_at FROM folders WHERE trashed_at IS NOT NULL").all() as Array<{ id: string; title: string; parent_id: string | null; trashed_at: string | null }>;
  const notes = d.prepare("SELECT id, title, parent_id, trashed_at FROM notes WHERE trashed_at IS NOT NULL").all() as Array<{ id: string; title: string; parent_id: string | null; trashed_at: string | null }>;
  return [
    ...folders.map((f) => ({ id: f.id, title: f.title, kind: "folder" as const, parentId: f.parent_id, deletedAt: f.trashed_at })),
    ...notes.map((n) => ({ id: n.id, title: n.title, kind: "note" as const, parentId: n.parent_id, deletedAt: n.trashed_at })),
  ].sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
}

export async function restoreTreeItem(
  d: DbLike,
  id: string,
  kind: "folder" | "note",
  downloadAssets: (noteIds: string[]) => Promise<void>,
): Promise<void> {
  let folderIds: string[] = [];
  let restoreNoteIds: string[] = [];
  if (kind === "note") {
    restoreNoteIds = [id];
  } else {
    const allFolders = d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
    const allNotes = d.prepare("SELECT id, parent_id FROM notes").all() as Array<{ id: string; parent_id: string | null }>;
    const subtree = collectSubtree(allFolders, allNotes, id);
    folderIds = Array.from(subtree.folderIds);
    restoreNoteIds = sqlParameterBatches(Array.from(subtree.noteIds)).flatMap((batch) =>
      d.prepare("SELECT id FROM notes WHERE id IN (" + batch.map(() => "?").join(",") + ") AND trashed_at IS NOT NULL").all(...batch) as Array<{ id: string }>
    ).map((n) => n.id);
  }
  await downloadAssets(restoreNoteIds);

  if (kind === "note") {
    const now = new Date().toISOString();
    d.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, sync_state='local' WHERE id=?").run(now, id);
    return;
  }

  const tx = d.transaction(() => {
    const now = new Date().toISOString();
    for (const fid of folderIds) {
      d.prepare("UPDATE folders SET trashed_at=NULL, updated_at=?, sync_state='local' WHERE id=?").run(now, fid);
    }
    for (const nid of restoreNoteIds) {
      d.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, sync_state='local', updated_at=? WHERE id=?").run(now, now, nid);
    }
  });
  tx();
}

export function purgeTreeItem(d: DbLike, id: string, kind: "folder" | "note"): void {
  const tx = d.transaction(() => {
    const now = new Date().toISOString();
    const writeTombstone = d.prepare(
      "INSERT OR REPLACE INTO deleted_notes (id, title, parent_id, sort_order, updated_at, deleted_at, node_type, purged_at) VALUES (?,?,?,?,?,?,?,?)"
    );
    if (kind === "note") {
      const row = d.prepare("SELECT id, title, parent_id, sort_order, updated_at FROM notes WHERE id=?").get(id) as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
      if (row) writeTombstone.run(row.id, row.title, row.parent_id, row.sort_order, row.updated_at, now, "note", now);
      d.prepare("DELETE FROM notes WHERE id=?").run(id);
      d.prepare("DELETE FROM sync_base WHERE note_id=?").run(id);
      d.prepare("DELETE FROM note_history WHERE note_id=?").run(id);
      return;
    }

    const allFolders = d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
    const allNotes = d.prepare("SELECT id, parent_id FROM notes").all() as Array<{ id: string; parent_id: string | null }>;
    const subtree = collectSubtree(allFolders, allNotes, id);
    for (const fid of subtree.folderIds) {
      const f = d.prepare("SELECT title, parent_id, sort_order, updated_at FROM folders WHERE id=?").get(fid) as { title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
      if (f) writeTombstone.run(fid, f.title, f.parent_id, f.sort_order, f.updated_at, now, "folder", now);
      d.prepare("DELETE FROM folders WHERE id=?").run(fid);
    }
    const noteIds = sqlParameterBatches(Array.from(subtree.noteIds)).flatMap((batch) =>
      d.prepare("SELECT id, title, parent_id, sort_order, updated_at FROM notes WHERE id IN (" + batch.map(() => "?").join(",") + ")").all(...batch) as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string }>
    );
    for (const n of noteIds) {
      writeTombstone.run(n.id, n.title, n.parent_id, n.sort_order, n.updated_at, now, "note", now);
      d.prepare("DELETE FROM notes WHERE id=?").run(n.id);
      d.prepare("DELETE FROM sync_base WHERE note_id=?").run(n.id);
      d.prepare("DELETE FROM note_history WHERE note_id=?").run(n.id);
    }
  });
  tx();
}
