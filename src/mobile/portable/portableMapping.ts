/**
 * 便携包导入的**纯映射**（桌面 SQLite 行 → 手机行），不碰 IO，可单测（见 portableMapping.test.ts）。
 *
 * 口径 docs/PORTABLE-TRANSFER.md §3：
 *  · tree_nodes(notebook/group) → folders；tree_nodes(note)+notes → notes（含回收站语义、kind→doc_kind）；
 *  · 彻底删除（is_purged=1）→ deleted_notes 墓碑（不留 notes/folders 行，防远端复活）；
 *  · quick-notes 库 → quick_notes / quick_note_deleted / tags / tag_links / tag_link_versions；
 *  · 全部导入行 is_dirty=0；content_hash 取包内基线索引（与桌面发布值一致，避免首轮把全部内容重传）。
 * 桌面行由原生插件以 JSON 返回（integer→number、NULL→null）；本文件只做类型收窄与默认值。
 */
import {
  validateLakeIndex,
  validateQuickNotesIndex,
  type LakeIndex,
  type QuickNotesIndex,
} from "../../core/s3v3/protocol/s3v3Index";
import type { MobileV3Baseline } from "../data/v3StateRepository";
import { normalizeFolderSpace } from "../../core/diary";

export type DesktopRow = Record<string, unknown>;

const asText = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asTextOr = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const asInt = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

const asBoolInt = (value: unknown): number => (value === true || value === 1 || value === "1" ? 1 : 0);

/** 手机 notes 行（schema.ts 的 NOT NULL 列全部给值）。 */
export interface MobileNoteRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  updated_at: string;
  content_hash: string | null;
  is_dirty: number;
  is_purged: number;
  is_conflict: number;
  deleted_at: string | null;
  doc_kind: string;
  cloud_deleted: number;
  trashed_at: string | null;
  deleted_from_parent_id: string | null;
  restore_pending_at: string | null;
  is_locked: number;
  locked_at: string | null;
  icon: string | null;
  text_cache: string | null;
}

export interface MobileFolderRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  node_type: string;
  /** 261109 日记：桌面 tree_nodes.space（便携包 SELECT * 已带出）必须搬到移动端，否则日记本降级成普通本。 */
  space: string | null;
  icon: string | null;
  updated_at: string;
  trashed_at: string | null;
  deleted_from_parent_id: string | null;
  is_dirty: number;
  is_purged: number;
  cloud_deleted: number;
}

export interface DeletedTombstone {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  updated_at: string;
  deleted_at: string;
  node_type: "note" | "folder";
  purged_at: string;
}

export interface MobileQuickNoteRow {
  id: string;
  created_at: string;
  updated_at: string;
  preview_text: string;
  image_count: number;
  content_hash: string;
  is_dirty: number;
  is_conflict: number;
  restore_pending_at: string | null;
  deleted_at: string | null;
  tags_updated_at: string;
  first_image: string | null;
  list_metadata_version: number;
  cloud_deleted: number;
  ready_to_sync: number;
}

export interface MobileTagRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MobileTagLinkRow {
  target_kind: "note" | "quickNote";
  target_id: string;
  tag_id: string;
  position: number;
}

export interface MobileTagLinkVersionRow {
  target_kind: "note" | "quickNote";
  target_id: string;
  links_updated_at: string;
}

export interface MobileQuickNoteDeletedRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string;
  purged_at: string | null;
}

export interface ParsedPortableBaseline {
  /** 云端基线；null = 纯离线包（只用内容哈希映射，不写同步账本）。 */
  baseline: MobileV3Baseline | null;
  lakeHashById: Map<string, string>;
  quickHashById: Map<string, string>;
}

/** 解析包内 sync-v3/baseline.json（DeviceBaseline 形状）；索引校验走 core 单一来源。 */
export function parsePortableBaseline(raw: unknown): ParsedPortableBaseline {
  if (!raw || typeof raw !== "object") throw new Error("同步基线不是对象");
  const value = raw as Record<string, unknown>;
  const epoch = asText(value.epoch);
  const lakeCommit = asText(value.lakeCommit);
  const quickNotesCommit = asText(value.quickNotesCommit);
  const generation = asInt(value.generation, -1);
  if (!epoch || !lakeCommit || !quickNotesCommit || generation < 0) throw new Error("同步基线缺字段");
  let lake: LakeIndex;
  let quickNotes: QuickNotesIndex;
  try {
    lake = validateLakeIndex(value.lake);
    quickNotes = validateQuickNotesIndex(value.quickNotes);
  } catch (error) {
    throw new Error("同步基线索引不合法: " + (error instanceof Error ? error.message : String(error)));
  }
  return {
    baseline: { epoch, generation, lakeCommit, quickNotesCommit, lake, quickNotes },
    lakeHashById: new Map(lake.notes.map((note) => [note.id, note.contentHash])),
    quickHashById: new Map(quickNotes.items.map((item) => [item.id, item.contentHash])),
  };
}

