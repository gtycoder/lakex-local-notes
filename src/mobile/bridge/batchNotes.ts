/**
 * 移动端批量操作桥（261106 task-82）：**复用 core/batchNotes 的编排**，只在平台侧注入 executor。
 *
 * 为什么这样切：
 * - core 负责「输入清洗 → 全部校验 → 一次性交给平台执行」，桌面/移动共用同一套判据与结果契约
 *   （{ ok, results:[{id,ok,reason?}], summary:{total,done,failed} }）；
 * - 移动端 DB 是异步 sql.js，而 core 的 executor 接口是同步的 ⇒ 这里**先同步预取快照**（describe/parents/标签目录），
 *   让 core 的同步校验跑在快照上；校验全部通过后，再把落地动作放进**一个异步事务**里执行，
 *   事务失败按契约整批回滚并回报 failed。
 * - 删除语义只有一种：**移入回收站**（lake → 文档回收站；quickNotes → 小记回收站），都可恢复；
 *   没有物理删除 / 清索引 / 清对象（261106 用户硬规则：只有回收站里能彻底删除）。
 * - 笔记本一律不可批处理（core 先拦；executor.supports 再防御一次）。
 */
import {
  runBatchNotes,
  type BatchNotesExecutor,
  type BatchNotesInput,
  type BatchNotesItem,
  type BatchNotesNodeInfo,
  type BatchNotesNodeKind,
  type BatchNotesParentStatus,
  type BatchNotesReason,
  type BatchNotesResult,
  type BatchNotesSpace,
} from "../../core/batchNotes";
import type { MobileDb } from "../data/sqliteDb";
import { ensureDb, runWrite } from "./context";
import * as noteRepository from "../data/noteRepository.js";
import * as noteTagLinksRepository from "../data/noteTagLinksRepository.js";
import * as quickNoteTagLinksRepository from "../data/quickNoteTagLinksRepository.js";
import { deleteQuickNote } from "../data/quickNotesRepository.js";
import { listQuickNoteTags } from "../data/quickNoteTagsRepository.js";
import { diaryNotebookOf } from "../data/treeRepository.js";
import { DIARY_FOLDER_SPACE, normalizeFolderSpace } from "../../core/diary.js";

/** 父链保护上限（与 core/桌面一致，防环）。 */
const MAX_PARENT_HOPS = 64;
/** IN (...) 参数分批（SQLite 变量上限 999；单批 ≤500 已经够，这里仍分批防御）。 */
const SQL_CHUNK = 400;

interface LakeMeta {
  kind: BatchNotesNodeKind;
  trashed: boolean;
  parentId: string | null;
  /** 目录行的空间标记（只有 notebook 可能为 "diary"；缺省/null = 非日记，见 core/diary.normalizeFolderSpace）。 */
  space?: string | null;
}

interface BatchSnapshot {
  lake: Map<string, LakeMeta>;
  quick: Map<string, boolean>;
  /** move 目标父级的祖先链（含父级自身）；null 父级 = 根。 */
  ancestors: Set<string>;
  /**
   * move 目标父级是否落在日记子树（含日记本本身）；261113 用户裁决（AGENTS §3#25②）：
   * 日记空间不是移动目标（顺序由日期派生，且不支持反向移入）。
   */
  parentInDiary: boolean;
  activeTagIds: ReadonlySet<string> | null;
}

