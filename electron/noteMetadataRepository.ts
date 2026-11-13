import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { assertTreeNodeTitle } from "../src/core/treeRules.js";
import { DIARY_FOLDER_SPACE, mergeFolderSpace, normalizeFolderSpace, type DiaryFolderSpace } from "../src/core/diary.js";
import type { SyncFolder, TreeNode } from "./noteQueries.js";

interface MetadataRepositoryDeps {
  db: DbLike;
  workspaceId: string;
  trashNotebookId: string;
  uuid(): string;
  nowIso(): string;
  nextSortOrder(parentId: string | null): number;
  ensureParent(parentId: string | null): void;
  assertParentCompatible(parentId: string | null, childType: string): void;
  descendantIds(id: string): string[];
  readTreeNode(id: string): TreeNode;
  upsertSearch(noteId: string, title: string, body: string | null): void;
}

interface NoteTreeRow {
  note_file_id: string | null;
}

interface ExistingFolderRow {
  title: string;
  parent_id: string | null;
  sort_order: number;
  node_type: string;
  icon: string | null;
  updated_at: string;
  space: string | null;
}

/** Metadata writes only; note content, assets, history, and sync content stay in Store. */
export class NoteMetadataRepository {
  private readonly db: DbLike;
  private readonly workspaceId: string;
  private readonly trashNotebookId: string;
  private readonly deps: MetadataRepositoryDeps;

  constructor(deps: MetadataRepositoryDeps) {
    this.db = deps.db;
    this.workspaceId = deps.workspaceId;
    this.trashNotebookId = deps.trashNotebookId;
    this.deps = deps;
  }

  /** 审计 F04：元数据写边界——回收站条目 / 已 purge（含他端保留副本）节点一律 fail-closed。
   * 旧行为是 revivePurgedIfNeeded"编辑即隐式恢复"，违反"恢复是唯一显式例外"，已删除；
   * 这里明确拒绝，避免把 purged 行改成 local 却仍留在回收站产生脏态。 */
  private assertNodeWritable(id: string): void {
    const row = this.db.prepare(
      "SELECT t.parent_id AS parent_id, t.trashed_at AS trashed_at, t.is_purged AS node_purged, n.is_purged AS note_purged " +
      "FROM tree_nodes t LEFT JOIN notes n ON n.id = t.note_file_id WHERE t.id = ?"
    ).get(id) as { parent_id: string | null; trashed_at: string | null; node_purged: number | null; note_purged: number | null } | undefined;
    if (!row) throw new AppError("NotFound", `节点不存在: ${id}`);
    if (row.parent_id === this.trashNotebookId || row.trashed_at != null || row.node_purged === 1 || row.note_purged === 1) {
      throw new AppError("InvalidInput", `节点已在回收站或已被删除，不能修改；请先显式恢复: ${id}`);
    }
  }

  /**
   * 节点身份（日记守卫用；缺失返回 undefined）。`space` 只对 notebook 有意义。
   */
  private nodeIdentity(id: string): { node_type: string; space: string | null; parent_id: string | null } | undefined {
    return this.db.prepare("SELECT node_type, space, parent_id FROM tree_nodes WHERE id=?").get(id) as
      { node_type: string; space: string | null; parent_id: string | null } | undefined;
  }

  /**
   * 日记子树归属（261112 用户裁决，AGENTS §3#25）：沿 parent 链向上找 `space='diary'` 的笔记本。
   * 返回日记本 id；null = 不在日记子树（节点不存在也返回 null，交给调用方的 NotFound 判据）。
   * visited 防环（坏库/并发写入不能让守卫死循环）。
   */
  private diaryNotebookOf(id: string): string | null {
    const visited = new Set<string>();
    let cur: string | null = id;
    while (cur !== null && !visited.has(cur)) {
      visited.add(cur);
      const row = this.nodeIdentity(cur);
      if (!row) return null;
      if (row.node_type === "notebook" && normalizeFolderSpace(row.space) === DIARY_FOLDER_SPACE) return cur;
      cur = row.parent_id;
    }
    return null;
  }

