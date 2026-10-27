import { sqlParameterBatches } from "../../core/sqlParameterBatch.js";
import { executeBatchInTransaction, type MobileBatchStatement, type MobileDb } from "./sqliteDb";
import { deleteNoteBodies, deleteHistorySnapshot } from "./noteBodies.js";

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

export async function trashTreeItem(d: MobileDb, id: string, kind: "folder" | "note"): Promise<void> {
  await d.transaction(async () => {
    const now = new Date().toISOString();
    if (kind === "note") {
      await d.prepare("UPDATE notes SET trashed_at=?, is_dirty=1, restore_pending_at=NULL WHERE id=?").run(now, id);
      return;
    }

    const allFolders = await d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
    const allNotes = await d.prepare("SELECT id, parent_id FROM notes").all() as Array<{ id: string; parent_id: string | null }>;
    const subtree = collectSubtree(allFolders, allNotes, id);
    const folderIdList = Array.from(subtree.folderIds);
    if (folderIdList.length === 0) return;

    const statements: MobileBatchStatement[] = [];
    const noteRows: Array<{ id: string }> = [];
    for (const batch of sqlParameterBatches(folderIdList)) {
      const ph = batch.map(() => "?").join(",");
      statements.push({
        statement: "UPDATE folders SET trashed_at=?, is_dirty=1, updated_at=? WHERE id IN (" + ph + ") AND trashed_at IS NULL",
        values: [now, now, ...batch],
      });
    }
    for (const batch of sqlParameterBatches(Array.from(subtree.allIds))) {
      const ph = batch.map(() => "?").join(",");
      noteRows.push(...await d.prepare("SELECT id FROM notes WHERE parent_id IN (" + ph + ") AND trashed_at IS NULL").all(...batch) as Array<{ id: string }>);
    }
    for (const n of noteRows) {
      statements.push({
        statement: "UPDATE notes SET trashed_at=?, is_dirty=1, restore_pending_at=NULL, updated_at=? WHERE id=?",
        values: [now, now, n.id],
      });
    }
    await executeBatchInTransaction(d, statements);
  });
}

/** 总回收站行：cloudDeleted = 远端已彻底删除、本机仅保留副本（「云端已删除 · 仅本地」）。 */
export interface MobileTrashTreeItem {
  id: string;
  title: string;
  kind: "folder" | "note";
  parentId: string | null;
  deletedAt: string | null;
  cloudDeleted: boolean;
}

export async function listTrashTree(d: MobileDb): Promise<MobileTrashTreeItem[]> {
  const folders = await d.prepare("SELECT id, title, parent_id, trashed_at, cloud_deleted FROM folders WHERE trashed_at IS NOT NULL").all() as Array<{ id: string; title: string; parent_id: string | null; trashed_at: string | null; cloud_deleted: number }>;
  const notes = await d.prepare("SELECT id, title, parent_id, trashed_at, cloud_deleted FROM notes WHERE trashed_at IS NOT NULL").all() as Array<{ id: string; title: string; parent_id: string | null; trashed_at: string | null; cloud_deleted: number }>;
  return [
    ...folders.map((f) => ({ id: f.id, title: f.title, kind: "folder" as const, parentId: f.parent_id, deletedAt: f.trashed_at, cloudDeleted: f.cloud_deleted === 1 })),
    ...notes.map((n) => ({ id: n.id, title: n.title, kind: "note" as const, parentId: n.parent_id, deletedAt: n.trashed_at, cloudDeleted: n.cloud_deleted === 1 })),
  ].sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
}

/**
 * 恢复目标父必须「存在且不在回收站」，否则回落兜底笔记本（对齐桌面 trashLifecycle.restoreTrashItem：130–149）。
 * 261027 conformance 抓到：只 COALESCE(deleted_from_parent_id,parent_id) 会把文档挂到已删目录上 ⇒
 * 活跃文档父级悬空、树里不可见。没有活跃笔记本时懒建「未分类」（与 syncDbPort.defaultNotebookId 同口径）。
 */