function chunk<T>(items: readonly T[], size = SQL_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const placeholders = (count: number): string => Array.from({ length: count }, () => "?").join(",");

/**
 * 读 lake 空间（notes / folders）的元数据；额外把 move 目标父级的祖先链补齐（环检测用），
 * 并顺带判定「目标父级是否在日记子树」（判据 = 链上出现 space='diary' 的笔记本，与数据层 diaryNotebookOf 同口径）。
 */
async function loadLakeMeta(d: MobileDb, ids: readonly string[], parentRoot: string | null): Promise<{ lake: Map<string, LakeMeta>; ancestors: Set<string>; parentInDiary: boolean }> {
  const lake = new Map<string, LakeMeta>();
  let parentInDiary = false;
  const noteDiary = (meta: LakeMeta): boolean => meta.kind === "notebook" && normalizeFolderSpace(meta.space) === DIARY_FOLDER_SPACE;
  for (const part of chunk([...new Set(ids)])) {
    if (part.length === 0) continue;
    const notes = await d.prepare("SELECT id, parent_id, deleted_at FROM notes WHERE id IN (" + placeholders(part.length) + ")").all(...part) as Array<{ id: string; parent_id: string | null; deleted_at: string | null }>;
    for (const row of notes) lake.set(String(row.id), { kind: "note", trashed: row.deleted_at != null, parentId: row.parent_id ?? null });
    const folders = await d.prepare("SELECT id, parent_id, node_type, trashed_at, space FROM folders WHERE id IN (" + placeholders(part.length) + ")").all(...part) as Array<{ id: string; parent_id: string | null; node_type: string; trashed_at: string | null; space: string | null }>;
    for (const row of folders) {
      lake.set(String(row.id), {
        kind: row.node_type === "notebook" ? "notebook" : "folder",
        trashed: row.trashed_at != null,
        parentId: row.parent_id ?? null,
        space: row.space ?? null,
      });
    }
  }

  // move 目标父级的祖先链：core 的 wouldCreateCycle 是同步调用，必须提前全部取到。
  const ancestors = new Set<string>();
  let cursor = parentRoot;
  for (let hops = 0; cursor && hops < MAX_PARENT_HOPS; hops += 1) {
    ancestors.add(cursor);
    const known = lake.get(cursor);
    if (known) { if (noteDiary(known)) parentInDiary = true; cursor = known.parentId; continue; }
    const note = await d.prepare("SELECT parent_id FROM notes WHERE id=?").get(cursor) as { parent_id: string | null } | undefined;
    if (note) {
      lake.set(cursor, { kind: "note", trashed: false, parentId: note.parent_id ?? null });
      cursor = note.parent_id ?? null;
      continue;
    }
    const folder = await d.prepare("SELECT parent_id, node_type, trashed_at, space FROM folders WHERE id=?").get(cursor) as { parent_id: string | null; node_type: string; trashed_at: string | null; space: string | null } | undefined;
    if (!folder) break;
    const meta: LakeMeta = {
      kind: folder.node_type === "notebook" ? "notebook" : "folder",
      trashed: folder.trashed_at != null,
      parentId: folder.parent_id ?? null,
      space: folder.space ?? null,
    };
    lake.set(cursor, meta);
    if (noteDiary(meta)) parentInDiary = true;
    cursor = folder.parent_id ?? null;
  }
  return { lake, ancestors, parentInDiary };
}

/** 小记空间：quick_notes 行（purged 的已不在本表 ⇒ 自然按 not-found）。 */
async function loadQuickMeta(d: MobileDb, ids: readonly string[]): Promise<Map<string, boolean>> {
  const quick = new Map<string, boolean>();
  for (const part of chunk([...new Set(ids)])) {
    if (part.length === 0) continue;
    const rows = await d.prepare("SELECT id, deleted_at FROM quick_notes WHERE id IN (" + placeholders(part.length) + ")").all(...part) as Array<{ id: string; deleted_at: string | null }>;
    for (const row of rows) quick.set(String(row.id), row.deleted_at != null);
  }
  return quick;
}

async function loadActiveTagIds(d: MobileDb): Promise<ReadonlySet<string> | null> {
  try {
    const tags = await listQuickNoteTags(d);
    return new Set(tags.map((tag) => tag.id));
  } catch {
    return null; // 目录不可用 ⇒ core 按 tag-unavailable 整批拒绝
  }
}

/**
 * 移动端支持面（与桌面各自能力，但结果契约一致）：
 * - lake：文档全部动作；分组只支持 move；笔记本由 core 先拦。
 * - quickNotes：trash（进小记回收站）+ tag-add / tag-remove（打标签）；不支持 move。
 */
export function mobileBatchSupports(action: BatchNotesInput["action"], node: BatchNotesNodeInfo, space: BatchNotesSpace): true | BatchNotesReason {
  if (space === "quickNotes") {
    if (node.kind !== "quick-note") return "unsupported";
    return action === "trash" || action === "tag-add" || action === "tag-remove" ? true : "unsupported";
  }
  if (node.kind === "note") return true;
  if (action === "move" && node.kind === "folder") return true;
  return "unsupported";
}

async function nextSortOrder(d: MobileDb, parentId: string | null): Promise<number> {
  const row = await d.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS m FROM (SELECT sort_order FROM notes WHERE parent_id IS ? UNION ALL SELECT sort_order FROM folders WHERE parent_id IS ?)",
  ).get(parentId, parentId) as { m?: number } | undefined;
  return Number(row?.m ?? -1) + 1;
}