/** 纯离线包：只解析本地内容哈希表（export 端在 baseline.json 写入 localOnly 标记）。 */
export function parsePortableContentHashes(raw: unknown): ParsedPortableBaseline {
  if (!raw || typeof raw !== "object") throw new Error("离线内容哈希不是对象");
  const value = raw as Record<string, unknown>;
  if (value.localOnly !== true) throw new Error("离线便携包缺少内容哈希标记");
  const readMap = (input: unknown, label: string): Map<string, string> => {
    if (!input || typeof input !== "object") throw new Error("离线内容哈希缺少 " + label);
    const map = new Map<string, string>();
    for (const [id, hash] of Object.entries(input as Record<string, unknown>)) {
      if (typeof hash === "string" && hash.length > 0) map.set(id, hash);
    }
    return map;
  };
  return {
    baseline: null,
    lakeHashById: readMap(value.notes, "notes"),
    quickHashById: readMap(value.quickNotes, "quickNotes"),
  };
}

/**
 * 单棵 tree_nodes 行 + 对应 notes 行 → 手机 folders/notes/墓碑。
 * note 节点的业务 id = note_file_id（正文路径与基线索引都以它为准），tree_nodes.id 仅是树节点 id。
 */
export function mapTreeRow(
  node: DesktopRow,
  note: DesktopRow | undefined,
  baseline: ParsedPortableBaseline,
): { folder?: MobileFolderRow; note?: MobileNoteRow; tombstone?: DeletedTombstone; skipped: boolean } {
  const nodeType = asTextOr(node.node_type, "note");
  const purged = asBoolInt(note?.is_purged) === 1 || asBoolInt(node.is_purged) === 1;
  const updatedAt = asText(node.updated_at) ?? asText(note?.updated_at) ?? new Date(0).toISOString();
  const trashedAt = asText(node.trashed_at) ?? asText(note?.trashed_at);
  const deletedAt = asText(note?.deleted_at) ?? asText(node.deleted_at);
  const deletedFromParentId = asText(node.deleted_from_parent_id) ?? asText(note?.deleted_from_parent_id);
  const title = asText(node.title) ?? asText(note?.title) ?? "未命名";
  const parentId = asText(node.parent_id);
  const sortOrder = asInt(node.sort_order, 0);

  if (nodeType === "notebook" || nodeType === "group") {
    const id = asText(node.id);
    if (!id) return { skipped: true };
    if (purged) {
      return {
        tombstone: {
          id,
          title,
          parent_id: parentId,
          sort_order: sortOrder,
          updated_at: updatedAt,
          deleted_at: deletedAt ?? trashedAt ?? updatedAt,
          node_type: "folder",
          purged_at: deletedAt ?? updatedAt,
        },
        skipped: false,
      };
    }
    return {
      folder: {
        id,
        title,
        parent_id: parentId,
        sort_order: sortOrder,
        node_type: nodeType,
        // 归一：未知值/缺字段一律当非日记；space 只对 notebook 有意义（与 wire 校验同口径）。
        space: nodeType === "notebook" ? normalizeFolderSpace(node.space) : null,
        icon: asText(node.icon),
        updated_at: updatedAt,
        trashed_at: trashedAt,
        deleted_from_parent_id: deletedFromParentId,
        is_dirty: 0,
        is_purged: 0,
        cloud_deleted: 0,
      },
      skipped: false,
    };
  }

  const id = asText(node.note_file_id) ?? asText(note?.id) ?? asText(node.id);
  if (!id) return { skipped: true };
  if (purged) {
    return {
      tombstone: {
        id,
        title,
        parent_id: parentId,
        sort_order: sortOrder,
        updated_at: updatedAt,
        deleted_at: deletedAt ?? trashedAt ?? updatedAt,
        node_type: "note",
        purged_at: deletedAt ?? updatedAt,
      },
      skipped: false,
    };
  }
  return {
    note: {
      id,
      title,
      parent_id: parentId,
      sort_order: sortOrder,
      updated_at: updatedAt,
      content_hash: baseline.lakeHashById.get(id) ?? asText(note?.content_hash),
      is_dirty: 0,
      is_purged: 0,
      is_conflict: asBoolInt(note?.is_conflict) || asBoolInt(node.is_conflict),
      deleted_at: deletedAt,
      doc_kind: asTextOr(note?.kind, "doc"),
      cloud_deleted: 0,
      trashed_at: trashedAt,
      deleted_from_parent_id: deletedFromParentId,
      restore_pending_at: null,
      is_locked: asBoolInt(note?.is_locked),
      locked_at: asText(note?.locked_at),
      icon: asText(node.icon),
      text_cache: null,
    },
    skipped: false,
  };
}

