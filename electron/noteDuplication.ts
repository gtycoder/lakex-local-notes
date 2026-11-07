/**
 * 文档「创建副本」的存储无关编排（261108 桌面代码债）。
 *
 * Store 只提供 IO/DB 端口；本模块负责：
 * - prepare：源行校验（不存在/回收站/非文档/缺正文）→ 读正文 → 改写三件套 → 资源/标签快照；
 * - commit：重读源父级/sort_order（异步复制窗口后）→ 走新建管线 → 补缓存/标签。
 *
 * 这样 Store 不再内嵌副本业务规则，IPC 里只保留批量并发/进度/清洁。
 */
import crypto from "node:crypto";
import { isSafePathSegment } from "../src/core/storeUtils.js";
import { TRASH_NOTEBOOK_ID } from "../src/core/syncDecisions.js";
import { normalizeNoteKind, type NoteKind } from "../src/core/noteKind.js";
import { DuplicateNoteFailure, duplicateNoteTitle, type DuplicateNotesReason } from "../src/core/duplicateNotes.js";
import { prepareDuplicateBody } from "../src/core/lakeBodyRewrite.js";

export interface DuplicateAsset {
  filename: string;
  sourcePath: string;
}

/** prepare 阶段需要读取的源笔记行（Store 负责 SQL）。 */
export interface DuplicateSourceRow {
  title: string;
  parent_id: string | null;
  sort_order: number;
  kind: string | null;
  trashed_at: string | null;
  node_type: string | null;
  node_deleted_at: string | null;
}

export interface DuplicateFreshRow {
  parent_id: string | null;
  sort_order: number;
  trashed_at: string | null;
}

export interface DuplicatePreparePort {
  findSource(sourceId: string): DuplicateSourceRow | undefined;
  bodyPathFor(sourceId: string, kind: NoteKind): string;
  exists(absolutePath: string): boolean;
  readText(absolutePath: string): string;
  collectAssets(sourceId: string): DuplicateAsset[];
  getTagIds(sourceId: string): string[];
}

export interface DuplicateCommitPort<T> {
  findFresh(sourceId: string): DuplicateFreshRow | undefined;
  /** 调用方必须用 prepared.newId/afterSortOrder 走同一条新建管线，且 skipAssetCopy（资源已由批量层并发复制）。 */
  create(prepared: PreparedDuplicate, parentId: string | null, afterSortOrder: number): T;
  /** 新建完成后的派生缓存/标签关系；失败可忽略，由全量重建修复。 */
  afterCreate(created: T, prepared: PreparedDuplicate): void;
}

export interface PreparedDuplicate {
  sourceId: string;
  newId: string;
  title: string;
  kind: NoteKind;
  content: string;
  assets: DuplicateAsset[];
  tagIds: string[];
}

export function duplicateFailure(reason: DuplicateNotesReason, message: string): DuplicateNoteFailure {
  return new DuplicateNoteFailure(reason, message);
}

/** 阶段 1：只读准备（可并发）；失败抛 DuplicateNoteFailure（契约 reason）。 */
export function prepareDuplicateRecord(
  port: DuplicatePreparePort,
  sourceId: string,
  options: { title?: string; now?: Date } = {},
): PreparedDuplicate {
  if (!isSafePathSegment(sourceId)) throw duplicateFailure("invalid-id", "无效的笔记 ID: " + sourceId);
  const row = port.findSource(sourceId);
  if (!row) throw duplicateFailure("not-found", "笔记不存在: " + sourceId);
  if (row.parent_id === TRASH_NOTEBOOK_ID || row.trashed_at) throw duplicateFailure("already-trashed", "笔记在回收站: " + sourceId);
  if (row.node_type !== "note") throw duplicateFailure("unsupported", "只能复制文档: " + sourceId);
  const kind = normalizeNoteKind(row.kind);
  const sourceBodyPath = port.bodyPathFor(sourceId, kind);
  if (!port.exists(sourceBodyPath)) throw duplicateFailure("body-missing", "正文文件缺失: " + sourceId);
  const newId = crypto.randomUUID();
  const sourceContent = port.readText(sourceBodyPath);
  const title = options.title ?? duplicateNoteTitle(row.title, options.now ?? new Date());
  const content = prepareDuplicateBody(sourceContent, { sourceId, newId, kind });
  let tagIds: string[] = [];
  try { tagIds = port.getTagIds(sourceId); } catch { /* 标签是增量能力 */ }
  return {
    sourceId,
    newId,
    title,
    kind,
    content,
    assets: port.collectAssets(sourceId),
    tagIds,
  };
}

/** 阶段 3：同步落库（标准串行）；调用方保证资源已就位。 */
export function commitPreparedDuplicateRecord<T>(port: DuplicateCommitPort<T>, prepared: PreparedDuplicate): T {
  // 异步复制窗口后重读源位置：同批前面的副本可能已插队，或用户移动了源。
  const fresh = port.findFresh(prepared.sourceId);
  if (!fresh) throw duplicateFailure("not-found", "笔记不存在: " + prepared.sourceId);
  if (fresh.parent_id === TRASH_NOTEBOOK_ID || fresh.trashed_at) throw duplicateFailure("already-trashed", "笔记在回收站: " + prepared.sourceId);
  const created = port.create(prepared, fresh.parent_id ?? null, fresh.sort_order);
  try { port.afterCreate(created, prepared); } catch { /* 索引/标签可全量重建 */ }
  return created;
}