/** 单个事务里逐条落地（抛错 = 整批回滚，由调用方转成 failed 结果）。
 * 导出仅供单测直接验证第二道闸（正常入口先过 core 校验；这里防的是绕过 core 的直接调用）。 */
export async function applyBatchItems(d: MobileDb, items: readonly BatchNotesItem[]): Promise<void> {
  await d.transaction(async () => {
    const now = new Date().toISOString();
    /** 同一目标父级的多条移动要依次追加，不能共用同一个 sortOrder。 */
    const nextOrder = new Map<string | null, number>();
    for (const item of items) {
      if (item.action === "move") {
        // 第二道闸（core 校验阶段的 describeParent 已整批拒绝；这里防"直接调 apply"的路径）：
        // 目标父级在日记子树 ⇒ 整批失败并回滚（日记空间不支持移入，顺序由日期派生）。
        if (item.parentId !== null && await diaryNotebookOf(d, item.parentId) !== null) {
          throw new Error("日记本不能作为移动目标（不支持把文档移入日记空间）: " + item.parentId);
        }
        const order = nextOrder.get(item.parentId) ?? await nextSortOrder(d, item.parentId);
        nextOrder.set(item.parentId, order + 1);
        // 文档与分组分表：按是否存在 notes 行判断（describe 已校验过存在性，这里只决定写入哪张表）。
        const isNote = await d.prepare("SELECT 1 FROM notes WHERE id=?").get(item.id);
        if (isNote) {
          await d.prepare("UPDATE notes SET parent_id=?, sort_order=?, updated_at=?, is_dirty=1 WHERE id=?").run(item.parentId, order, now, item.id);
        } else {
          await d.prepare("UPDATE folders SET parent_id=?, sort_order=?, updated_at=?, is_dirty=1 WHERE id=?").run(item.parentId, order, now, item.id);
        }
        continue;
      }
      if (item.action === "trash") {
        if (item.space === "quickNotes") await deleteQuickNote(d, item.id);
        else await noteRepository.trashNote(d, item.id);
        continue;
      }
      if (item.action === "tag-add") {
        if (item.space === "quickNotes") {
          const current = await quickNoteTagLinksRepository.listQuickNoteTagIds(d, item.id);
          const next = [...current];
          for (const tagId of item.tagIds) if (!next.includes(tagId)) next.push(tagId);
          if (next.length !== current.length) await quickNoteTagLinksRepository.setQuickNoteTagsInTransaction(d, item.id, next);
        } else {
          const current = await noteTagLinksRepository.listNoteTagIds(d, item.id);
          const next = [...current];
          for (const tagId of item.tagIds) if (!next.includes(tagId)) next.push(tagId);
          if (next.length !== current.length) await noteTagLinksRepository.setNoteTagsInTransaction(d, item.id, next);
        }
        continue;
      }
      if (item.action === "tag-remove") {
        const drop = new Set(item.tagIds);
        if (item.space === "quickNotes") {
          const current = await quickNoteTagLinksRepository.listQuickNoteTagIds(d, item.id);
          const next = current.filter((tagId) => !drop.has(tagId));
          if (next.length !== current.length) await quickNoteTagLinksRepository.setQuickNoteTagsInTransaction(d, item.id, next);
        } else {
          const current = await noteTagLinksRepository.listNoteTagIds(d, item.id);
          const next = current.filter((tagId) => !drop.has(tagId));
          if (next.length !== current.length) await noteTagLinksRepository.setNoteTagsInTransaction(d, item.id, next);
        }
      }
    }
  });
}