/** 只有 notes 行、没有 tree_nodes 行的孤儿（旧库/已删除）也搬过来，降级为回收站可见。 */
export function mapOrphanNoteRow(row: DesktopRow, baseline: ParsedPortableBaseline): MobileNoteRow | null {
  const id = asText(row.id);
  if (!id) return null;
  const updatedAt = asText(row.updated_at) ?? new Date(0).toISOString();
  const purged = asBoolInt(row.is_purged) === 1;
  if (purged) return null;
  return {
    id,
    title: asText(row.title) ?? "未命名",
    parent_id: asText(row.parent_id),
    sort_order: asInt(row.sort_order, 0),
    updated_at: updatedAt,
    content_hash: baseline.lakeHashById.get(id) ?? asText(row.content_hash),
    is_dirty: 0,
    is_purged: 0,
    is_conflict: asBoolInt(row.is_conflict),
    deleted_at: asText(row.deleted_at),
    doc_kind: asTextOr(row.kind, "doc"),
    cloud_deleted: 0,
    trashed_at: asText(row.trashed_at) ?? asText(row.deleted_at),
    deleted_from_parent_id: asText(row.deleted_from_parent_id),
    restore_pending_at: null,
    is_locked: asBoolInt(row.is_locked),
    locked_at: asText(row.locked_at),
    icon: asText(row.icon),
    text_cache: null,
  };
}

export function mapQuickNoteRow(row: DesktopRow, baseline: ParsedPortableBaseline): MobileQuickNoteRow | null {
  const id = asText(row.id);
  if (!id) return null;
  const createdAt = asText(row.created_at) ?? new Date(0).toISOString();
  return {
    id,
    created_at: createdAt,
    updated_at: asText(row.updated_at) ?? createdAt,
    preview_text: asTextOr(row.preview_text, ""),
    image_count: asInt(row.image_count, 0),
    content_hash: baseline.quickHashById.get(id) ?? asText(row.content_hash) ?? "",
    is_dirty: 0,
    is_conflict: asBoolInt(row.is_conflict),
    restore_pending_at: null,
    deleted_at: asText(row.deleted_at),
    tags_updated_at: "",
    first_image: asText(row.first_image),
    list_metadata_version: 0,
    cloud_deleted: 0,
    ready_to_sync: 1,
  };
}

export function mapQuickNoteDeletedRow(row: DesktopRow): MobileQuickNoteDeletedRow | null {
  const id = asText(row.id);
  const deletedAt = asText(row.deleted_at);
  if (!id || !deletedAt) return null;
  return {
    id,
    created_at: asText(row.created_at) ?? deletedAt,
    updated_at: asText(row.updated_at) ?? deletedAt,
    deleted_at: deletedAt,
    purged_at: asText(row.purged_at),
  };
}

/** 标签目录：只导入 active 行（桌面 deleted_at 墓碑在 261105 已物理删除，这里仍兜底过滤）。 */
export function mapTagRow(row: DesktopRow): MobileTagRow | null {
  const id = asText(row.id);
  const name = asText(row.name);
  if (!id || !name) return null;
  if (asText(row.deleted_at)) return null;
  return {
    id,
    name,
    sort_order: asInt(row.sort_order, 0),
    created_at: asText(row.created_at) ?? new Date(0).toISOString(),
    updated_at: asText(row.updated_at) ?? asText(row.created_at) ?? new Date(0).toISOString(),
  };
}

export function mapTagLinkRow(row: DesktopRow): MobileTagLinkRow | null {
  const kind = asText(row.target_kind);
  const targetId = asText(row.target_id);
  const tagId = asText(row.tag_id);
  if (!targetId || !tagId) return null;
  // 桌面 261107 后两种 kind 都在 quick-notes 库：note（文档）与 quickNote（小记）。
  if (kind !== "note" && kind !== "quickNote") return null;
  return { target_kind: kind, target_id: targetId, tag_id: tagId, position: asInt(row.position, 0) };
}

export function mapTagLinkVersionRow(row: DesktopRow): MobileTagLinkVersionRow | null {
  const kind = asText(row.target_kind);
  const targetId = asText(row.target_id);
  const version = asText(row.links_updated_at);
  if (!targetId || !version) return null;
  if (kind !== "note" && kind !== "quickNote") return null;
  return { target_kind: kind, target_id: targetId, links_updated_at: version };
}

