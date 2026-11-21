/**
 * 反向映射：手机快照行 → 桌面两库行（261122 大统一迁移包；docs/PORTABLE-TRANSFER.md §3）。
 *
 * 与正向映射（src/mobile/portable/portableMapping.ts）严格镜像：字段语义一一对应、
 * 收窄口径共用 core/portableRows；输入统一为 SELECT * 原始行（防御式读取）。
 * 规则要点：
 *  - folder → tree_nodes（notebook/group）；note → tree_nodes(note，新树 id) + notes 两行；
 *    手机 note 行的 id = 桌面 note_file_id（业务 id，正文路径/基线索引都认它），
 *    tree_nodes.id 仅是树节点 id ⇒ 反向生成新 uuid（与正向注释同口径）。
 *  - is_purged 行 → deleted_notes 墓碑（防远端复活），不留 notes/folders 行；
 *    手机 deleted_notes 表的墓碑 1:1 搬入。
 *  - 小记：deleted_at 在手机是行内软删，桌面没有该列 ⇒ 只写 quick_note_deleted 账本
 *    （删除 = 缺席 + 账本，与桌面删除语义一致）；活跃行写 quick_notes。
 *  - 标签域（tags/tag_links/tag_link_versions）1:1（关系去重同正向）。
 */
import { randomUUID } from "node:crypto";
import { normalizeFolderSpace } from "../../src/core/diary.js";
import { NOTE_KINDS, type NoteKind } from "../../src/core/noteKind.js";
import { asText, asTextOr, asInt, asBoolInt, type RawRow } from "../../src/core/portable/portableRows.js";

export interface DesktopNoteRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  updated_at: string;
  is_conflict: number;
  deleted_at: string | null;
  kind: string;
  is_locked: number;
  locked_at: string | null;
  restore_pending_at: string | null;
  trashed_at: string | null;
  deleted_from_parent_id: string | null;
  is_purged: number;
  is_dirty: number;
  cloud_deleted: number;
}

export interface DesktopTreeNodeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  node_type: string;
  title: string;
  note_file_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_conflict: number;
  icon: string | null;
  space: string | null;
  trashed_at: string | null;
  deleted_from_parent_id: string | null;
  is_purged: number;
  is_dirty: number;
  cloud_deleted: number;
}

export interface DesktopTombstoneRow {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  updated_at: string;
  deleted_at: string;
  node_type: string;
  purged_at: string | null;
}

export interface DesktopQuickNoteRow {
  id: string;
  created_at: string;
  updated_at: string;
  preview_text: string;
  image_count: number;
  content_hash: string;
  is_dirty: number;
  is_conflict: number;
  cloud_deleted: number;
}

export interface DesktopQuickNoteDeletedRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string;
  conversion_target_note_id: string | null;
  ready_to_sync: number;
  purged_at: string | null;
  cloud_deleted: number;
}

export interface DesktopTagRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DesktopTagLinkRow {
  target_kind: string;
  target_id: string;
  tag_id: string;
  position: number;
}

export interface DesktopTagLinkVersionRow {
  target_kind: string;
  target_id: string;
  links_updated_at: string;
}

export interface MappedDesktopFromMobile {
  treeNodes: DesktopTreeNodeRow[];
  notes: DesktopNoteRow[];
  tombstones: DesktopTombstoneRow[];
  quickNotes: DesktopQuickNoteRow[];
  quickNoteDeleted: DesktopQuickNoteDeletedRow[];
  tags: DesktopTagRow[];
  tagLinks: DesktopTagLinkRow[];
  tagLinkVersions: DesktopTagLinkVersionRow[];
  skipped: number;
}

export interface MapMobileToDesktopInput {
  folders: RawRow[];
  notes: RawRow[];
  deletedNotes: RawRow[];
  quickNotes: RawRow[];
  quickNoteDeleted: RawRow[];
  tags: RawRow[];
  tagLinks: RawRow[];
  tagLinkVersions: RawRow[];
}

export interface MapMobileToDesktopOptions {
  /** 桌面 tree_nodes.workspace_id（Store 固定 "default"）。 */
  workspaceId?: string;
  /** note 节点的新树 id 生成器（测试可注入确定值）。 */
  newTreeId?: () => string;
}

