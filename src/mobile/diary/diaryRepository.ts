/**
 * 移动端「打开某一天日记」的幂等 ensure（docs/DIARY.md §IPC 契约 的移动等价物）。
 *
 * 移动端没有 IPC 主进程：同一份「日记笔记本 → 年组 → 月组 → 文档」的 ensure 直接落在 data 层，
 * 由 `bridge.diaryOpenDate` 在**写域**（runWrite）里调用 —— 整个 ensure 在一个事务里，连点只产生一篇。
 *
 * 判据**全部**来自 `src/core/diary`（单一来源，本文件不复制任何日期/分组/幂等逻辑）：
 *   · 日期键严格性 = parseDiaryDateKey（非法 ⇒ 拒绝并明确报错，docs/DIARY.md 硬规则 3）
 *   · 日记本定位 / 年月份组标题 = diaryNotebookId + diaryGroupTitles
 *   · 「打开已存在 / 需要新建」= planDiaryOpen（mode="open"）
 *   · 「永远新建一篇」= planDiaryCreate（mode="new"，261110：一天允许多篇）
 * 本文件只做 IO（读行、建行、写正文文件），不做判据。
 */
import {
  DIARY_FOLDER_SPACE,
  diaryNotebookId,
  diaryNotebooks,
  normalizeFolderSpace,
  parseDiaryDateKey,
  planDiaryCreate,
  planDiaryOpen,
  planDiaryUnmark,
  type DiaryTreeNode,
} from "../../core/diary.js";
import { emptyLakeBody } from "../../core/lakeDocForm.js";
import { nextSortOrder } from "../../core/treeRules.js";
import { reportDiaryWarning } from "../lib/diaryWarnLog.js";
import { createNote } from "../data/noteRepository.js";
import { executeBatchInTransaction, type MobileBatchStatement, type MobileDb } from "../data/sqliteDb.js";

/**
 * 日记本名（两端首次打开时各自建，名称必须一致才能被 wire 合并成同一本）。
 * 不放进 core：core 是判据，命名是产品文案。
 */
export const DIARY_NOTEBOOK_TITLE = "日记";

/**
 * 打开模式（与桌面 `diary_open_date` / `DiaryStore.openDate` 的 `mode` 同义，261110）：
 * · `"open"`（默认）= 幂等：当天已有就打开最新一篇、没有就建（「写今天 / 继续写今天」、首页 ＋→日记）；
 * · `"new"` = **永远新建一篇**（日记页右上角 ＋ = 今天新建、日历 = 选任意日期新建）。
 * 两者的容器（笔记本 / 年组 / 月组）都由 core 的 plan 补齐，本文件不另写判据。
 */
export type DiaryOpenMode = "open" | "new";

export interface DiaryOpenResult {
  noteId: string;
  /** 本次是否新建了文档（false = 当天已有，直接打开）。 */
  created: boolean;
  notebookId: string;
  /** 同名重复文档（历史脏数据）：只告警，不自动删除。 */
  duplicates: string[];
}

/** `clearDiaryMark` 的返回：cleared=false = 本来就不是日记本（连点第二次幂等，不是错误）。 */
export interface DiaryUnmarkResult {
  cleared: boolean;
}

interface FolderRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  node_type: string;
  updated_at: string;
  space: string | null;
}

interface NoteRow {
  id: string;
  title: string;
  parent_id: string | null;
  updated_at: string;
}

const LIST_FOLDERS_SQL =
  "SELECT id,title,parent_id,sort_order,node_type,updated_at,space FROM folders WHERE trashed_at IS NULL";

/** 目录行 → core 的结构类型（core 只认这四个字段；space 仅笔记本有效）。 */
function folderToDiaryNode(row: FolderRow): DiaryTreeNode {
  return {
    id: row.id, parentId: row.parent_id, nodeType: row.node_type, title: row.title,
    sortOrder: row.sort_order, updatedAt: row.updated_at, space: normalizeFolderSpace(row.space),
  };
}

/** 日记本子树里的全部 folder id（含笔记本自身）：用于只捞「这篇日记可能在的」文档行。 */
function subtreeFolderIds(rows: readonly FolderRow[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const bucket = children.get(row.parent_id);
    if (bucket) bucket.push(row.id);
    else children.set(row.parent_id, [row.id]);
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    for (const child of children.get(id) ?? []) stack.push(child);
  }
  return out;
}