export interface MappedDesktopData {
  folders: MobileFolderRow[];
  notes: MobileNoteRow[];
  tombstones: DeletedTombstone[];
  skipped: number;
}

/** tree_nodes 全量 + notes 全量 → folders/notes/墓碑（notes 里没有树节点的孤儿也收）。 */
export function mapDesktopTree(treeRows: DesktopRow[], noteRows: DesktopRow[], baseline: ParsedPortableBaseline): MappedDesktopData {
  const noteById = new Map<string, DesktopRow>();
  for (const row of noteRows) {
    const id = asText(row.id);
    if (id) noteById.set(id, row);
  }
  const folders: MobileFolderRow[] = [];
  const notes: MobileNoteRow[] = [];
  const tombstones: DeletedTombstone[] = [];
  let skipped = 0;
  const consumedNoteIds = new Set<string>();

  for (const node of treeRows) {
    const noteId = asText(node.note_file_id) ?? asText(node.id);
    const noteRow = noteId ? noteById.get(noteId) : undefined;
    if (noteId && noteRow) consumedNoteIds.add(noteId);
    const mapped = mapTreeRow(node, noteRow, baseline);
    if (mapped.skipped) skipped += 1;
    if (mapped.folder) folders.push(mapped.folder);
    if (mapped.note) notes.push(mapped.note);
    if (mapped.tombstone) tombstones.push(mapped.tombstone);
  }
  for (const row of noteRows) {
    const id = asText(row.id);
    if (!id || consumedNoteIds.has(id)) continue;
    const orphan = mapOrphanNoteRow(row, baseline);
    if (!orphan) {
      // 已彻底删除但没有树节点：仍写墓碑，防远端复活。
      const purged = asBoolInt(row.is_purged) === 1;
      if (purged) {
        const updatedAt = asText(row.updated_at) ?? new Date(0).toISOString();
        tombstones.push({
          id,
          title: asText(row.title) ?? "未命名",
          parent_id: asText(row.parent_id),
          sort_order: asInt(row.sort_order, 0),
          updated_at: updatedAt,
          deleted_at: asText(row.deleted_at) ?? updatedAt,
          node_type: "note",
          purged_at: asText(row.deleted_at) ?? updatedAt,
        });
      } else {
        skipped += 1;
      }
      continue;
    }
    notes.push(orphan);
  }
  return { folders, notes, tombstones, skipped };
}

export interface MappedQuickData {
  quickNotes: MobileQuickNoteRow[];
  quickNoteDeleted: MobileQuickNoteDeletedRow[];
  tags: MobileTagRow[];
  tagLinks: MobileTagLinkRow[];
  tagLinkVersions: MobileTagLinkVersionRow[];
  skipped: number;
}

export function mapDesktopQuickData(input: {
  quickNotes: DesktopRow[];
  quickNoteDeleted: DesktopRow[];
  tags: DesktopRow[];
  tagLinks: DesktopRow[];
  tagLinkVersions: DesktopRow[];
  baseline: ParsedPortableBaseline;
}): MappedQuickData {
  let skipped = 0;
  const quickNotes: MobileQuickNoteRow[] = [];
  for (const row of input.quickNotes) {
    const mapped = mapQuickNoteRow(row, input.baseline);
    if (mapped) quickNotes.push(mapped);
    else skipped += 1;
  }
  const quickNoteDeleted: MobileQuickNoteDeletedRow[] = [];
  for (const row of input.quickNoteDeleted) {
    const mapped = mapQuickNoteDeletedRow(row);
    if (mapped) quickNoteDeleted.push(mapped);
    else skipped += 1;
  }
  const tags: MobileTagRow[] = [];
  for (const row of input.tags) {
    const mapped = mapTagRow(row);
    if (mapped) tags.push(mapped);
    else skipped += 1;
  }
  // 关系按 (kind, target, tag) 去重（主库可能残留旧文档关系行，与 quick-notes 库重复）。
  const seenLinks = new Set<string>();
  const tagLinks: MobileTagLinkRow[] = [];
  for (const row of input.tagLinks) {
    const mapped = mapTagLinkRow(row);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    const key = mapped.target_kind + "|" + mapped.target_id + "|" + mapped.tag_id;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    tagLinks.push(mapped);
  }
  const seenVersions = new Set<string>();
  const tagLinkVersions: MobileTagLinkVersionRow[] = [];
  for (const row of input.tagLinkVersions) {
    const mapped = mapTagLinkVersionRow(row);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    const key = mapped.target_kind + "|" + mapped.target_id;
    if (seenVersions.has(key)) continue;
    seenVersions.add(key);
    tagLinkVersions.push(mapped);
  }
  return { quickNotes, quickNoteDeleted, tags, tagLinks, tagLinkVersions, skipped };
}