/** 组装同步 executor（对外导出便于单测直接跑 core 编排）。 */
export function createMobileBatchExecutor(snapshot: BatchSnapshot, onExecute: (items: readonly BatchNotesItem[]) => void): BatchNotesExecutor {
  return {
    describe(id: string, space: BatchNotesSpace): BatchNotesNodeInfo | null {
      if (space === "quickNotes") {
        const trashed = snapshot.quick.get(id);
        return trashed === undefined ? null : { kind: "quick-note", trashed };
      }
      const meta = snapshot.lake.get(id);
      return meta ? { kind: meta.kind, trashed: meta.trashed } : null;
    },
    supports: mobileBatchSupports,
    describeParent(parentId: string | null): BatchNotesParentStatus {
      if (parentId === null) return "ok";
      const meta = snapshot.lake.get(parentId);
      if (!meta) return "not-found";
      if (meta.trashed) return "in-trash";
      // 日记本 / 日记子树不是移动目标（261113 §3#25②；与桌面 noteMetadataRepository.assertDiaryMove 同一判据）。
      // 契约取值只有四个，这里按「不是容器」拒绝：日记的顺序由日期派生，放不进普通文档。
      if (snapshot.parentInDiary) return "not-a-container";
      return meta.kind === "notebook" || meta.kind === "folder" ? "ok" : "not-a-container";
    },
    wouldCreateCycle(id: string, parentId: string | null): boolean {
      if (parentId === null) return false;
      return parentId === id || snapshot.ancestors.has(id);
    },
    activeTagIds: () => snapshot.activeTagIds,
    execute: (items) => { onExecute(items); },
  };
}

/**
 * 移动端批量操作入口（bridge.batchNotes 的实现主体）。
 * 同步校验跑在预取快照上；全部通过后再把落地动作放进异步事务。事务失败 ⇒ 整批 failed（已回滚）。
 */
export async function runMobileBatchNotes(d: MobileDb, input: BatchNotesInput): Promise<BatchNotesResult> {
  const raw = input as BatchNotesInput & { ids?: unknown };
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((id): id is string => typeof id === "string") : [];
  const space: BatchNotesSpace = raw.space === "quickNotes" ? "quickNotes" : "lake";
  const parentRoot = input.action === "move" && typeof input.parentId === "string" && input.parentId.trim() ? input.parentId.trim() : null;

  const [lakeData, quick, activeTagIds] = await Promise.all([
    loadLakeMeta(d, ids, parentRoot),
    space === "quickNotes" ? loadQuickMeta(d, ids) : Promise.resolve(new Map<string, boolean>()),
    loadActiveTagIds(d),
  ]);

  let pending: Promise<void> | null = null;
  const executor = createMobileBatchExecutor(
    { lake: lakeData.lake, quick, ancestors: lakeData.ancestors, parentInDiary: lakeData.parentInDiary, activeTagIds },
    (items) => { pending = applyBatchItems(d, items); },
  );
  const result = runBatchNotes(input, executor);
  const work = pending as Promise<void> | null;
  if (!result.ok || !work) return result;
  try {
    await work;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      results: result.results.map((item) => ({ id: item.id, ok: false, reason: "failed" as const })),
      summary: { total: result.results.length, done: 0, failed: result.results.length },
      reason: "failed",
      message: "批量操作失败（已回滚）：" + message,
    };
  }
}

export const batchNotesDomain = {
  /** 批量操作（移动端唯一入口；写域：纯本地写、不出网）。 */
  async batchNotes(input: BatchNotesInput): Promise<BatchNotesResult> {
    return runWrite("batchNotes", async () => {
      const d = await ensureDb();
      return await runMobileBatchNotes(d, input);
    });
  },
};