export function mapMobileToDesktop(input: MapMobileToDesktopInput, options: MapMobileToDesktopOptions = {}): MappedDesktopFromMobile {
  const workspaceId = options.workspaceId ?? "default";
  const newTreeId = options.newTreeId ?? (() => randomUUID());
  const treeNodes: DesktopTreeNodeRow[] = [];
  const notes: DesktopNoteRow[] = [];
  const tombstones: DesktopTombstoneRow[] = [];
  const quickNotes: DesktopQuickNoteRow[] = [];
  let skipped = 0;

  // ---- folder → tree_nodes（notebook/group）----
  for (const row of input.folders) {
    const id = asText(row.id);
    const nodeType = asTextOr(row.node_type, "");
    if (!id || (nodeType !== "notebook" && nodeType !== "group")) { skipped += 1; continue; }
    const updatedAt = asText(row.updated_at) ?? new Date(0).toISOString();
    const purged = asBoolInt(row.is_purged) === 1;
    const title = asText(row.title) ?? "未命名";
    const parentId = asText(row.parent_id);
    const sortOrder = asInt(row.sort_order, 0);
    if (purged) {
      tombstones.push({
        id,
        title,
        parent_id: parentId,
        sort_order: sortOrder,
        updated_at: updatedAt,
        deleted_at: asText(row.deleted_at) ?? asText(row.trashed_at) ?? updatedAt,
        node_type: "folder",
        purged_at: asText(row.deleted_at) ?? updatedAt,
      });
      continue;
    }
    treeNodes.push({
      id,
      workspace_id: workspaceId,
      parent_id: parentId,
      node_type: nodeType,
      title,
      note_file_id: null,
      sort_order: sortOrder,
      created_at: updatedAt,
      updated_at: updatedAt,
      deleted_at: null,
      is_conflict: 0,
      icon: asText(row.icon),
      space: nodeType === "notebook" ? normalizeFolderSpace(row.space) : null,
      trashed_at: asText(row.trashed_at),
      deleted_from_parent_id: asText(row.deleted_from_parent_id),
      is_purged: 0,
      is_dirty: 0,
      cloud_deleted: asBoolInt(row.cloud_deleted),
    });
  }

  // ---- note → tree_nodes(note，新树 id) + notes ----
  for (const row of input.notes) {
    const id = asText(row.id);
    if (!id) { skipped += 1; continue; }
    const updatedAt = asText(row.updated_at) ?? new Date(0).toISOString();
    const title = asText(row.title) ?? "未命名";
    const parentId = asText(row.parent_id);
    const sortOrder = asInt(row.sort_order, 0);
    const purged = asBoolInt(row.is_purged) === 1;
    if (purged) {
      tombstones.push({
        id,
        title,
        parent_id: parentId,
        sort_order: sortOrder,
        updated_at: updatedAt,
        deleted_at: asText(row.deleted_at) ?? asText(row.trashed_at) ?? updatedAt,
        node_type: "note",
        purged_at: asText(row.deleted_at) ?? updatedAt,
      });
      continue;
    }
    const kindRaw = asTextOr(row.doc_kind, "doc");
    const kind: NoteKind = (NOTE_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as NoteKind) : "doc";
    const treeId = newTreeId();
    treeNodes.push({
      id: treeId,
      workspace_id: workspaceId,
      parent_id: parentId,
      node_type: "note",
      title,
      note_file_id: id,
      sort_order: sortOrder,
      created_at: updatedAt,
      updated_at: updatedAt,
      deleted_at: null,
      is_conflict: asBoolInt(row.is_conflict),
      icon: asText(row.icon),
      space: null,
      trashed_at: asText(row.trashed_at),
      deleted_from_parent_id: asText(row.deleted_from_parent_id),
      is_purged: 0,
      is_dirty: 0,
      cloud_deleted: asBoolInt(row.cloud_deleted),
    });
    notes.push({
      id,
      title,
      parent_id: parentId,
      sort_order: sortOrder,
      updated_at: updatedAt,
      is_conflict: asBoolInt(row.is_conflict),
      deleted_at: asText(row.deleted_at),
      kind,
      is_locked: asBoolInt(row.is_locked),
      locked_at: asText(row.locked_at),
      restore_pending_at: asText(row.restore_pending_at),
      trashed_at: asText(row.trashed_at),
      deleted_from_parent_id: asText(row.deleted_from_parent_id),
      is_purged: 0,
      is_dirty: 0,
      cloud_deleted: asBoolInt(row.cloud_deleted),
    });
  }

  // ---- 手机 deleted_notes 墓碑 1:1 ----
  for (const row of input.deletedNotes) {
    const id = asText(row.id);
    const deletedAt = asText(row.deleted_at);
    if (!id || !deletedAt) { skipped += 1; continue; }
    tombstones.push({
      id,
      title: asText(row.title) ?? "未命名",
      parent_id: asText(row.parent_id),
      sort_order: asInt(row.sort_order, 0),
      updated_at: asText(row.updated_at) ?? deletedAt,
      deleted_at: deletedAt,
      node_type: asText(row.node_type) === "folder" ? "folder" : "note",
      purged_at: asText(row.purged_at),
    });
  }

  // ---- 小记：deleted_at 只进账本（桌面删除 = 缺席 + quick_note_deleted）；活跃行进 quick_notes ----
  const ledgerById = new Map<string, DesktopQuickNoteDeletedRow>();
  for (const row of input.quickNoteDeleted) {
    const id = asText(row.id);
    const deletedAt = asText(row.deleted_at);
    if (!id || !deletedAt) { skipped += 1; continue; }
    ledgerById.set(id, {
      id,
      created_at: asText(row.created_at) ?? deletedAt,
      updated_at: asText(row.updated_at) ?? deletedAt,
      deleted_at: deletedAt,
      conversion_target_note_id: asText(row.conversion_target_note_id),
      ready_to_sync: 1,
      purged_at: asText(row.purged_at),
      cloud_deleted: asBoolInt(row.cloud_deleted),
    });
  }
  for (const row of input.quickNotes) {
    const id = asText(row.id);
    if (!id) { skipped += 1; continue; }
    const createdAt = asText(row.created_at) ?? new Date(0).toISOString();
    const deletedAt = asText(row.deleted_at);
    if (deletedAt) {
      if (!ledgerById.has(id)) {
        ledgerById.set(id, {
          id,
          created_at: createdAt,
          updated_at: asText(row.updated_at) ?? deletedAt,
          deleted_at: deletedAt,
          conversion_target_note_id: null,
          ready_to_sync: 1,
          purged_at: null,
          cloud_deleted: 0,
        });
      }
      continue;
    }
    quickNotes.push({
      id,
      created_at: createdAt,
      updated_at: asText(row.updated_at) ?? createdAt,
      preview_text: asTextOr(row.preview_text, ""),
      image_count: asInt(row.image_count, 0),
      content_hash: asTextOr(row.content_hash, ""),
      is_dirty: 0,
      is_conflict: asBoolInt(row.is_conflict),
      cloud_deleted: asBoolInt(row.cloud_deleted),
    });
  }

  // ---- 标签域 ----
  const tags: DesktopTagRow[] = [];
  for (const row of input.tags) {
    const id = asText(row.id);
    const name = asText(row.name);
    if (!id || !name) { skipped += 1; continue; }
    tags.push({
      id,
      name,
      sort_order: asInt(row.sort_order, 0),
      created_at: asText(row.created_at) ?? new Date(0).toISOString(),
      updated_at: asText(row.updated_at) ?? asText(row.created_at) ?? new Date(0).toISOString(),
    });
  }
  const tagLinks: DesktopTagLinkRow[] = [];
  const seenLinks = new Set<string>();
  for (const row of input.tagLinks) {
    const kind = asText(row.target_kind);
    const targetId = asText(row.target_id);
    const tagId = asText(row.tag_id);
    if (!targetId || !tagId || (kind !== "note" && kind !== "quickNote")) { skipped += 1; continue; }
    const key = kind + "|" + targetId + "|" + tagId;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    tagLinks.push({ target_kind: kind, target_id: targetId, tag_id: tagId, position: asInt(row.position, 0) });
  }
  const tagLinkVersions: DesktopTagLinkVersionRow[] = [];
  const seenVersions = new Set<string>();
  for (const row of input.tagLinkVersions) {
    const kind = asText(row.target_kind);
    const targetId = asText(row.target_id);
    const version = asText(row.links_updated_at);
    if (!targetId || !version || (kind !== "note" && kind !== "quickNote")) { skipped += 1; continue; }
    const key = kind + "|" + targetId;
    if (seenVersions.has(key)) continue;
    seenVersions.add(key);
    tagLinkVersions.push({ target_kind: kind, target_id: targetId, links_updated_at: version });
  }

  return {
    treeNodes,
    notes,
    tombstones,
    quickNotes,
    quickNoteDeleted: [...ledgerById.values()],
    tags,
    tagLinks,
    tagLinkVersions,
    skipped,
  };
}
