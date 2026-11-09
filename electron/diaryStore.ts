/**
 * 日记存储（261109，docs/DIARY.md）——桌面侧「打开某一天」的**唯一写入口**。
 *
 * 数据形态（D2）：日记 = 笔记本体系内的普通 Lake 文档，**不新建表、不新建数据空间**：
 *   日记笔记本（tree_nodes.space='diary'） → 年分组 → 月分组 → 文档（标题 = YYYY-MM-DD）。
 *
 * 三条硬约束（都来自 docs/DIARY.md，不要在这里另立判据）：
 * 1. **判据全部来自 src/core/diary**：日期键严格性、年/月分组、幂等 plan、重复文档告警；
 *    本模块只按 plan 执行，不自己解析日期、不自己找节点。
 * 2. **主进程重新 plan**：入口只收 dateKey，节点快照在本模块内现读（不信渲染层传的 nodeId），
 *    从机制上排除 TOCTOU。
 * 3. **一次事务写完**：笔记本 → 年组 → 月组 → 文档 的元数据写入在同一个 `db.transaction` 里；
 *    正文文件先落盘、事务失败时按「元数据没成功 ⇒ 回收半成品」的既有口径清理
 *    （与 Store.createNoteInWithContent 同款边界）。better-sqlite3 同步执行 ⇒ 连点两次不会交错。
 */
import fs from "node:fs";
import type { DbLike } from "./dbLike.js";
import { AppError } from "../src/core/storeErrors.js";
import { isSafePathSegment } from "../src/core/storeUtils.js";
import { emptyLakeBody } from "../src/core/lakeDocForm.js";
import {
  DIARY_FOLDER_SPACE,
  diaryNotebooks,
  parseDiaryDateKey,
  planDiaryOpen,
  type DiaryTreeNode,
} from "../src/core/diary.js";

/** 自动创建日记笔记本书名（只在**首次**创建时使用；之后以用户改名为准，不在这里比对）。 */
export const DIARY_NOTEBOOK_TITLE = "日记";

/** `diary_open_date` 的返回（跨片契约，见 docs/DIARY.md「IPC 契约」）。 */
export interface DiaryOpenResult {
  noteId: string;
  /** 本次是否真的新建了文档（false = 命中已有）。 */
  created: boolean;
  notebookId: string;
  /** 同名重复文档（历史脏数据）：只告警，绝不自动删除。 */
  duplicates: string[];
}

export interface DiaryStoreDeps {
  db: DbLike;
  workspaceId: string;
  /** 与 IPC `list_tree_nodes` 同一读源（含 space）；主进程 plan 的唯一事实来源。 */
  listTreeNodes(): DiaryTreeNode[];
  nextSortOrder(parentId: string | null): number;
  uuid(): string;
  nowIso(): string;
  atomicWrite(filePath: string, content: string): void;
  noteBodyPath(noteId: string): string;
  /** 新建文档后立即入 FTS（失败不阻断，由全量重建修复）。 */
  upsertSearch?(noteId: string, title: string, body: string | null): void;
  log?(message: string): void;
}

export class DiaryStore {
  constructor(private readonly deps: DiaryStoreDeps) {}