/** 同级末尾排序位 = folders + notes 两张表的 MAX（与 noteRepository.nextSiblingSortOrder 同口径）。 */
async function maxSortOrder(d: MobileDb, parentId: string | null): Promise<number | null> {
  // parent_id IS ? 同时匹配 NULL 与具体 id（根节点 parent_id 是 NULL，用 = NULL 永不命中）。
  const folderRow = await d.prepare(
    "SELECT MAX(sort_order) AS m FROM folders WHERE parent_id IS ? AND trashed_at IS NULL",
  ).get(parentId) as { m: number | null } | undefined;
  const noteRow = await d.prepare(
    "SELECT MAX(sort_order) AS m FROM notes WHERE parent_id IS ? AND trashed_at IS NULL",
  ).get(parentId) as { m: number | null } | undefined;
  const values = [folderRow?.m ?? null, noteRow?.m ?? null].filter((v): v is number => typeof v === "number");
  return values.length > 0 ? Math.max(...values) : null;
}

/**
 * 打开 / 新建 `dateKey` 当天的日记，返回文档 id。
 *
 * `mode`：`"open"`（默认，幂等）/ `"new"`（永远新建一篇；261110 用户定稿，一天允许多篇）。
 * 事务边界 = 整个 ensure（笔记本 → 年组 → 月组 → 文档）：任何一步失败整体回滚，不留半成品。
 * 失败分级（docs/DIARY.md 硬规则 3）：日期键非法 ⇒ 抛错（调用方明说）；建正文模板失败 ⇒ 抛错回滚。
 */
export async function ensureDiaryNote(d: MobileDb, dateKey: string, mode: DiaryOpenMode = "open"): Promise<DiaryOpenResult> {
  const normalized = parseDiaryDateKey(dateKey);
  if (!normalized) throw new Error("日期键非法（要求 YYYY-MM-DD）：" + dateKey);
  return await d.transaction(async (): Promise<DiaryOpenResult> => {
    const folderRows = await d.prepare(LIST_FOLDERS_SQL).all() as unknown as FolderRow[];
    // 硬规则 2：多个日记本 = 历史脏数据（如旧便携包丢了 space 又不小心建了第二本）⇒ 取第一个为准，只告警不自动修复。
    if (diaryNotebooks(folderRows.map(folderToDiaryNode)).length > 1) {
      // 与桌面 diaryStore.warnMultipleNotebooks 同义；移动端 console.warn 不可见（打包版没有终端）
      // ⇒ 落设备本地环形缓冲，由设置 → 关于 →「复制诊断信息」带出（不进 S3、不改设置页 DOM）。
      reportDiaryWarning("multiple-notebooks");
    }
    let notebookId = diaryNotebookId(folderRows.map(folderToDiaryNode));
    const statements: MobileBatchStatement[] = [];
    if (!notebookId) {
      // 首次打开：建日记本（space="diary"，wire 上靠它识别；主库不另建空间/表）。
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const sortOrder = nextSortOrder(await maxSortOrder(d, null));
      statements.push({
        statement: "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty,space) VALUES (?,?,NULL,?,?,NULL,?,1,?)",
        values: [id, DIARY_NOTEBOOK_TITLE, sortOrder, "notebook", now, DIARY_FOLDER_SPACE],
      });
      // 内存里同步补上这一行：下面的 plan 直接基于「刚建好的本」继续，不必回查。
      folderRows.push({ id, title: DIARY_NOTEBOOK_TITLE, parent_id: null, sort_order: sortOrder, node_type: "notebook", updated_at: now, space: DIARY_FOLDER_SPACE });
      notebookId = id;
    }
    const subtree = subtreeFolderIds(folderRows, notebookId);
    const placeholders = subtree.map(() => "?").join(",");
    const noteRows = await d.prepare(
      "SELECT id,title,parent_id,updated_at FROM notes WHERE trashed_at IS NULL AND parent_id IN (" + placeholders + ")",
    ).all(...subtree) as unknown as NoteRow[];
    const nodes: DiaryTreeNode[] = [
      ...folderRows.map(folderToDiaryNode),
      ...noteRows.map((row) => ({ id: row.id, parentId: row.parent_id, nodeType: "note", title: row.title, updatedAt: row.updated_at })),
    ];
    // 判据单一来源：open = planDiaryOpen（命中已有就不建）；new = planDiaryCreate（永远新建）。
    // new 模式下「已有/重复」字段恒空 —— 当天其它条目是正常数据，不再是"历史脏数据告警"
    // （与桌面 electron/diaryStore.openDate 的 mode:"new" 同口径）。
    const plan = mode === "new"
      ? { ...planDiaryCreate(nodes, normalized), existingNoteId: null, duplicateNoteIds: [] as string[] }
      : planDiaryOpen(nodes, normalized);
    if (plan.existingNoteId) {
      return { noteId: plan.existingNoteId, created: false, notebookId, duplicates: plan.duplicateNoteIds };
    }
    // 年/月同时缺失时 core 给两者的 parentId 都是笔记本（core/diary.test.ts「年、月两级依次建」）；
    // 按 plan 的顺序**接链**落库，层级才是 日记 / 年 / 月 / 日期。
    const now = new Date().toISOString();
    let parentId = plan.groupsToCreate[0]?.parentId ?? notebookId;
    for (const group of plan.groupsToCreate) {
      const id = crypto.randomUUID();
      const sortOrder = nextSortOrder(await maxSortOrder(d, parentId));
      statements.push({
        statement: "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty,space) VALUES (?,?,?,?,?,NULL,?,1,NULL)",
        values: [id, group.title, parentId, sortOrder, group.nodeType, now],
      });
      parentId = id;
    }
    await executeBatchInTransaction(d, statements);
    // 落点：有新建分组 ⇒ 最内层那个（月）；一级都不用建 ⇒ 用 plan 给的 noteParentId（月 → 年 → 笔记本），
    // **不能直接用 notebookId** —— 否则同月第二篇会挂到日记本根上、层级错位（与桌面
    // electron/diaryStore.openDate 的 noteParentId 口径一致；261110 修）。
    const noteParentId = plan.groupsToCreate.length > 0 ? parentId : (plan.noteParentId ?? notebookId);
    // 正文 = 空 Lake 文档（模板即"没有模板"；v1 不做模板，见 docs/DIARY.md「不做」）。
    // createNote 内部：先写正文文件、再插行、再索引；它在事务内 ⇒ 与上面的目录行同生共死。
    const noteId = crypto.randomUUID();
    await createNote(d, noteId, normalized, emptyLakeBody(noteId), noteParentId, new Map(), undefined, "doc", {
      skipOrphanScan: true,
    });
    return { noteId, created: true, notebookId, duplicates: plan.duplicateNoteIds };
  });
}

