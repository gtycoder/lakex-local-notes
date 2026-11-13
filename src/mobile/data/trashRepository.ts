import { sqlParameterBatches } from "../../core/sqlParameterBatch.js";
import { executeBatchInTransaction, type MobileBatchStatement, type MobileDb } from "./sqliteDb";
import { deleteNoteBodies, deleteHistorySnapshot } from "./noteBodies.js";
import { removeNoteAssetsDirFs } from "../native/assetFs";
import { TRASH_NOTEBOOK_ID } from "../../core/syncDecisions.js";
import { DIARY_FOLDER_SPACE, normalizeFolderSpace } from "../../core/diary.js";

/**
 * 日记本本身不可删除（261113 用户裁决，AGENTS §3#25②；与桌面 `trashLifecycle.assertNotDiaryNotebook` 同口径）：
 * 只拦**日记本节点**（node_type='notebook' + space='diary'）。
 * 日记条目与年/月分组照常可删 —— 那是软删进回收站、可恢复（「删除这篇日记」是既有能力，别误伤）。
 */
async function isDiaryNotebookRow(d: MobileDb, id: string): Promise<boolean> {
  const row = await d.prepare("SELECT node_type, space FROM folders WHERE id=?").get(id) as
    { node_type?: string; space?: string | null } | undefined;
  return !!row && row.node_type === "notebook" && normalizeFolderSpace(row.space) === DIARY_FOLDER_SPACE;
}

async function assertNotDiaryNotebook(d: MobileDb, id: string, action: string): Promise<void> {
  if (await isDiaryNotebookRow(d, id)) {
    throw new Error("日记本是固定特殊笔记本，不能" + action + "；只允许把里面的单篇日记转成文档移出: " + id);
  }
}

interface ParentedNode {
  id: string;
  parent_id: string | null;
  /** 删除前原始父（回收站平铺后仍保留）：purge/restore 收集塌陷子树时与 parent 一起作为边。 */
  deleted_from_parent_id?: string | null;
  trashed_at?: string | null;
}

interface SubtreeIds {
  folderIds: Set<string>;
  noteIds: Set<string>;
  allIds: Set<string>;
}

/** P1-6 父环防护：坏库/注入数据下 visited 已保证收敛，这里再加硬上限防算法外异常（内存/耗时兜底）。 */
const MAX_SUBTREE_NODES = 200_000;

/** 收集 folder + note 子树（含自身）：note 也可作为父节点，供删除/恢复/purge 复用。
 *  visited = subtree.allIds：tree_nodes 成环时也不会无限展开（环上节点各纳入一次）。 */
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
  visit(rootNode.id, folders.some((node) => node.id === rootId) ? "folder" : "note");

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