  /** 日记子树（年/月组、日记条目）不可改名/换图标/排序（261112 §3#25）：通用 IPC 一律拒绝。 */
  private assertNotDiarySubtree(id: string, action: string): void {
    if (this.diaryNotebookOf(id) !== null) {
      throw new AppError("InvalidInput", `日记本是固定特殊笔记本，不能${action}（只允许把单篇日记转成文档移出）: ${id}`);
    }
  }

  /**
   * 改名 / 换图标守卫（261113 用户裁决）：**只**拒绝日记子树（年/月分组、日记条目），
   * 日记本**节点本身**放行（`diaryNotebookOf(id) === id`）。
   * 其余约束不变：日记本仍不可删除/移动/排序/被当作移动目标，条目标题仍只能是日期。
   */
  private assertNotDiaryContent(id: string, action: string): void {
    const diaryNotebookId = this.diaryNotebookOf(id);
    if (diaryNotebookId !== null && diaryNotebookId !== id) {
      throw new AppError("InvalidInput", `日记里的分组与日记条目不能${action}（只有日记本本身可以）: ${id}`);
    }
  }

  /** 移动守卫：日记本不能移走、不能作为移动目标；日记子树内只允许「单篇文档整篇移出」。 */
  private assertDiaryMove(id: string, parentId: string | null, moving: TreeNode): void {
    const movingDiary = this.diaryNotebookOf(id);
    const targetDiary = parentId === null ? null : this.diaryNotebookOf(parentId);
    if (movingDiary === id) {
      throw new AppError("InvalidInput", `日记本是固定特殊笔记本，不能移动；只允许把里面的单篇日记转成文档移出: ${id}`);
    }
    if (movingDiary !== null && moving.nodeType !== "note") {
      throw new AppError("InvalidInput", `日记里的分组不能移动；只允许把单篇日记转成文档移出: ${id}`);
    }
    if (movingDiary !== null && targetDiary !== null) {
      throw new AppError("InvalidInput", `日记内容顺序是派生的，不能调整位置/排序: ${id}`);
    }
    if (targetDiary !== null) {
      throw new AppError("InvalidInput", `日记本不能作为移动目标（不支持把文档移入日记空间）: ${parentId}`);
    }
  }

