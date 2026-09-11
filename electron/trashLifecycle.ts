import fs from "node:fs";
import path from "node:path";
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
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

  /** 包含已删除节点的后代（用于彻底删除回收站子树） */
  private descendantIdsIncludingDeleted(id: string): string[] {
    const result: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      result.push(cur);
      const children = this.ctx.db.prepare("SELECT id FROM tree_nodes WHERE parent_id=?").all(cur) as { id: string }[];
      for (const c of children) stack.push(c.id);
    }
    return result;
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
    const node = this.ctx.readTreeNode(id);
    if (node.parentId === this.ctx.trashNotebookId) return; // 已在回收站
    const now = nowIso();
    const tx = this.ctx.db.transaction(() => {
      if (node.noteFileId) {
        // restore_pending_at 一并清除：恢复后未同步再删除，残留标记会以"恢复语义"上传（trashedAt:null）
        // 导致本地删除不传播、云端复活（与 applyRemoteMoveToTrash/applyRemoteRestore 同口径清理）。
        this.ctx.db.prepare(
          "UPDATE notes SET parent_id=?,trashed_at=?,deleted_from_parent_id=?,updated_at=?,sync_state='local',restore_pending_at=NULL WHERE id=? AND deleted_at IS NULL"
        ).run(this.ctx.trashNotebookId, now, node.parentId, now, node.noteFileId);
      }
      this.ctx.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=?,deleted_from_parent_id=?,updated_at=?,sync_state='local' WHERE id=? AND deleted_at IS NULL"
      ).run(this.ctx.trashNotebookId, now, node.parentId, now, id);
      // 级联：子树所有节点（嵌套分组 + 笔记）跟随根进回收站——trashed_at 必须标上，
      // 否则同步发布时子树按"正常"传播，其他端不跟随删除（内容"没删掉"、根恢复/删除语义不一致）。
      const subtreeIds = this.descendantIdsIncludingDeleted(id).filter((sid) => sid !== id);
      if (subtreeIds.length > 0) {
        const subNotes: Array<{ note_file_id: string }> = [];
        for (const batch of sqlParameterBatches(subtreeIds)) {
          const ph = batch.map(() => "?").join(",");
          this.ctx.db.prepare(`UPDATE tree_nodes SET trashed_at=?,updated_at=?,sync_state='local' WHERE id IN (${ph}) AND deleted_at IS NULL`).run(now, now, ...batch);
          subNotes.push(...this.ctx.db.prepare(`SELECT note_file_id FROM tree_nodes WHERE id IN (${ph}) AND note_file_id IS NOT NULL AND deleted_at IS NULL`).all(...batch) as Array<{ note_file_id: string }>);
        }
        const subNoteIds = subNotes.map((s) => s.note_file_id);
        for (const batch of sqlParameterBatches(subNoteIds)) {
          const nph = batch.map(() => "?").join(",");
          this.ctx.db.prepare(`UPDATE notes SET trashed_at=?,updated_at=?,sync_state='local',restore_pending_at=NULL WHERE id IN (${nph}) AND deleted_at IS NULL`).run(now, now, ...batch);
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
    for (const r of rows) this.purgeTrashItem(r.id);
    return rows.length;
  }

  /** 审计（编辑即恢复）：编辑"他端已 purge、本端保留"（sync_state='purged'）的回收站条目时，
   * 视为一次显式恢复：移出回收站 + restore_pending_at（D2 例外，后续编辑内容作为恢复版上传）。
   * 返回是否发生了恢复。 */
  revivePurgedIfNeeded(id: string): boolean {
    const row = this.ctx.db.prepare(
      "SELECT t.note_file_id FROM tree_nodes t JOIN notes n ON n.id = t.note_file_id WHERE t.id=? AND t.parent_id=? AND n.sync_state='purged' AND n.deleted_at IS NULL"
    ).get(id, this.ctx.trashNotebookId) as { note_file_id: string | null } | undefined;
    if (!row?.note_file_id) return false;
    this.restoreTrashItem(row.note_file_id);
    return true;
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
    if (parentId === null || parentId === this.ctx.trashNotebookId) {
      parentId = isNotebook ? null : this.ctx.resolveParentNotebook();
    } else {
      // 原父必须存在、未被删、且不在回收站内，否则回退默认笔记本。
      // 注意：根级笔记本 parent_id 为 NULL，`parent_id != ?` 会因 SQL 三值逻辑得 NULL 而漏判，
      // 导致恢复到根级笔记本时误回退到默认笔记本（恢复位置错误）——必须显式允许 NULL。
      const parent = this.ctx.db.prepare(
        "SELECT id FROM tree_nodes WHERE id=? AND deleted_at IS NULL AND (parent_id IS NULL OR parent_id != ?)"
      ).get(parentId, this.ctx.trashNotebookId) as { id: string } | undefined;
      if (!parent) parentId = this.ctx.resolveParentNotebook();
    }
    const now = nowIso();
    const tx = this.ctx.db.transaction(() => {
      if (node.note_file_id) {
        this.ctx.db.prepare(
          "UPDATE notes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,sync_state='local',restore_pending_at=? WHERE id=?"
        ).run(parentId, now, now, node.note_file_id);
        const titleRow = this.ctx.db.prepare("SELECT title FROM notes WHERE id=?").get(node.note_file_id) as { title: string } | undefined;
        const caches = this.ctx.readNoteCaches(node.note_file_id);
        this.ctx.upsertSearch(node.note_file_id, titleRow?.title ?? "", caches.plain ?? null);
      }
      this.ctx.db.prepare(
        "UPDATE tree_nodes SET parent_id=?,trashed_at=NULL,deleted_from_parent_id=NULL,updated_at=?,sync_state='local' WHERE id=?"
      ).run(parentId, now, id);
      // 级联：子树（跟随根进回收站的嵌套分组/笔记）随根恢复——清 trashed_at（父位置不变）。
      const subtreeIds = this.descendantIdsIncludingDeleted(id).filter((sid) => sid !== id);
      if (subtreeIds.length > 0) {
        const subNotes: Array<{ note_file_id: string }> = [];
        for (const batch of sqlParameterBatches(subtreeIds)) {
          const ph = batch.map(() => "?").join(",");
          this.ctx.db.prepare(`UPDATE tree_nodes SET trashed_at=NULL,updated_at=?,sync_state='local' WHERE id IN (${ph}) AND deleted_at IS NULL`).run(now, ...batch);
          subNotes.push(...this.ctx.db.prepare(`SELECT note_file_id FROM tree_nodes WHERE id IN (${ph}) AND note_file_id IS NOT NULL AND deleted_at IS NULL`).all(...batch) as Array<{ note_file_id: string }>);
        }
        const subNoteIds = subNotes.map((s) => s.note_file_id);
        for (const batch of sqlParameterBatches(subNoteIds)) {
          const nph = batch.map(() => "?").join(",");
          this.ctx.db.prepare(`UPDATE notes SET trashed_at=NULL,updated_at=?,sync_state='local' WHERE id IN (${nph}) AND deleted_at IS NULL`).run(now, ...batch);
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
      this.ctx.db.prepare("UPDATE notes SET sync_state='local' WHERE id=? AND sync_state='purged'").run(id);
      this.ctx.db.prepare("UPDATE tree_nodes SET sync_state='local' WHERE note_file_id=? AND sync_state='purged'").run(id);
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
         SELECT ? UNION ALL
         SELECT t.parent_id FROM tree_nodes t JOIN trash_ancestors ta ON t.id=ta.id
       )
       SELECT t.id,t.note_file_id FROM tree_nodes t
       WHERE t.id=? AND t.deleted_at IS NULL AND (SELECT COUNT(*) FROM trash_ancestors WHERE id=?)>0`
    ).get(id, id, this.ctx.trashNotebookId) as { id: string; note_file_id: string | null } | undefined;
    if (!node) throw new AppError("NotFound", `回收站节点不存在: ${id}`);
    const ids = this.descendantIdsIncludingDeleted(id);
    const filesToRemove: Array<{ path: string; recursive: boolean }> = [];
    const now = nowIso();
    const tx = this.ctx.db.transaction(() => {
      const nodeStmt = this.ctx.db.prepare("SELECT note_file_id FROM tree_nodes WHERE id=?");
      const noteMeta = this.ctx.db.prepare("SELECT id,title,parent_id,sort_order,updated_at FROM notes WHERE id=?");
      // node_type：note（进 manifest.notes 发布 deleted:true）vs folder（仅本地下载过滤，不进 manifest）。
      // 新墓碑 published_at=NULL（未发布，计入待上传）；ON CONFLICT 不清已发布的 published_at（幂等重复 purge 场景）。
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
    for (const item of items) this.purgeTrashItem(item.id);
  }
}