export async function trashTreeItem(d: MobileDb, id: string, kind: "folder" | "note"): Promise<void> {
  // 日记本不可删除（只拦日记本节点；条目/分组照常软删，可恢复）。
  if (kind === "folder") await assertNotDiaryNotebook(d, id, "删除");
  await d.transaction(async () => {
    const now = new Date().toISOString();
    if (kind === "note") {
      // 261112 task-55（N2）：记「删除前父」（恢复原路返回 / 跨端恢复位置都依赖它）。
      await d.prepare(
        "UPDATE notes SET trashed_at=?, is_dirty=1, restore_pending_at=NULL, deleted_from_parent_id=COALESCE(deleted_from_parent_id, parent_id) WHERE id=?",
      ).run(now, id);
      return;
    }

    const allFolders = await d.prepare("SELECT id, parent_id, deleted_from_parent_id, trashed_at FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
    const allNotes = await d.prepare("SELECT id, parent_id, deleted_from_parent_id, trashed_at FROM notes").all() as Array<{ id: string; parent_id: string | null }>;
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
        // 261112 task-55（N2）：子树软删同样记「删除前父」。
        statement: "UPDATE notes SET trashed_at=?, is_dirty=1, restore_pending_at=NULL, deleted_from_parent_id=COALESCE(deleted_from_parent_id, parent_id), updated_at=? WHERE id=?",
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
  /** 261110：来源是日记本（回收站行打「日记」徽标；判据 = 原始父链，不看标题）。 */
  fromDiary?: boolean;
}

export async function listTrashTree(d: MobileDb): Promise<MobileTrashTreeItem[]> {
  const folders = await d.prepare("SELECT id, title, parent_id, trashed_at, cloud_deleted FROM folders WHERE trashed_at IS NOT NULL").all() as Array<{ id: string; title: string; parent_id: string | null; trashed_at: string | null; cloud_deleted: number }>;
  const notes = await d.prepare("SELECT id, title, parent_id, trashed_at, cloud_deleted, deleted_from_parent_id FROM notes WHERE trashed_at IS NOT NULL").all() as Array<{ id: string; title: string; parent_id: string | null; trashed_at: string | null; cloud_deleted: number; deleted_from_parent_id: string | null }>;
  // 261110 性能：一次读全量 folders，在内存里回溯（此前每行一次桥查询 = N+1）。
  const allFolders = await d.prepare("SELECT id, parent_id, node_type, space FROM folders").all() as Array<{ id: string; parent_id: string | null; node_type: string; space: string | null }>;
  const folderById = new Map(allFolders.map((f) => [f.id, f]));
  const isDiaryOrigin = (start: string | null): boolean => {
    let current = start;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const row = folderById.get(current);
      if (!row) return false;
      if (row.node_type === "notebook" && row.space === "diary") return true;
      current = row.parent_id ?? null;
    }
    return false;
  };
  const noteRows = notes.map((n) => ({
    id: n.id,
    title: n.title,
    kind: "note" as const,
    parentId: n.parent_id,
    deletedAt: n.trashed_at,
    cloudDeleted: n.cloud_deleted === 1,
    fromDiary: isDiaryOrigin(n.deleted_from_parent_id ?? n.parent_id),
  }));
  return [
    ...folders.map((f) => ({ id: f.id, title: f.title, kind: "folder" as const, parentId: f.parent_id, deletedAt: f.trashed_at, cloudDeleted: f.cloud_deleted === 1 })),
    ...noteRows,
  ].sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
}

/**
 * 恢复目标父必须「存在且不在回收站」，否则回落兜底笔记本（对齐桌面 trashLifecycle.restoreTrashItem：130–149）。
 * 261027 conformance 抓到：只 COALESCE(deleted_from_parent_id,parent_id) 会把文档挂到已删目录上 ⇒
 * 活跃文档父级悬空、树里不可见。没有活跃笔记本时懒建「未分类」（与 syncDbPort.defaultNotebookId 同口径）。
 */
/** 261110：沿「原始父链」找到来源是否日记本（只认 space=diary 的笔记本，**不看标题**）。 */
async function resolveDiaryOriginNotebook(d: MobileDb, start: string | null): Promise<string | null> {
  let current = start;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = await d.prepare(
      "SELECT node_type, space, parent_id, deleted_from_parent_id FROM folders WHERE id=?",
    ).get(current) as { node_type: string; space: string | null; parent_id: string | null; deleted_from_parent_id: string | null } | undefined;
    if (!row) return null;
    if (row.node_type === "notebook" && row.space === "diary") return current;
    current = row.deleted_from_parent_id ?? row.parent_id;
  }
  return null;
}

/** 261110：恢复日记条目时按标题日期把 年/月 分组补回来（已存在则复用）——"原路返回"。 */
async function ensureDiaryRestoreGroup(d: MobileDb, notebookId: string, title: string): Promise<string> {
  const matched = /^(\d{4})-(\d{2})-\d{2}$/.exec(title.trim());
  if (!matched) return notebookId;
  const findGroup = async (parentId: string, groupTitle: string): Promise<string | null> => {
    const row = await d.prepare(
      "SELECT id FROM folders WHERE parent_id=? AND node_type='group' AND title=? AND trashed_at IS NULL ORDER BY sort_order LIMIT 1",
    ).get(parentId, groupTitle) as { id?: string } | undefined;
    return row?.id ?? null;
  };
  const createGroup = async (parentId: string, groupTitle: string): Promise<string> => {
    const id = "group-" + globalThis.crypto.randomUUID();
    const now = new Date().toISOString();
    const max = await d.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM folders WHERE parent_id=?").get(parentId) as { next?: number } | undefined;
    await d.prepare(
      "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty) VALUES (?,?,?,?,'group',NULL,?,1)",
    ).run(id, groupTitle, parentId, max?.next ?? 0, now);
    return id;
  };
  const yearId = (await findGroup(notebookId, matched[1])) ?? (await createGroup(notebookId, matched[1]));
  return (await findGroup(yearId, matched[2])) ?? (await createGroup(yearId, matched[2]));
}

async function resolveRestoreParent(
  d: MobileDb,
  preferred: string | null,
  restoringFolderIds: ReadonlySet<string> = new Set(),
  title = "",
): Promise<string | null> {
  // 261112 task-55 防御性归一（不写数据迁移）：历史损坏行可能把回收站容器 id 当普通父存在（旧 staged 路径）。
  // 读到它一律按「无原父」处理 ⇒ 回落日记本/兜底笔记本，绝不让恢复卡在不存在的目录上。
  if (preferred === TRASH_NOTEBOOK_ID) preferred = null;
  if (preferred) {
    // 本次一起恢复的子树成员还没落库（trashed_at 仍是删除时的值）⇒ 视为可用，否则嵌套组/子文档会被拆散。
    if (restoringFolderIds.has(preferred)) return preferred;
    const parent = await d.prepare("SELECT id FROM folders WHERE id=? AND trashed_at IS NULL").get(preferred) as { id?: string } | undefined;
    if (parent?.id) return preferred;
  }
  // 261110：原位置不可用时，**日记条目必须先回日记本**（否则会落进默认笔记本 = 文档空间）。
  const diaryNotebookId = await resolveDiaryOriginNotebook(d, preferred);
  if (diaryNotebookId) {
    const diary = await d.prepare("SELECT id FROM folders WHERE id=? AND node_type='notebook' AND trashed_at IS NULL").get(diaryNotebookId) as { id?: string } | undefined;
    // 原路返回：按标题日期补建 年/月 分组；标题非日期时回日记本根。
    if (diary?.id) return await ensureDiaryRestoreGroup(d, diary.id, title);
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
    const allFolders = await d.prepare("SELECT id, parent_id, deleted_from_parent_id, trashed_at FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
    const allNotes = await d.prepare("SELECT id, parent_id, deleted_from_parent_id, trashed_at FROM notes").all() as Array<{ id: string; parent_id: string | null }>;
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
    const row = await d.prepare("SELECT COALESCE(deleted_from_parent_id, parent_id) AS pid, title FROM notes WHERE id=?").get(id) as { pid?: string | null; title?: string } | undefined;
    const parentId = await resolveRestoreParent(d, row?.pid ?? null, new Set(folderIds), row?.title ?? "");
    await d.prepare(
      "UPDATE notes SET parent_id=?, trashed_at=NULL, restore_pending_at=?, is_dirty=1, updated_at=?, deleted_from_parent_id=NULL, cloud_deleted=0 WHERE id=?"
    ).run(parentId, now, now, id);
    return;
  }

  const restoringFolders = new Set(folderIds);
  await d.transaction(async () => {
    const now = new Date().toISOString();
    const statements: MobileBatchStatement[] = [];
    for (const fid of folderIds) {
      // folder 同理：远端学到的 folder 删除（applyRemoteFolderDelete）标 trashed 但根行 parent 可能不变；
      // COALESCE 兼容两种表示（UI 软删 parent 未动 → 保持；远端学来 → deleted_from_parent_id 为原父）。
      // 261027：笔记本回根层；分组/目录若原父已删 ⇒ 回落兜底笔记本（与 note 分支同口径，不悬空）。
      const row = await d.prepare("SELECT node_type, COALESCE(deleted_from_parent_id, parent_id) AS pid FROM folders WHERE id=?").get(fid) as { node_type?: string; pid?: string | null } | undefined;
      const parentId = row?.node_type === "notebook" ? null : await resolveRestoreParent(d, row?.pid ?? null, restoringFolders);
      statements.push({
        statement: "UPDATE folders SET parent_id=?, trashed_at=NULL, updated_at=?, is_dirty=1 WHERE id=?",
        values: [parentId, now, fid],
      });
    }
    for (const nid of restoreNoteIds) {
      // 子树内 notes：applyRemoteFolderDelete 会把子笔记 parent 移到 TRASH 容器 → 恢复时一并移回原父
      statements.push({
        statement: "UPDATE notes SET parent_id=COALESCE(deleted_from_parent_id, parent_id), trashed_at=NULL, restore_pending_at=?, is_dirty=1, updated_at=?, deleted_from_parent_id=NULL, cloud_deleted=0 WHERE id=?",
        values: [now, now, nid],
      });
    }
    await executeBatchInTransaction(d, statements);
  });
}

/** 自动过期守卫（回收站自动清理专用；手动「彻底删除」不传，行为不变）。 */
export interface PurgeTreeItemOptions {
  /**
   * 只在该行**此刻仍位于回收站**、且删除时刻早于该 ISO 时刻时才执行（否则什么都不做，返回 false）。
   *
   * 为什么必须带守卫：自动过期的候选列表是**事务外**读的（bridge.listTrashTree），期间用户可能
   * 刚点了「恢复」。purge 与 restore 同在写域串行 ⇒ 进事务后按最新 trashed_at 重判一次，
   * 就能保证「用户恢复赢、绝不删刚恢复的条目」（后台动作不得越过用户的显式撤销）。
   */
  expiredBefore?: string;
}

/** 行的回收站删除时刻（folders 优先、notes 次之；行不存在 = null）。 */
async function readTrashedAt(d: MobileDb, id: string): Promise<string | null> {
  const folder = await d.prepare("SELECT trashed_at FROM folders WHERE id=?").get(id) as { trashed_at: string | null } | undefined;
  if (folder) return folder.trashed_at ?? null;
  const note = await d.prepare("SELECT trashed_at FROM notes WHERE id=?").get(id) as { trashed_at: string | null } | undefined;
  return note?.trashed_at ?? null;
}

/** 到期判定：用 Date.parse 比较（容忍历史时间戳格式差异；任一侧非法 ⇒ 不删，宁可留着）。 */
function isTrashedBefore(trashedAt: string | null, cutoff: string): boolean {
  if (!trashedAt) return false;
  const at = Date.parse(trashedAt);
  const cut = Date.parse(cutoff);
  return Number.isFinite(at) && Number.isFinite(cut) && at < cut;
}

/**
 * 彻底删除回收站条目（含子树）。返回是否真的删了：
 * - true = 本次写了墓碑并物理删行（文件清理在事务外，失败只告警）；
 * - false = 传了 expiredBefore 且守卫不满足（已恢复 / 未到期 / 行已不存在）。
 * 手动「彻底删除」不传 options ⇒ 与旧行为一致（用户点了就删，不看 trashed_at）。
 */
export async function purgeTreeItem(
  d: MobileDb,
  id: string,
  kind: "folder" | "note",
  options: PurgeTreeItemOptions = {},
): Promise<boolean> {
  /** 事务外删除的正文/历史文件（事务内只删 DB 行；文件删除幂等、失败不阻断）。 */
  const purgedNoteIds: string[] = [];
  const historyFiles: string[] = [];
  const collectHistory = async (noteId: string): Promise<void> => {
    const rows = await d.prepare("SELECT file_path FROM note_history WHERE note_id=?").all(noteId) as Array<{ file_path: string }>;
    for (const row of rows) historyFiles.push(row.file_path);
  };
  const purged = await d.transaction(async () => {
    // 自动过期守卫：必须在**事务内**按最新 trashed_at 重判（候选列表是事务外读的，其间可能已被恢复）。
    if (options.expiredBefore !== undefined && !isTrashedBefore(await readTrashedAt(d, id), options.expiredBefore)) return false;
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
      statements.push({ statement: "DELETE FROM note_history WHERE note_id=?", values: [id] });
      await executeBatchInTransaction(d, statements);
      return true;
    }

    // 日记本不可彻底删除（261113；同桌面 purge 守卫）：**返回 false 而不是抛错** ——
    // 自动过期候选是事务外读的，后台任务不得因脏数据整轮抛错（桌面按 skipped 计数跳过）。
    if (kind === "folder" && await isDiaryNotebookRow(d, id)) return false;
    const allFolders = await d.prepare("SELECT id, parent_id, deleted_from_parent_id, trashed_at FROM folders").all() as Array<{ id: string; parent_id: string | null }>;
    const allNotes = await d.prepare("SELECT id, parent_id, deleted_from_parent_id, trashed_at FROM notes").all() as Array<{ id: string; parent_id: string | null }>;
    const subtree = collectSubtree(allFolders, allNotes, id);
    // 根已不存在 ⇒ 什么都没删（返回 false，供自动过期计数；手动删除不关心返回值）。
    if (subtree.allIds.size === 0) return false;
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
      statements.push({ statement: "DELETE FROM note_history WHERE note_id=?", values: [n.id] });
    }
    await executeBatchInTransaction(d, statements);
    return true;
  });
  // 守卫不满足（已恢复/未到期）⇒ 一行未动，也**不删文件**（用户恢复的条目必须完整）。
  if (!purged) return false;
  // 文件删除放在事务外：失败只留孤儿文件，不影响"已彻底删除"的 DB 判定。
  for (const noteId of purgedNoteIds) {
    await deleteNoteBodies(noteId).catch(() => undefined);
    // MOB-06（261027 审计）：彻底删除必须连附件目录一起清（note-assets/{noteId}/）。
    // 旧实现只删正文/历史 ⇒ 图片/附件以明文留在应用私有目录，与「彻底删除 = 零痕迹」不符。
    // 子节点由上面收集的 purgedNoteIds 覆盖；失败只告警（墓碑已写、索引已清，残留只是孤儿资源）。
    await removeNoteAssetsDirFs(noteId).catch((error) => {
      console.warn("[trash] 彻底删除附件目录失败（残留为孤儿资源，可在资源管理清理）", noteId, error);
    });
  }
  for (const filePath of historyFiles) await deleteHistorySnapshot(filePath).catch(() => undefined);
  return true;
}