  /** 新建笔记本。`space`（261109）= 日记本标记；只有 "diary" 会被落库，其余归一成 NULL（非日记）。 */
  /** @param id 显式 id（只有「兜底未分类」用固定 id；其余调用方一律走 uuid，别传）。 */
  createNotebook(title: string, space?: DiaryFolderSpace | null, id?: string): TreeNode {
    let trimmed: string;
    try { trimmed = assertTreeNodeTitle(title); }
    catch { throw new AppError("InvalidInput", "名称不能为空"); }
    const nodeId = id ?? this.deps.uuid();
    const now = this.deps.nowIso();
    const sortOrder = this.deps.nextSortOrder(null);
    this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_dirty,is_conflict,space) VALUES(?,?,NULL,'notebook',?,NULL,?,?,?,1,0,?)")
      .run(nodeId, this.workspaceId, trimmed, sortOrder, now, now, normalizeFolderSpace(space));
    return this.deps.readTreeNode(nodeId);
  }

  createGroup(parentId: string, title: string): TreeNode {
    let trimmed: string;
    try { trimmed = assertTreeNodeTitle(title); }
    catch { throw new AppError("InvalidInput", "名称不能为空"); }
    this.deps.ensureParent(parentId);
    this.deps.assertParentCompatible(parentId, "group");
    const id = this.deps.uuid();
    const now = this.deps.nowIso();
    const sortOrder = this.deps.nextSortOrder(parentId);
    this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_dirty,is_conflict) VALUES(?,?,?,'group',?,NULL,?,?,?,1,0)")
      .run(id, this.workspaceId, parentId, trimmed, sortOrder, now, now);
    return this.deps.readTreeNode(id);
  }

  renameTreeNode(id: string, title: string): TreeNode {
    const trimmed = title.trim();
    if (!trimmed) throw new AppError("InvalidInput", "名称不能为空");
    this.assertNodeWritable(id);
    this.assertNotDiaryContent(id, "改名");
    const now = this.deps.nowIso();
    const transaction = this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE tree_nodes SET title=?,updated_at=?,is_dirty=1 WHERE id=? AND deleted_at IS NULL").run(trimmed, now, id).changes;
      if (changed === 0) throw new AppError("NotFound", `节点不存在: ${id}`);
      this.db.prepare("UPDATE notes SET title=?,updated_at=?,is_dirty=1 WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL").run(trimmed, now, id);
      const node = this.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?").get(id) as NoteTreeRow | undefined;
      if (node?.note_file_id) this.deps.upsertSearch(node.note_file_id, trimmed, null);
    });
    transaction();
    return this.deps.readTreeNode(id);
  }

  setNodeIcon(id: string, icon: string | null): TreeNode {
    if (icon !== null && (typeof icon !== "string" || icon.length > 16)) {
      throw new AppError("InvalidInput", "无效的图标");
    }
    const now = this.deps.nowIso();
    this.assertNodeWritable(id);
    this.assertNotDiaryContent(id, "换图标");
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE tree_nodes SET icon=?, updated_at=?, is_dirty=1 WHERE id=?").run(icon, now, id);
      this.db.prepare("UPDATE notes SET updated_at=?, is_dirty=1 WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL")
        .run(now, id);
    });
    transaction();
    return this.deps.readTreeNode(id);
  }

  /**
   * 同步镜像写（261112 G3，与 noteContentRepository.saveSynced 同类）：只写 icon 列。
   *
   * 为什么单独成方法：`setNodeIcon` 是**用户入口**，带 `assertNodeWritable`（回收站/purged 一律拒写）；
   * 但同步 apply 在「新设备首次见到远端行」时会调端口 `setNodeIcon`（`deviceStore.ts:584`）——
   * 若远端条目已在回收站且带图标，镜像写入会撞用户守卫 ⇒ 整轮 syncNow 抛错、设备永久卡死。
   * 镜像路径允许回收站行（icon 是独立字段，不得因此整轮失败）；`purged` / 已删仍拒绝（不可复活）。
   * 不动 updated_at / is_dirty（镜像元数据由 applyRemoteNoteMeta 负责，写本方法不算本地改动）。
   */
  applyRemoteNodeIcon(id: string, icon: string | null): void {
    if (icon !== null && (typeof icon !== "string" || icon.length > 16)) {
      throw new AppError("InvalidInput", "无效的图标");
    }
    const row = this.db.prepare(
      "SELECT t.deleted_at AS deleted_at, t.is_purged AS node_purged, n.is_purged AS note_purged " +
      "FROM tree_nodes t LEFT JOIN notes n ON n.id = t.note_file_id WHERE t.id = ?"
    ).get(id) as { deleted_at: string | null; node_purged: number | null; note_purged: number | null } | undefined;
    if (!row) throw new AppError("NotFound", `节点不存在: ${id}`);
    if (row.node_purged === 1 || row.note_purged === 1) {
      throw new AppError("InvalidInput", `节点已被彻底删除（不可恢复），不能修改: ${id}`);
    }
    this.db.prepare("UPDATE tree_nodes SET icon=? WHERE id=?").run(icon, id);
  }

  moveTreeNode(id: string, parentId: string | null, sortOrder: number): TreeNode {
    const moving = this.deps.readTreeNode(id);
    this.assertDiaryMove(id, parentId, moving);
    if (parentId) {
      if (parentId === id) throw new AppError("InvalidInput", "不能移动到自身");
      if (new Set(this.deps.descendantIds(id)).has(parentId)) throw new AppError("InvalidInput", "不能移动到子节点");
      this.deps.ensureParent(parentId);
    }
    this.deps.assertParentCompatible(parentId, moving.nodeType);
    const now = this.deps.nowIso();
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE tree_nodes SET parent_id=?,sort_order=?,updated_at=?,is_dirty=1 WHERE id=? AND deleted_at IS NULL")
        .run(parentId, sortOrder, now, id);
      if (moving.noteFileId) {
        this.db.prepare("UPDATE notes SET parent_id=?,sort_order=?,updated_at=?,is_dirty=1 WHERE id=? AND deleted_at IS NULL")
          .run(parentId, sortOrder, now, moving.noteFileId);
      }
    });
    transaction();
    return this.deps.readTreeNode(id);
  }

  moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): TreeNode {
    const moving = this.deps.readTreeNode(id);
    this.assertDiaryMove(id, parentId, moving);
    if (parentId) {
      if (parentId === id) throw new AppError("InvalidInput", "不能移动到自身");
      if (new Set(this.deps.descendantIds(id)).has(parentId)) throw new AppError("InvalidInput", "不能移动到子节点");
      this.deps.ensureParent(parentId);
    }
    this.deps.assertParentCompatible(parentId, moving.nodeType);
    const children = this.childrenOf(parentId);
    // 跨父移动：目标父节点的现有子列表 children 尚不含被移动的 id，
    // 前端 orderedIds = 目标父现有子节点（排除 id）+ 插入位置的 id。
    // 校验允许集合 = children ∪ {id}（同父重排时 id 已在 children 内，等价于原校验）。
    const allowed = children.includes(id) ? children : [...children, id];
    this.validateOrder(orderedIds, allowed);
    const now = this.deps.nowIso();
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE tree_nodes SET parent_id=?,sort_order=?,updated_at=?,is_dirty=1 WHERE id=? AND deleted_at IS NULL")
        .run(parentId, orderedIds.indexOf(id), now, id);
      const treeStatement = this.db.prepare("UPDATE tree_nodes SET sort_order=?,updated_at=?,is_dirty=1 WHERE id=? AND deleted_at IS NULL");
      orderedIds.forEach((childId, index) => treeStatement.run(index, now, childId));
      const noteStatement = this.db.prepare("UPDATE notes SET parent_id=?,sort_order=?,updated_at=?,is_dirty=1 WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL");
      orderedIds.forEach((childId, index) => noteStatement.run(parentId, index, now, childId));
    });
    transaction();
    return this.deps.readTreeNode(id);
  }

  reorderTreeNodes(parentId: string | null, orderedIds: string[]): void {
    // 日记内容的顺序是 core 派生（年→月→日期），sort_order 不可由用户改（261112 §3#25）。
    if (parentId !== null) this.assertNotDiarySubtree(parentId, "排序");
    for (const id of orderedIds) {
      if (this.diaryNotebookOf(id) === id) {
        throw new AppError("InvalidInput", `日记本是固定特殊笔记本，不能参与排序: ${id}`);
      }
    }
    const children = this.childrenOf(parentId);
    this.validateOrder(orderedIds, children);
    const now = this.deps.nowIso();
    const transaction = this.db.transaction(() => {
      const treeStatement = this.db.prepare("UPDATE tree_nodes SET sort_order=?,updated_at=?,is_dirty=1 WHERE id=? AND deleted_at IS NULL");
      const noteStatement = this.db.prepare("UPDATE notes SET sort_order=?,updated_at=?,is_dirty=1 WHERE id=(SELECT note_file_id FROM tree_nodes WHERE id=?) AND deleted_at IS NULL");
      orderedIds.forEach((childId, index) => { treeStatement.run(index, now, childId); noteStatement.run(index, now, childId); });
    });
    transaction();
  }

  setNoteEditLocked(id: string, locked: boolean): void {
    const now = this.deps.nowIso();
    this.assertNodeWritable(id);
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE notes SET is_locked=?, locked_at=?, is_dirty=1 WHERE id=? AND deleted_at IS NULL")
        .run(locked ? 1 : 0, now, id);
      this.db.prepare("UPDATE tree_nodes SET is_dirty=1 WHERE note_file_id=? AND deleted_at IS NULL").run(id);
    });
    transaction();
  }

  applyRemoteEditLock(id: string, locked: boolean, editLockedAt: string | null): void {
    this.db.prepare("UPDATE notes SET is_locked=?, locked_at=? WHERE id=? AND deleted_at IS NULL")
      .run(locked ? 1 : 0, editLockedAt, id);
  }

  /**
   * P1-6 父环防护（落库侧最后一道闸）：把 nodeId 的父改成 candidateParentId 是否成环。
   * core 合并层已拒绝远端环；这里防"本地树本身已损坏/并发写入"造成的环，命中时保持原父。
   */
  private wouldCreateParentCycle(nodeId: string, candidateParentId: string | null): boolean {
    if (!candidateParentId) return false;
    if (candidateParentId === nodeId) return true;
    const seen = new Set<string>();
    let cur: string | null = candidateParentId;
    while (cur !== null) {
      if (cur === nodeId) return true;
      if (seen.has(cur)) return false; // 已存在的环（不含本节点）不归这里管，读侧有 visited 兜底
      seen.add(cur);
      if (seen.size > 100_000) return true; // 防御：异常超长链一律按成环处理
      const row = this.db.prepare("SELECT parent_id FROM tree_nodes WHERE id=?").get(cur) as { parent_id: string | null } | undefined;
      cur = row?.parent_id ?? null;
    }
    return false;
  }

  importRemoteFolder(folder: SyncFolder): void {
    if (folder.id === this.trashNotebookId) return;
    const existing = this.db.prepare("SELECT title,parent_id,sort_order,node_type,icon,updated_at,space FROM tree_nodes WHERE id=?").get(folder.id) as ExistingFolderRow | undefined;
    if (!existing) {
      // 新行不可能与已落库树成环（自身尚未入表），只有自指需要挡；其余交给读侧 visited。
      const parentId = this.wouldCreateParentCycle(folder.id, folder.parentId) ? null : folder.parentId;
      if (parentId !== folder.parentId) console.warn("[sync] 拒绝成环的远端父关系（importRemoteFolder）:", folder.id, folder.parentId);
      this.db.prepare(
        `INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,is_dirty,is_conflict,icon,trashed_at,deleted_from_parent_id,space)
         VALUES(?,?,?,?,?,NULL,?,?,?,NULL,0,0,?,?,?,?)`
      ).run(folder.id, this.workspaceId, parentId, folder.nodeType, folder.title, folder.sortOrder, folder.updatedAt, folder.updatedAt, folder.icon ?? null,
        parentId === this.trashNotebookId ? (folder.trashedAt ?? null) : null,
        parentId === this.trashNotebookId ? (folder.deletedFromParentId ?? null) : null,
        normalizeFolderSpace(folder.space));
      return;
    }
    if (folder.updatedAt > existing.updated_at) {
      const parentId = this.wouldCreateParentCycle(folder.id, folder.parentId) ? existing.parent_id : folder.parentId;
      if (parentId !== folder.parentId) console.warn("[sync] 拒绝成环的远端父关系（importRemoteFolder 更新）:", folder.id, folder.parentId);
      this.db.prepare(
        "UPDATE tree_nodes SET parent_id=?, title=?, sort_order=?, updated_at=?, icon=?, is_dirty=0, node_type=?, trashed_at=?, deleted_from_parent_id=?, space=? WHERE id=?"
      ).run(parentId, folder.title, folder.sortOrder, folder.updatedAt, folder.icon ?? null, folder.nodeType,
        parentId === this.trashNotebookId ? (folder.trashedAt ?? null) : null,
        parentId === this.trashNotebookId ? (folder.deletedFromParentId ?? null) : null,
        this.diarySafeFolderSpace(folder.id, existing.space, folder.space),
        folder.id);
    }
  }

  /**
   * 落库侧最后一道 space 单调闸（261112 §3#25）：本地已是 diary 就绝不再写 null。
   * 合并层（s3v3Merge.enforceDiarySpaceMonotone）已首选重发布；这里兜「脏计划/旧包/直接从云端恢复」。
   */
  private diarySafeFolderSpace(id: string, existingSpace: string | null, remoteSpace: unknown): DiaryFolderSpace | null {
    const space = mergeFolderSpace(existingSpace, remoteSpace);
    if (normalizeFolderSpace(existingSpace) === DIARY_FOLDER_SPACE && normalizeFolderSpace(remoteSpace) !== DIARY_FOLDER_SPACE) {
      console.warn("[sync] 拒绝把日记本降级为普通笔记本（space 只允许 null→diary）:", id);
    }
    return space;
  }

  /**
   * v3 同步：把本轮合并结果中的目录元数据原样落库（含 updatedAt）。
   * 与 importRemoteFolder 的区别：这里是「合并已定夺，local state 即真相」，不能再按
   * updatedAt 大小做条件（两端种子/升级时间不同时，远端时间戳可能更旧但已胜出；
   * 不落库会让本地行时间戳与 baseline 长期不一致，导致空跑隔轮各 +1 generation）。
   */
  applyRemoteFolderMeta(folder: SyncFolder): void {
    if (folder.id === this.trashNotebookId) return;
    const trashedAt = folder.parentId === this.trashNotebookId ? (folder.trashedAt ?? null) : null;
    const deletedFrom = folder.parentId === this.trashNotebookId ? (folder.deletedFromParentId ?? null) : null;
    const existing = this.db.prepare("SELECT id, parent_id, space, trashed_at, deleted_from_parent_id FROM tree_nodes WHERE id=?").get(folder.id) as
      { id: string; parent_id: string | null; space: string | null; trashed_at: string | null; deleted_from_parent_id: string | null } | undefined;
    if (!existing) {
      this.importRemoteFolder(folder);
      return;
    }
    // 261112 发版复核 F-02：日记本**固定不可变**——同步 apply 也不得移动/回收它（旧端/脏索引绕过 §3#25）。
    // 本地已是 diary 的目录：远端 parentId / trashedAt / deletedFromParentId 一律以本地为准（内容字段照常应用）。
    const keepDiaryPlacement = existing.space === "diary";
    // P1-6：合并层已拒绝远端环；这里再兜一次并发/坏库场景，命中则**保持原父**并告警。
    const parentId = keepDiaryPlacement
      ? existing.parent_id
      : this.wouldCreateParentCycle(folder.id, folder.parentId) ? existing.parent_id : folder.parentId;
    if (parentId !== folder.parentId) console.warn("[sync] 拒绝成环/固定日记本的远端父关系（applyRemoteFolderMeta）:", folder.id, folder.parentId);
    const effectiveTrashedAt = keepDiaryPlacement ? existing.trashed_at : trashedAt;
    const effectiveDeletedFrom = keepDiaryPlacement ? existing.deleted_from_parent_id : deletedFrom;
    this.db.prepare(
      "UPDATE tree_nodes SET title=?, parent_id=?, sort_order=?, node_type=?, icon=?, updated_at=?, is_dirty=0, trashed_at=?, deleted_from_parent_id=?, space=? WHERE id=?"
    ).run(folder.title, parentId, folder.sortOrder, folder.nodeType, folder.icon ?? null, folder.updatedAt, effectiveTrashedAt, effectiveDeletedFrom,
      this.diarySafeFolderSpace(folder.id, existing.space, folder.space), folder.id);
  }

  hasTreeNode(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(id);
  }

  /** 该父节点的有效子节点（排除回收站子树，对齐 listTreeNodes 的 UI 语义；用于移动/重排校验）。
   * SQLite 中 parent_id = NULL 恒不成立：根层（parentId=null）必须用 IS NULL（桌面根层笔记本排序修复）。 */
  private childrenOf(parentId: string | null): string[] {
    const base = parentId === null
      ? "SELECT id FROM tree_nodes WHERE workspace_id=? AND parent_id IS NULL AND deleted_at IS NULL"
      : "SELECT id FROM tree_nodes WHERE workspace_id=? AND parent_id=? AND deleted_at IS NULL";
    // 参数顺序必须与 SQL 占位符一致：WITH trash_ids 的 2 个 ?（trashId）在前，base 的 ?（workspaceId[, parentId]）在后
    const params: unknown[] = [this.deps.trashNotebookId, this.deps.trashNotebookId, this.workspaceId];
    if (parentId !== null) params.push(parentId);
    const rows = this.db.prepare(
      // P1-6：UNION（去重）而不是 UNION ALL —— 树里出现环时递归会无限展开；去重后自然收敛。
      "WITH RECURSIVE trash_ids(id) AS (SELECT ? FROM tree_nodes WHERE id=? UNION SELECT t.id FROM tree_nodes t JOIN trash_ids ti ON t.parent_id=ti.id) SELECT id FROM (" + base + ") WHERE id NOT IN (SELECT id FROM trash_ids)"
    ).all(...params) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private validateOrder(orderedIds: string[], children: string[]): void {
    if (new Set(orderedIds).size !== orderedIds.length) throw new AppError("InvalidInput", "重排列表包含重复节点");
    const childSet = new Set(children);
    for (const childId of orderedIds) {
      if (!childSet.has(childId)) throw new AppError("InvalidInput", `重排列表包含不属于该父节点的节点: ${childId}`);
    }
    if (orderedIds.length !== children.length) throw new AppError("InvalidInput", "重排列表必须包含该父节点的全部子节点");
  }
}