/**
 * 「取消日记标记」（整本；261110 收尾，桌面 `diary_unmark` 的移动等价物）。
 *
 * 语义：只把**日记笔记本这一行**的 `space` 置 NULL（笔记本 + 年/月分组 + 文档原样保留），
 * 之后它回到知识库、日记时间线不再包含它（`diaryEntries` 只扫 `space="diary"` 的子树）。
 *
 * 口径与桌面 `DiaryStore.unmarkNotebook` 一致：
 * 1. 判据来自 core `planDiaryUnmark`（只认 notebook + space=diary，不看标题）；
 * 2. 写入是**单条原子 UPDATE**（`WHERE id=? AND space='diary'` 自带乐观守卫，不需要批量事务）；
 *    `updated_at` 必须 bump —— 目录元数据（含 space）的同步传播判据就是 updatedAt
 *    （见 src/core/s3v3/plan/planFolderSpace.test.ts）；
 * 3. **幂等**：已经取消 / 不是日记本 ⇒ `cleared:false`，不抛错（连点第二次不是失败）。
 */
export async function clearDiaryNotebookMark(d: MobileDb, notebookId: string): Promise<DiaryUnmarkResult> {
  const folderRows = await d.prepare(LIST_FOLDERS_SQL).all() as unknown as FolderRow[];
  const plan = planDiaryUnmark(folderRows.map(folderToDiaryNode), notebookId);
  if (!plan.ok) return { cleared: false };
  const now = new Date().toISOString();
  const result = await d.prepare(
    "UPDATE folders SET space=NULL, updated_at=?, is_dirty=1 WHERE id=? AND node_type='notebook' AND space=? AND trashed_at IS NULL",
  ).run(now, plan.notebookId, DIARY_FOLDER_SPACE);
  return { cleared: result.changes > 0 };
}
