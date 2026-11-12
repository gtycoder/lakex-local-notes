import fs from "node:fs";
import path from "node:path";
import type { DbLike } from "./dbLike.js";
import { ensureDiaryGroupsForRestore, isNotebookAvailable, resolveDiaryOriginNotebookId } from "./trashDiaryOrigin.js";
import { AppError } from "../src/core/storeErrors.js";
import { DIARY_FOLDER_SPACE, normalizeFolderSpace } from "../src/core/diary.js";
import { isSafePathSegment } from "../src/core/storeUtils.js";
import { sqlParameterBatches } from "../src/core/sqlParameterBatch.js";
import type { LoggerScopes } from "../src/core/logger.js";
import type { TreeNode } from "./noteQueries.js";

function nowIso(): string {
  return new Date().toISOString();
}

/** 回收站生命周期上下文：DB + 文件路径 + 跨域回调（由 Store 装配）。 */
export interface TrashLifecycleContext {
  db: DbLike;
  trashNotebookId: string;
  /** .lake 正文文件绝对路径 */
  notePathFor: (noteId: string) => string;
  /** 资产目录（workspace 级）绝对路径 */
  noteAssetsDir: string;
  /** 历史快照目录（单笔记）绝对路径 */
  historyNoteDirFor: (noteId: string) => string;
  logScopes: LoggerScopes;
  /** 读取树节点（缺失抛 NotFound） */
  readTreeNode: (id: string) => TreeNode;
  /** 读取笔记缓存（markdown/plain） */
  readNoteCaches: (noteId: string) => { markdown: string | null; plain: string | null };
  /** FTS 上行（恢复/撤销删除时重建索引） */
  upsertSearch: (noteId: string, title: string, body: string | null) => void;
  /** FTS 下行（回收站/彻底删批量移除） */
  removeSearch: (noteIds: readonly string[]) => void;
  /** 兜底父笔记本（原父缺失时恢复目标） */
  resolveParentNotebook: () => string;
  /** 建分组（261110：恢复日记条目时按标题日期补建 年/月 分组，尽量"原路返回"） */
  createGroup: (parentId: string, title: string) => { id: string };
}

/**
 * 回收站生命周期（软删/恢复/彻底删除/清空/撤销删除）。
 * 从事务语义到 SQL 全部原样迁移自 Store（REFACTOR：只搬家不改行为）。
 * 红线：删除必须传播（墓碑权威）；恢复是唯一显式例外（restore_pending_at → local-wins）。
 */
export class TrashLifecycle {
  private readonly ctx: TrashLifecycleContext;

  constructor(ctx: TrashLifecycleContext) {
    this.ctx = ctx;
  }

  /**
   * 日记本不可删除（261112 用户裁决，AGENTS §3#25）：日记本是固定特殊笔记本，
   * 软删/彻底删除/清空回收站一律拒绝，只允许把里面的单篇日记转成文档移出。
   */
  private assertNotDiaryNotebook(id: string, action: string): void {
    const row = this.ctx.db.prepare("SELECT node_type, space FROM tree_nodes WHERE id=?").get(id) as
      { node_type: string; space: string | null } | undefined;
    if (row && row.node_type === "notebook" && normalizeFolderSpace(row.space) === DIARY_FOLDER_SPACE) {
      throw new AppError("InvalidInput", `日记本是固定特殊笔记本，不能${action}；只允许把里面的单篇日记转成文档移出: ${id}`);
    }
  }