async function resolveRestoreParent(d: MobileDb, preferred: string | null): Promise<string | null> {
  if (preferred) {
    const parent = await d.prepare("SELECT id FROM folders WHERE id=? AND trashed_at IS NULL").get(preferred) as { id?: string } | undefined;
    if (parent?.id) return preferred;
  }
  const notebook = await d.prepare("SELECT id FROM folders WHERE node_type='notebook' AND trashed_at IS NULL ORDER BY sort_order LIMIT 1").get() as { id?: string } | undefined;
  if (notebook?.id) return notebook.id;
  const id = "notebook-" + globalThis.crypto.randomUUID();
  await d.prepare(
    "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty) VALUES (?,?,NULL,0,'notebook',NULL,?,1)"
  ).run(id, "未分类", new Date().toISOString());
  return id;
}

export async function restoreTreeItem(
  d: MobileDb,
  id: string,
  kind: "folder" | "note",
  downloadAssets: (noteIds: string[]) => Promise<void>,
): Promise<void> {
  let folderIds: string[] = [];
  let restoreNoteIds: string[] = [];
  if (kind === "note") {
    restoreNoteIds = [id];
  } else {
    const allFolders = await d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
    const allNotes = await d.prepare("SELECT id, parent_id FROM notes").all() as Array<{ id: string; parent_id: string | null }>;
    const subtree = collectSubtree(allFolders, allNotes, id);
    folderIds = Array.from(subtree.folderIds);
    restoreNoteIds = [];
    for (const batch of sqlParameterBatches(Array.from(subtree.noteIds))) {
      const rows = await d.prepare("SELECT id FROM notes WHERE id IN (" + batch.map(() => "?").join(",") + ") AND trashed_at IS NOT NULL").all(...batch) as Array<{ id: string }>;
      restoreNoteIds.push(...rows.map((n) => n.id));
    }
  }
  await downloadAssets(restoreNoteIds);

  if (kind === "note") {
    const now = new Date().toISOString();
    // updated_at 必须 bump 到恢复时刻（对齐桌面 restoreTrashItem 与本函数 folder 分支）：
    // 恢复传播靠 updatedAt LWW（syncEngine 下载分支 rn.updatedAt > 他端 trashedAt 判恢复胜），
    // 不 bump 则上传条目 updatedAt=删除时刻 → 他端判定相等不跟随 → 恢复被他端墓碑压回。
    // parent_id 必须移回原父：UI 自己的软删不动 parent，但从远端学到的删除（applyRemoteTrash）
    // 是 parent=TRASH 容器表示——不移回则恢复后行仍挂在回收站容器下，上传条目 parentId=TRASH，
    // 他端"跟随恢复"后同样卡在回收站（260910 四端实测）。
    // 261027：原父已被删（或不在活跃目录里）⇒ 回落兜底笔记本，绝不恢复成悬空文档。
    const row = await d.prepare("SELECT COALESCE(deleted_from_parent_id, parent_id) AS pid FROM notes WHERE id=?").get(id) as { pid?: string | null } | undefined;
    const parentId = await resolveRestoreParent(d, row?.pid ?? null);
    await d.prepare(
      "UPDATE notes SET parent_id=?, trashed_at=NULL, restore_pending_at=?, is_dirty=1, updated_at=? WHERE id=?"
    ).run(parentId, now, now, id);
    return;
  }

  await d.transaction(async () => {
    const now = new Date().toISOString();
    const statements: MobileBatchStatement[] = [];
    for (const fid of folderIds) {
      // folder 同理：远端学到的 folder 删除（applyRemoteFolderDelete）标 trashed 但根行 parent 可能不变；
      // COALESCE 兼容两种表示（UI 软删 parent 未动 → 保持；远端学来 → deleted_from_parent_id 为原父）。
      // 261027：笔记本回根层；分组/目录若原父已删 ⇒ 回落兜底笔记本（与 note 分支同口径，不悬空）。
      const row = await d.prepare("SELECT node_type, COALESCE(deleted_from_parent_id, parent_id) AS pid FROM folders WHERE id=?").get(fid) as { node_type?: string; pid?: string | null } | undefined;
      const parentId = row?.node_type === "notebook" ? null : await resolveRestoreParent(d, row?.pid ?? null);
      statements.push({
        statement: "UPDATE folders SET parent_id=?, trashed_at=NULL, updated_at=?, is_dirty=1 WHERE id=?",
        values: [parentId, now, fid],
      });
    }
    for (const nid of restoreNoteIds) {
      // 子树内 notes：applyRemoteFolderDelete 会把子笔记 parent 移到 TRASH 容器 → 恢复时一并移回原父
      statements.push({
        statement: "UPDATE notes SET parent_id=COALESCE(deleted_from_parent_id, parent_id), trashed_at=NULL, restore_pending_at=?, is_dirty=1, updated_at=? WHERE id=?",
        values: [now, now, nid],
      });
    }
    await executeBatchInTransaction(d, statements);
  });
}