  /**
   * 打开某一天的日记（幂等）：已存在就直接返回，否则在**单事务**里补齐笔记本/年组/月组/文档。
   * 日期键非法 ⇒ `AppError("InvalidInput")`（fail-closed；不猜、不退化成今天）。
   */
  openDate(rawDateKey: string): DiaryOpenResult {
    const dateKey = parseDiaryDateKey(String(rawDateKey ?? ""));
    if (!dateKey) {
      throw new AppError("InvalidInput", "日期格式非法，要求 YYYY-MM-DD 且日期真实存在");
    }

    // 主进程现读一次节点快照后 plan：渲染层传什么都不影响落点。
    const initialPlan = planDiaryOpen(this.deps.listTreeNodes(), dateKey);
    this.warnMultipleNotebooks();

    if (initialPlan.existingNoteId) {
      return {
        noteId: initialPlan.existingNoteId,
        created: false,
        notebookId: initialPlan.notebookId ?? "",
        duplicates: initialPlan.duplicateNoteIds,
      };
    }

    const id = this.deps.uuid();
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const now = this.deps.nowIso();
    const bodyPath = this.deps.noteBodyPath(id);
    let notebookId = initialPlan.notebookId ?? "";
    let plan = initialPlan;

    try {
      // 与既有新建文档同口径：正文先原子落盘，再在单事务里写元数据。
      this.deps.atomicWrite(bodyPath, emptyLakeBody(id));
      const tx = this.deps.db.transaction(() => {
        // 1) 日记笔记本：plan.notebookId === null ⇒ 先建本；建完的 id 直接参与后续层级。
        notebookId = plan.notebookId ?? this.ensureDiaryNotebook(now);
        // 笔记本不存在时 plan 只给出 notebookId=null（层级判据全依赖笔记本），所以**建完必须重新 plan**
        // （docs/DIARY.md「IPC 契约」：主进程重新 plan，不信渲染层；这里也是同一口径，只是多一轮）。
        if (!plan.notebookId) plan = planDiaryOpen(this.deps.listTreeNodes(), dateKey);
        // 2) 年 → 月分组：plan 已给出"缺哪些、按什么顺序、第一层的父是谁"。
        //    后续层的父 = 上一步真正创建/命中的那个节点（plan 里的 parentId 只在第一层是确定的）。
        let parentId = plan.groupsToCreate[0]?.parentId ?? notebookId;
        for (const group of plan.groupsToCreate) {
          parentId = this.ensureGroup(parentId, group.title, now);
        }
        const noteParentId = plan.groupsToCreate.length > 0 ? parentId : (plan.noteParentId ?? notebookId);
        // 3) 文档：标题即日期；space 只属于笔记本，分组/文档恒 NULL。
        this.createNote(id, noteParentId, dateKey, now);
      });
      tx();
    } catch (error) {
      // 元数据没成功 ⇒ 正文半成品必须回收（元数据已成功则绝不误删）。
      const exists = this.deps.db.prepare("SELECT 1 FROM notes WHERE id=?").get(id);
      if (!exists) {
        try { fs.rmSync(bodyPath, { force: true }); } catch { /* best effort */ }
      }
      throw error;
    }

    try { this.deps.upsertSearch?.(id, dateKey, ""); } catch { /* 索引失败不阻断创建 */ }
    if (plan.duplicateNoteIds.length > 0) {
      this.deps.log?.("[diary] 同一天存在 " + plan.duplicateNoteIds.length + " 篇重复文档（只告警不删除）: " + plan.duplicateNoteIds.join(","));
    }
    return { noteId: id, created: true, notebookId, duplicates: plan.duplicateNoteIds };
  }

  /** 日记笔记本的行（只读；诊断/测试用）。 */
  diaryNotebook(): DiaryTreeNode | null {
    return diaryNotebooks(this.deps.listTreeNodes())[0] ?? null;
  }

  /** 取第一个 space='diary' 的笔记本；没有则建一个（**必须在事务里调用**）。 */
  private ensureDiaryNotebook(now: string): string {
    const existing = diaryNotebooks(this.deps.listTreeNodes())[0];
    if (existing) return existing.id;
    const id = this.deps.uuid();
    const sortOrder = this.deps.nextSortOrder(null);
    this.deps.db.prepare(
      "INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_dirty,is_conflict,space) VALUES(?,?,NULL,'notebook',?,NULL,?,?,?,1,0,?)",
    ).run(id, this.deps.workspaceId, DIARY_NOTEBOOK_TITLE, sortOrder, now, now, DIARY_FOLDER_SPACE);
    return id;
  }

  /** 取父下同名分组；没有则建（**必须在事务里调用**）。 */
  private ensureGroup(parentId: string, title: string, now: string): string {
    const trimmed = title.trim();
    const existing = this.deps.listTreeNodes().find(
      (node) => node.parentId === parentId && node.nodeType === "group" && node.title.trim() === trimmed,
    );
    if (existing) return existing.id;
    const id = this.deps.uuid();
    const sortOrder = this.deps.nextSortOrder(parentId);
    this.deps.db.prepare(
      "INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_dirty,is_conflict) VALUES(?,?,?,'group',?,NULL,?,?,?,1,0)",
    ).run(id, this.deps.workspaceId, parentId, trimmed, sortOrder, now, now);
    return id;
  }

  /** 建文档（notes + tree_nodes 两行；正文由调用方先落盘）。**必须在事务里调用**。 */
  private createNote(id: string, parentId: string, title: string, now: string): void {
    const sortOrder = this.deps.nextSortOrder(parentId);
    this.deps.db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,is_dirty,kind) VALUES(?,?,?,?,?,1,'doc')")
      .run(id, title, parentId, sortOrder, now);
    this.deps.db.prepare(
      "INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_dirty,is_conflict) VALUES(?,?,?,'note',?,?,?,?,?,1,0)",
    ).run(id, this.deps.workspaceId, parentId, title, id, sortOrder, now, now);
  }

  /** 多个日记本 = 历史脏数据：取第一个为准，只告警不修复（DIARY.md 硬规则 2）。 */
  private warnMultipleNotebooks(): void {
    if (diaryNotebooks(this.deps.listTreeNodes()).length > 1) {
      this.deps.log?.("[diary] 存在多个 space='diary' 的笔记本：取第一个为准（不自动修复）");
    }
  }
}