  /** 包含已删除节点的后代（用于彻底删除回收站子树） */
  private descendantIdsIncludingDeleted(id: string): string[] {
    // P1-6 父环防护：tree_nodes 成环时旧实现会无限 push（彻底删除/清空回收站卡死）；
    // visited 去重后有限返回（环上的节点各出现一次）。
    const result: string[] = [];
    const visited = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      result.push(cur);
      const children = this.ctx.db.prepare("SELECT id FROM tree_nodes WHERE parent_id=?").all(cur) as { id: string }[];
      for (const c of children) if (!visited.has(c.id)) stack.push(c.id);
    }
    return result;
  }

  /**
   * purge 的后代集合（F-01，P0 修复）：**不能只按 parent_id 找后代**。
   *
   * 背景：删除分组进回收站后，wire 侧会把所有 trashed 条目的 parent 归一成回收站容器
   * （`s3v3/commit/engineBridge.ts:74`），再被 apply 写回本机 ⇒ 子文档的 parent_id 不再是分组，
   * 而原始父链保留在 `deleted_from_parent_id`。只按 parent_id 遍历会只拿到分组自身 ⇒ 子文档漏 purge、
   * 继续以 trashed 条目发布、云端索引残留（违反 AGENTS §3#15 删除传播红线）。
   * 判据 = 两条边取并集：① parent_id（未扁平化的常规子树）；② deleted_from_parent_id + trashed_at
   * （被同步扁平化的回收站子树）。UNION 去重 + deleted_at 过滤可防环、防重复。
   */
  /**
   * 子树集合（**purge 与 restore 共用**，261112 task-62 复核补）：两条边取并集后，既覆盖常规 parent 链，
   * 也覆盖「被同步扁平化成回收站容器」的 trashed 后代（原始父在 deleted_from_parent_id）。
   * UNION 去重 ⇒ 环上节点各纳入一次、递归必然收敛（无队列/次数上限问题）。
   */
  private flattenedSubtreeIds(rootId: string): string[] {
    const rows = this.ctx.db.prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT ?
         UNION
         SELECT t.id FROM tree_nodes t JOIN subtree s
           ON t.parent_id = s.id
           OR (t.deleted_from_parent_id = s.id AND t.trashed_at IS NOT NULL)
         WHERE t.deleted_at IS NULL
       )
       SELECT id FROM subtree`
    ).all(rootId) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /** 该节点子树内全部 note_file_id（含自身；含已删除节点，purge 用）。 */
  private descendantNoteFileIds(id: string): string[] {
    const ids = this.descendantIdsIncludingDeleted(id);
    const out: string[] = [];
    for (const nid of ids) {
      const row = this.ctx.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?").get(nid) as { note_file_id: string | null } | undefined;
      if (row?.note_file_id) out.push(row.note_file_id);
    }
    return out;
  }

  /**
   * 软删除（回收站笔记本重构）：删除 = 把节点移入隐藏回收站笔记本（parentId=notebook-trash），
   * 记录 trashed_at（进入回收站时间）+ deleted_from_parent_id（删除前父目录，恢复位置），标 local 待上传。
   * 不递归子节点（子节点随父移动）、不写墓碑（回收站条目是普通条目，移动即同步传播）。
   * 文件保留（.lake / 资源不删）；彻底删除走 purgeTrashItem。审计 #10：DB 事务原子提交。
   */
  deleteTreeNode(id: string) {
    if (id === this.ctx.trashNotebookId) {
      throw new AppError("InvalidInput", "不能删除回收站笔记本");
    }
    this.assertNotDiaryNotebook(id, "删除");
    const node = this.ctx.readTreeNode(id);
    if (node.parentId === this.ctx.trashNotebookId) return; // 已在回收站
    const now = nowIso();
    const tx = this.ctx.db.transaction(() => {
      if (node.noteFileId) {
        // restore_pending_at 一并清除：恢复后未同步再删除，残留标记会以"恢复语义"上传（trashedAt:null）
        // 导致本地删除不传播、云端复活（与 applyRemoteMoveToTrash/applyRemoteRestore 同口径清理）。
        this.ctx.db.prepare(
          "UPDATE notes SET parent_id=?,trashed_at=?,deleted_from_parent_id=?,updated_at=?,is_dirty=1,restore_pending_at=NULL WHERE id=? AND deleted_at IS NULL"
        ).run(this.ctx.trashNotebookId, now, node.parentId, now, node.noteFileId);
      }
      this.ctx.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=?,deleted_from_parent_id=?,updated_at=?,is_dirty=1 WHERE id=? AND deleted_at IS NULL"
      ).run(this.ctx.trashNotebookId, now, node.parentId, now, id);
      // 级联：子树所有节点（嵌套分组 + 笔记）跟随根进回收站——trashed_at 必须标上，
      // 否则同步发布时子树按"正常"传播，其他端不跟随删除（内容"没删掉"、根恢复/删除语义不一致）。
      const subtreeIds = this.descendantIdsIncludingDeleted(id).filter((sid) => sid !== id);
      if (subtreeIds.length > 0) {
        const subNotes: Array<{ note_file_id: string }> = [];
        for (const batch of sqlParameterBatches(subtreeIds)) {
          const ph = batch.map(() => "?").join(",");
          // F-01（P0）：子树每个节点都要记「删除前原始父」。只记根节点会让同步把子文档 parent 扁平化后
          // **原始父链彻底丢失** ⇒ purge 无法按 deleted_from_parent_id 找到后代（子文档漏删、云端索引残留）。
          this.ctx.db.prepare(
            `UPDATE tree_nodes SET trashed_at=?,updated_at=?,is_dirty=1,deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id) WHERE id IN (${ph}) AND deleted_at IS NULL`,
          ).run(now, now, ...batch);
          subNotes.push(...this.ctx.db.prepare(`SELECT note_file_id FROM tree_nodes WHERE id IN (${ph}) AND note_file_id IS NOT NULL AND deleted_at IS NULL`).all(...batch) as Array<{ note_file_id: string }>);
        }
        const subNoteIds = subNotes.map((s) => s.note_file_id);
        for (const batch of sqlParameterBatches(subNoteIds)) {
          const nph = batch.map(() => "?").join(",");
          this.ctx.db.prepare(
            `UPDATE notes SET trashed_at=?,updated_at=?,is_dirty=1,restore_pending_at=NULL,deleted_from_parent_id=COALESCE(deleted_from_parent_id,parent_id) WHERE id IN (${nph}) AND deleted_at IS NULL`,
          ).run(now, now, ...batch);
        }
      }
      // 回收站条目不出现在搜索（子树整体移出 FTS 账本，恢复时重建）
      this.ctx.removeSearch(this.descendantNoteFileIds(id));
    });
    tx();
  }

  /** 回收站自动过期（TRASH-NOTEBOOK）：trashed_at 超过 N 天的 trash 顶级条目自动 purge。返回 purge 数。 */
  autoPurgeExpiredTrash(days: number): number {
    if (!Number.isFinite(days) || days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const rows = this.ctx.db.prepare(
      "SELECT id FROM tree_nodes WHERE parent_id=? AND deleted_at IS NULL AND trashed_at IS NOT NULL AND trashed_at < ? ORDER BY trashed_at"
    ).all(this.ctx.trashNotebookId, cutoff) as Array<{ id: string }>;
    for (const r of rows) {
      // 日记本不可删除（261112 §3#25）：历史脏数据让它进了回收站也不得被过期清理 purge（后台任务不得抛错）。
      const row = this.ctx.db.prepare("SELECT node_type, space FROM tree_nodes WHERE id=?").get(r.id) as
        { node_type: string; space: string | null } | undefined;
      if (row && row.node_type === "notebook" && normalizeFolderSpace(row.space) === DIARY_FOLDER_SPACE) {
        this.ctx.logScopes.store.warn("[trash] 跳过日记本的过期清理（不可删除）:", r.id);
        continue;
      }
      try { this.purgeTrashItem(r.id); }
      // F-01 复核（task-62）：候选列表是事务外读的；前一个根 purge 时按 deleted_from_parent_id 可能已把
      // 同组的其他「回收站根」一起删掉（同步扁平化后常见）⇒ NotFound 幂等跳过，后台任务不得半途抛错。
      catch (error) { if (!(error instanceof AppError && error.kind === "NotFound")) throw error; }
    }
    return rows.length;
  }

  /** 恢复回收站节点：移回原位置（deleted_from_parent_id）；原父不存在/已被删/在回收站 → 默认笔记本。
   * 无墓碑可压（回收站条目是普通条目），恢复 = 移出 + 标 local 待上传（LWW 由 updatedAt 承担）。 */
  restoreTrashItem(id: string): void {
    const node = this.ctx.db.prepare("SELECT * FROM tree_nodes WHERE id=? AND parent_id=? AND deleted_at IS NULL").get(id, this.ctx.trashNotebookId) as
      { note_file_id: string | null; node_type: string; deleted_from_parent_id: string | null } | undefined;
    if (!node) throw new AppError("NotFound", `回收站节点不存在: ${id}`);
    // 笔记本只能回根层（parentId=null）；note/group 回原位置，原父缺失/被删/在回收站 → 默认笔记本
    const isNotebook = node.node_type === "notebook";
    let parentId: string | null = isNotebook ? null : node.deleted_from_parent_id;
    /** 需要"原路返回日记空间"时记下目标（年/月分组在事务内补建，见下）。 */
    let diaryRestore: { notebookId: string; title: string } | null = null;
    if (parentId === null || parentId === this.ctx.trashNotebookId) {
      parentId = isNotebook ? null : this.ctx.resolveParentNotebook();
    } else {
      // 原父必须存在、未被删、且不在回收站内，否则回退默认笔记本。
      // 注意：根级笔记本 parent_id 为 NULL，`parent_id != ?` 会因 SQL 三值逻辑得 NULL 而漏判，
      // 导致恢复到根级笔记本时误回退到默认笔记本（恢复位置错误）——必须显式允许 NULL。
      const parent = this.ctx.db.prepare(
        "SELECT id FROM tree_nodes WHERE id=? AND deleted_at IS NULL AND (parent_id IS NULL OR parent_id != ?)"
      ).get(parentId, this.ctx.trashNotebookId) as { id: string } | undefined;
      if (!parent) {
        // 261110：原父已删/也在回收站时，**先看来源是不是日记本**（只认原始父链，不看标题）。
        // 日记条目必须回日记空间；旧逻辑一律回落「默认笔记本」= 文档空间（用户现场担心的问题）。
        const diaryNotebookId = resolveDiaryOriginNotebookId(this.ctx.db, parentId);
        if (diaryNotebookId && isNotebookAvailable(this.ctx.db, diaryNotebookId)) {
          // 原路返回：目标 = 日记本；**年/月分组的补建放在恢复事务里**（失败不残留空分组）。
          parentId = diaryNotebookId;
          diaryRestore = {
            notebookId: diaryNotebookId,
            title: node.note_file_id
              ? (this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(node.note_file_id) as { title?: string } | undefined)?.title ?? ""
              : "",
          };
        } else {
          parentId = this.ctx.resolveParentNotebook();
        }
      }
    }
    const now = nowIso();
    const tx = this.ctx.db.transaction(() => {
      // 261110：日记条目的 年/月 分组在**事务内**补建（已存在则复用；标题非日期时回日记本根）。
      if (diaryRestore) {
        parentId = ensureDiaryGroupsForRestore(this.ctx.db, this.ctx.createGroup, diaryRestore.notebookId, diaryRestore.title);
      }
      if (node.note_file_id) {
        this.ctx.db.prepare(
          "UPDATE notes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,is_dirty=1,is_purged=0,restore_pending_at=? WHERE id=?"
        ).run(parentId, now, now, node.note_file_id);
        const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(node.note_file_id) as { title: string } | undefined;
        const caches = this.ctx.readNoteCaches(node.note_file_id);
        this.ctx.upsertSearch(node.note_file_id, titleRow?.title ?? "", caches.plain ?? null);
      }
      this.ctx.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,is_dirty=1,is_purged=0 WHERE id=?"
      ).run(parentId, now, id);
      // 级联：子树（跟随根进回收站的嵌套分组/笔记）随根恢复。
      // F-01 复核（task-62）：子树集合与 purge 同口径（parent 链 ∪ 被同步扁平化的 trashed 后代的 dfp 链）；
      // 扁平化子节点的 parent 已被归一到回收站容器，恢复时必须回到 deleted_from_parent_id（原始的组内父），
      // 否则会出现「active 但 parent=回收站容器」的悬空树。非扁平化子节点 COALESCE 保持原父，行为不变。
      const subtreeIds = this.flattenedSubtreeIds(id).filter((sid) => sid !== id);
      if (subtreeIds.length > 0) {
        const subNotes: Array<{ note_file_id: string }> = [];
        for (const batch of sqlParameterBatches(subtreeIds)) {
          const ph = batch.map(() => "?").join(",");
          this.ctx.db.prepare(
            `UPDATE tree_nodes SET parent_id=COALESCE(deleted_from_parent_id,parent_id),trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,is_dirty=1 WHERE id IN (${ph}) AND deleted_at IS NULL`,
          ).run(now, ...batch);
          subNotes.push(...this.ctx.db.prepare(`SELECT note_file_id FROM tree_nodes WHERE id IN (${ph}) AND note_file_id IS NOT NULL AND deleted_at IS NULL`).all(...batch) as Array<{ note_file_id: string }>);
        }
        const subNoteIds = subNotes.map((s) => s.note_file_id);
        for (const batch of sqlParameterBatches(subNoteIds)) {
          const nph = batch.map(() => "?").join(",");
          // F-01 复核：notes 行同样回原父（扁平化子文档）。非扁平化行 COALESCE 保持原父，行为不变。
          this.ctx.db.prepare(
            `UPDATE notes SET parent_id=COALESCE(deleted_from_parent_id,parent_id),trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,is_dirty=1 WHERE id IN (${nph}) AND deleted_at IS NULL`,
          ).run(now, ...batch);
        }
      }
    });
    tx();
  }

  /**
   * 撤销本地删除（sync 下载分支在"远端恢复较新"时调用）：清 purge 墓碑；
   * 若本地有"收到他端 purge 后保留的回收站副本（purged）"，解除抑制（后续由下载/对账对齐）。
   * 与 restoreTrashItem 不同：不强制标 local——远端为权威，随后由下载/对账流程对齐并 markSynced。
   */
  revokeLocalDeletion(id: string): void {
    const now = nowIso();
    const tx = this.ctx.db.transaction(() => {
      this.ctx.db.prepare("DELETE FROM deleted_notes WHERE id=?").run(id);
      this.ctx.db.prepare("UPDATE notes SET is_dirty=1,is_purged=0,cloud_deleted=0 WHERE id=? AND (is_purged=1, is_dirty=0 OR is_purged=1)").run(id);
      this.ctx.db.prepare("UPDATE tree_nodes SET is_dirty=1,is_purged=0,cloud_deleted=0 WHERE note_file_id=? AND (is_purged=1, is_dirty=0 OR is_purged=1)").run(id);
      const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
      // 容错：本端已 purge（行被彻底删除）时跳过缓存/FTS——行将由下载分支 importRemoteNote 重建，
      // 避免 readNoteCaches 对不存在的行抛"笔记不存在"导致同步中断（远端恢复传播场景）。
      if (titleRow) {
        const caches = this.ctx.readNoteCaches(id);
        this.ctx.upsertSearch(id, titleRow.title, caches.plain ?? null);
      }
      this.ctx.db.prepare("UPDATE tree_nodes SET updated_at=? WHERE note_file_id=?").run(now, id);
    });
    tx();
  }

  /** 彻底删除回收站节点（不可恢复）：物理删子树 + 写 purge 墓碑（deleted_notes，带 purged_at）。
   * 墓碑上云（deleted:true）防其他端被动复活；其他端收到后保留本地副本并标 purged（可恢复）。
   * M4 前缀删除由同步侧按 listPurgedNotesForSync 执行。 */
  purgeTrashItem(id: string): void {
    const t0 = Date.now();
    // 回收站树内任意节点可 purge（含嵌套分组/文档子树；根或子树节点均可）。
    // 校验：节点必须在回收站笔记本子树内（根 = parent_id=trash，子树 = 祖先链含 trash）。
    const node = this.ctx.db.prepare(
      `WITH RECURSIVE trash_ancestors(id) AS (
         SELECT ? UNION
         SELECT t.parent_id FROM tree_nodes t JOIN trash_ancestors ta ON t.id=ta.id
       )
       SELECT t.id,t.note_file_id FROM tree_nodes t
       WHERE t.id=? AND t.deleted_at IS NULL AND (SELECT COUNT(*) FROM trash_ancestors WHERE id=?)>0`
    ).get(id, id, this.ctx.trashNotebookId) as { id: string; note_file_id: string | null } | undefined;
    if (!node) throw new AppError("NotFound", `回收站节点不存在: ${id}`);
    this.assertNotDiaryNotebook(id, "彻底删除");
    // F-01：子树必须覆盖「被同步扁平化成回收站容器的子文档」（按 deleted_from_parent_id 原始父链）。
    const ids = this.flattenedSubtreeIds(id);
    const filesToRemove: Array<{ path: string; recursive: boolean }> = [];
    const now = nowIso();
    const tx = this.ctx.db.transaction(() => {
      const nodeStmt = this.ctx.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?");
      const noteMeta = this.ctx.db.prepare("SELECT id,title,parent_id,sort_order,updated_at FROM notes WHERE id=?");
      // node_type：note（进 manifest.notes 发布 deleted:true）vs folder（仅本地下载过滤，不进 manifest）。
      // Del-6：墓碑不再有逐行 published_at；待同步判据 = deleted_at > 成功同步水线（见 syncReconciliation）。
      const tombstone = this.ctx.db.prepare(
        "INSERT INTO deleted_notes(id,title,parent_id,sort_order,updated_at,deleted_at,purged_at,node_type) VALUES(?,?,?,?,?,?,?,?) " +
        "ON CONFLICT(id) DO UPDATE SET title=excluded.title, parent_id=excluded.parent_id, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, purged_at=excluded.purged_at, node_type=excluded.node_type"
      );
      const delNote = this.ctx.db.prepare("DELETE FROM notes WHERE id=?");
      const delNode = this.ctx.db.prepare("DELETE FROM tree_nodes WHERE id=?");
      const delOrphans = this.ctx.db.prepare("DELETE FROM orphan_assets WHERE note_id=?");
      const delHistory = this.ctx.db.prepare("DELETE FROM note_history WHERE note_id=?");
      for (const nid of ids) {
        const n = nodeStmt.get(nid) as { note_file_id: string | null } | undefined;
        if (n?.note_file_id) {
          // P2-7：纵深防御——note_file_id 来自 DB（建库时已校验），此处统一口径 fail fast，
          // 防止任何异常来源的非法 ID 拼出落入 note_assets/history 目录的路径。
          if (!isSafePathSegment(n.note_file_id)) throw new AppError("InvalidInput", `无效的回收站笔记 ID: ${n.note_file_id}`);
          filesToRemove.push({ path: this.ctx.notePathFor(n.note_file_id), recursive: false });
          filesToRemove.push({ path: path.join(this.ctx.noteAssetsDir, n.note_file_id), recursive: true });
          // 彻底删除 = 连历史快照 + 历史引用的资源一起物理删（用户确认）
          filesToRemove.push({ path: this.ctx.historyNoteDirFor(n.note_file_id), recursive: true });
          const meta = noteMeta.get(n.note_file_id) as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
          // 墓碑必须无条件写：notes 行缺失（历史漂移/半途失败）时若跳过，云端该条目仍是 active，
          // 下次同步会把它连同资源重新导入到"已不存在的父"下 → UI 不可见的复活文档（2026-09-04）。
          // 元数据从 tree_nodes 兜底（同一棵树的权威副本），字段语义不变。
          const fallback = meta ?? this.ctx.db.prepare(
            "SELECT ? AS id, title, parent_id, sort_order, updated_at FROM tree_nodes WHERE id=?"
          ).get(n.note_file_id, nid) as { id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
          if (fallback) tombstone.run(fallback.id, fallback.title, fallback.parent_id, fallback.sort_order, fallback.updated_at, now, now, "note");
          delHistory.run(n.note_file_id);
          delOrphans.run(n.note_file_id);
          this.ctx.removeSearch([n.note_file_id]);
          delNote.run(n.note_file_id);
        } else {
          // folder/group（无 note_file_id）purge 也必须写墓碑（deleted_notes + purged_at）：
          // 否则物理删除后无任何持久"已删"记录，同步下载阶段会把远端 manifest.folders 里
          // 仍存在的该笔记本重新导入（删除/清空回收站后同步 → 被删的又回来）。
          const f = this.ctx.db.prepare("SELECT title,parent_id,sort_order,updated_at FROM tree_nodes WHERE id=?").get(nid) as { title: string; parent_id: string | null; sort_order: number; updated_at: string } | undefined;
          if (f) tombstone.run(nid, f.title, f.parent_id, f.sort_order, f.updated_at, now, now, "folder");
        }
        delNode.run(nid);
      }
    });
    tx();
    for (const f of filesToRemove) {
      try { fs.rmSync(f.path, { force: true, recursive: f.recursive }); }
      catch (error) { console.warn("[store] 彻底删除清理文件失败:", f.path, error); }
    }
    this.ctx.logScopes.store.info(`[perf] purge ${id} ${Date.now() - t0}ms (files=${filesToRemove.length})`);
  }

  /** 清空回收站：彻底删除 trash 笔记本的全部根节点（各 purge 连带子树，写 purge 墓碑）。
   * 只遍历根（parent_id=trash），避免整棵子树重复 purge。 */
  emptyTrash(): void {
    const items = this.ctx.db.prepare(
      "SELECT id FROM tree_nodes WHERE parent_id=? AND deleted_at IS NULL"
    ).all(this.ctx.trashNotebookId) as Array<{ id: string }>;
    for (const item of items) {
      // 日记本不允许被删除：历史脏数据（旧包取消过标记/手工塞进回收站）可能让它出现在回收站里。
      // 单个条目按理进不了回收站（deleteTreeNode 已拒）；这里跳过而不是让整个「清空回收站」失败。
      const row = this.ctx.db.prepare("SELECT node_type, space FROM tree_nodes WHERE id=?").get(item.id) as
        { node_type: string; space: string | null } | undefined;
      if (row && row.node_type === "notebook" && normalizeFolderSpace(row.space) === DIARY_FOLDER_SPACE) {
        this.ctx.logScopes.store.warn("[trash] 跳过日记本（不可删除）:", item.id);
        continue;
      }
      try { this.purgeTrashItem(item.id); }
      // 同 autoPurgeExpiredTrash：扁平化回收站子树里「组 + 组内子文档」都是根，前一个根的 purge 会连带
      // 删除其余（deleted_from_parent_id 链），后续根已不存在 ⇒ 幂等跳过，用户点「清空回收站」不得报错。
      catch (error) { if (!(error instanceof AppError && error.kind === "NotFound")) throw error; }
    }
  }
}