export async function purgeTreeItem(d: MobileDb, id: string, kind: "folder" | "note"): Promise<void> {
  /** 事务外删除的正文/历史文件（事务内只删 DB 行；文件删除幂等、失败不阻断）。 */
  const purgedNoteIds: string[] = [];
  const historyFiles: string[] = [];
  const collectHistory = async (noteId: string): Promise<void> => {
    const rows = await d.prepare("SELECT file_path FROM note_history WHERE note_id=?").all(noteId) as Array<{ file_path: string }>;
    for (const row of rows) historyFiles.push(row.file_path);
  };
  await d.transaction(async () => {
    const now = new Date().toISOString();
    const statements: MobileBatchStatement[] = [];
    const tombstone = (id: string, title: string, parentId: string | null, sortOrder: number, updatedAt: string, nodeType: "note" | "folder"): void => {
      statements.push({
        statement: "INSERT OR REPLACE INTO deleted_notes (id, title, parent_id, sort_order, updated_at, deleted_at, node_type, purged_at) VALUES (?,?,?,?,?,?,?,?)",
        values: [id, title, parentId, sortOrder, updatedAt, now, nodeType, now],
      });
    };
    if (kind === "note") {
      const row = await d.prepare("SELECT id, title, parent_id, sort_order, updated_at FROM notes WHERE id=?").get(id) as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
      if (row) tombstone(row.id, row.title, row.parent_id, row.sort_order, row.updated_at, "note");
      await collectHistory(id);
      purgedNoteIds.push(id);
      statements.push({ statement: "DELETE FROM notes WHERE id=?", values: [id] });
      statements.push({ statement: "DELETE FROM sync_base WHERE note_id=?", values: [id] });
      statements.push({ statement: "DELETE FROM note_history WHERE note_id=?", values: [id] });
      await executeBatchInTransaction(d, statements);
      return;
    }

    const allFolders = await d.prepare("SELECT id, parent_id FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
    const allNotes = await d.prepare("SELECT id, parent_id FROM notes").all() as Array<{ id: string; parent_id: string | null }>;
    const subtree = collectSubtree(allFolders, allNotes, id);
    for (const fid of subtree.folderIds) {
      const f = await d.prepare("SELECT title, parent_id, sort_order, updated_at FROM folders WHERE id=?").get(fid) as { title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
      if (f) tombstone(fid, f.title, f.parent_id, f.sort_order, f.updated_at, "folder");
      statements.push({ statement: "DELETE FROM folders WHERE id=?", values: [fid] });
    }
    const noteIds: Array<{ id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string }> = [];
    for (const batch of sqlParameterBatches(Array.from(subtree.noteIds))) {
      noteIds.push(...await d.prepare("SELECT id, title, parent_id, sort_order, updated_at FROM notes WHERE id IN (" + batch.map(() => "?").join(",") + ")").all(...batch) as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string }>);
    }
    for (const n of noteIds) {
      tombstone(n.id, n.title, n.parent_id, n.sort_order, n.updated_at, "note");
      await collectHistory(n.id);
      purgedNoteIds.push(n.id);
      statements.push({ statement: "DELETE FROM notes WHERE id=?", values: [n.id] });
      statements.push({ statement: "DELETE FROM sync_base WHERE note_id=?", values: [n.id] });
      statements.push({ statement: "DELETE FROM note_history WHERE note_id=?", values: [n.id] });
    }
    await executeBatchInTransaction(d, statements);
  });
  // 文件删除放在事务外：失败只留孤儿文件，不影响"已彻底删除"的 DB 判定。
  for (const noteId of purgedNoteIds) await deleteNoteBodies(noteId).catch(() => undefined);
  for (const filePath of historyFiles) await deleteHistorySnapshot(filePath).catch(() => undefined);
}
