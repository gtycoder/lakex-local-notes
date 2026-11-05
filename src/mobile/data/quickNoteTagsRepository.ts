/**
 * 移动端标签目录子系统：只拥有 `tags`（通用标签目录），不认识小记、不读正文。
 * 关系在 `quickNoteTagLinksRepository`；两者只在 `quickNoteTagService` 里组合。
 *
 * 261105 用户定稿：
 * - 目录顺序是**设备本地视图**（不参与同步；置顶功能已删除）；
 * - **删除 = 缺席**：删除标签 = 物理删行 + 清关联/版本，云端 `tags[]` 只出现 active 标签。
 *   跨端传播靠「基线有 / 远端缺席」判定（删除压编辑），离线期间的抑制靠 device_state 的 `tag_deleted`；
 * - 未手动排序：默认「新的在前（created_at DESC）→ 名称」；手动拖拽后按本机 sort_order，新增追加末尾。
 */
import { normalizeQuickNoteTag, quickNoteTagId, type QuickNoteTag } from "../../core/quickNoteTags.js";
import type { MobileDb } from "./sqliteDb.js";
import { listQuickNoteIdsForTags, removeQuickNoteTagLinksInTransaction } from "./quickNoteTagLinksRepository.js";
import { removeNoteTagLinksInTransaction } from "./noteTagLinksRepository.js";

type QuickNoteTagRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const MANUAL_ORDER_KEY = "quick_tags_manual_order";
/** 本机待删标签 id（JSON 数组）：离线删过、还没被远端确认缺席；**不上传**、随 App 数据本机持久。 */
export const PENDING_TAG_DELETES_KEY = "tag_deleted";
/** 一次性迁移标记：旧库的 `deleted_at` 墓碑已转成「缺席」。 */
export const TAG_ABSENCE_MIGRATED_KEY = "tag_absent_migrated";

function mapRow(row: QuickNoteTagRow): QuickNoteTag {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "zh-CN");
}

async function readDeviceValue(d: MobileDb, key: string): Promise<string | null> {
  const row = await d.prepare("SELECT value FROM device_state WHERE key=?").get(key) as { value?: string } | undefined;
  return row?.value === undefined ? null : String(row.value);
}

async function writeDeviceValue(d: MobileDb, key: string, value: string): Promise<void> {
  await d.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

/** 是否已在本机手动排序过（设备本地标记，不参与同步）。 */
export async function isQuickNoteTagManualOrder(d: MobileDb): Promise<boolean> {
  return (await readDeviceValue(d, MANUAL_ORDER_KEY)) === "1";
}

async function markManualOrder(d: MobileDb): Promise<void> {
  await writeDeviceValue(d, MANUAL_ORDER_KEY, "1");
}

/** 本机待删标签 id（离线删过、还没被远端确认缺席）；坏数据一律当空集合。 */
export async function listPendingTagDeletes(d: MobileDb): Promise<string[]> {
  const raw = await readDeviceValue(d, PENDING_TAG_DELETES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
  } catch {
    return [];
  }
}

/** 覆盖写本机待删集合（空集合 = 删掉这一行，避免 device_state 留空壳）。 */
export async function writePendingTagDeletes(d: MobileDb, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))].sort();
  if (unique.length === 0) {
    await d.prepare("DELETE FROM device_state WHERE key=?").run(PENDING_TAG_DELETES_KEY);
    return;
  }
  await writeDeviceValue(d, PENDING_TAG_DELETES_KEY, JSON.stringify(unique));
}

/** 追加本机待删（本地删除时调用；已有的不重复）。 */
export async function addPendingTagDeletes(d: MobileDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await writePendingTagDeletes(d, [...(await listPendingTagDeletes(d)), ...ids]);
}

/** 结算：远端已确认缺席的 id 从待删集合移除，其余保留（空集合删掉 device_state 行）。 */
export async function settlePendingTagDeletes(d: MobileDb, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const settled = new Set(ids);
  await writePendingTagDeletes(d, (await listPendingTagDeletes(d)).filter((id) => !settled.has(id)));
}

/**
 * 目录列表（本地展示顺序）：手动排序过按 sort_order，否则新→旧 → 名称。
 * 删除 = 缺席 ⇒ 行本来就不该在；仍保留 `deleted_at IS NULL` 过滤，兼容未跑迁移的旧库。
 */
export async function listQuickNoteTags(d: MobileDb): Promise<QuickNoteTag[]> {
  const rows = await d.prepare("SELECT * FROM tags WHERE deleted_at IS NULL").all() as QuickNoteTagRow[];
  const manual = await isQuickNoteTagManualOrder(d);
  rows.sort(manual
    ? (a, b) => (Number(a.sort_order) - Number(b.sort_order)) || byName(a, b)
    : (a, b) => String(b.created_at).localeCompare(String(a.created_at)) || byName(a, b));
  return rows.map(mapRow);
}

export async function quickNoteTagNames(d: MobileDb): Promise<Map<string, string>> {
  return new Map((await listQuickNoteTags(d)).map((tag) => [tag.id, tag.name] as const));
}

async function active(d: MobileDb, id: string): Promise<QuickNoteTagRow | null> {
  const row = await d.prepare("SELECT * FROM tags WHERE id=? AND deleted_at IS NULL").get(id) as QuickNoteTagRow | undefined;
  return row ?? null;
}

/**
 * 幂等创建：同名 active 直接返回；同 id 的旧墓碑行**就地复活**（upsert，不会撞主键）。
 * 新标签默认追加到末尾（手动排序生效时）。
 */
export async function ensureQuickNoteTag(d: MobileDb, rawName: string, at = new Date().toISOString()): Promise<QuickNoteTag> {
  const name = normalizeQuickNoteTag(rawName);
  const existing = await d.prepare("SELECT * FROM tags WHERE name=? AND deleted_at IS NULL ORDER BY created_at LIMIT 1").get(name) as QuickNoteTagRow | undefined;
  if (existing) return mapRow(existing);
  const id = quickNoteTagId(name);
  // 旧库可能还留着同 id 的墓碑行（迁移未跑/迁移失败）：按 id upsert 复活，绝不写墓碑、绝不撞主键。
  const previous = await d.prepare("SELECT * FROM tags WHERE id=?").get(id) as QuickNoteTagRow | undefined;
  const maxRow = await d.prepare("SELECT IFNULL(MAX(sort_order), -1) AS m FROM tags WHERE deleted_at IS NULL").get() as { m: number };
  const tag: QuickNoteTag = {
    id,
    name,
    createdAt: previous ? String(previous.created_at) : at,
    updatedAt: at,
  };
  await d.prepare(
    "INSERT INTO tags(id,name,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,NULL) "
    + "ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, created_at=excluded.created_at, updated_at=excluded.updated_at, deleted_at=NULL"
  ).run(tag.id, tag.name, Number(maxRow.m) + 1, tag.createdAt, tag.updatedAt);
  return tag;
}

export async function createQuickNoteTag(d: MobileDb, name: string): Promise<QuickNoteTag> {
  return ensureQuickNoteTag(d, name);
}

/** 只改名称（顺序/置顶不在模型内；改名会刷新搜索索引里的标签词）。 */
export async function updateQuickNoteTag(d: MobileDb, id: string, patch: { name?: string }): Promise<QuickNoteTag> {
  const row = await active(d, id);
  if (!row) throw new Error("标签不存在或已删除");
  let name = String(row.name);
  if (patch.name !== undefined) {
    name = normalizeQuickNoteTag(patch.name);
    if (name !== row.name) {
      const clash = await d.prepare("SELECT id FROM tags WHERE name=? AND deleted_at IS NULL AND id<>?").get(name, id) as { id: string } | undefined;
      if (clash) throw new Error(`已存在同名标签“${name}”，请改用合并`);
    }
  }
  const next: QuickNoteTag = {
    id,
    name,
    createdAt: String(row.created_at),
    updatedAt: new Date().toISOString(),
  };
  await d.prepare("UPDATE tags SET name=?, updated_at=? WHERE id=?").run(next.name, next.updatedAt, id);
  return next;
}

/** 手动拖拽排序：写本机 sort_order + 标记「已手动排序」；**不 bump updatedAt**（不触发同步）。 */
export async function reorderQuickNoteTags(d: MobileDb, orderedIds: readonly string[]): Promise<QuickNoteTag[]> {
  await d.transaction(async () => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await d.prepare("UPDATE tags SET sort_order=? WHERE id=? AND deleted_at IS NULL").run(index, orderedIds[index]);
    }
    await markManualOrder(d);
  });
  return listQuickNoteTags(d);
}

/**
 * 删除 = 缺席：只物理删目录行（**不写墓碑**）。
 * 关联/版本的清理由协调层在同一事务内用 `*InTransaction` 版本完成（本函数不开事务）。
 */
export async function deleteQuickNoteTag(d: MobileDb, id: string): Promise<void> {
  await d.prepare("DELETE FROM tags WHERE id=?").run(id);
}

/**
 * 目录落库（单事务）：同步端口 Apply/Commit 用。
 * - upsert 给定 active 行（name/createdAt/updatedAt；**不碰本机 sort_order**，新行追加末尾）；
 * - `removedIds` = 本轮判定删除的标签：物理删行 + 清 `tag_links`/`tag_link_versions`（不存在则 no-op）。
 * 返回被清掉关联的小记 id（调用方按它重刷搜索索引；删完再查已经查不到了）。
 */
export async function applyQuickTagDirectory(
  d: MobileDb,
  remote: readonly QuickNoteTag[],
  removedIds: readonly string[] = [],
): Promise<{ removedNoteIds: string[] }> {
  const removed = [...new Set(removedIds)];
  const removedNoteIds = new Set<string>();
  // 一次读出已有 id：避免逐条 SELECT（移动端每条 SQL = 一次原生桥往返）。
  const existingRows = await d.prepare("SELECT id FROM tags").all() as Array<{ id: string }>;
  const existing = new Set(existingRows.map((row) => String(row.id)));
  await d.transaction(async () => {
    const maxRow = await d.prepare("SELECT IFNULL(MAX(sort_order), -1) AS m FROM tags WHERE deleted_at IS NULL").get() as { m: number };
    let nextSortOrder = Number(maxRow.m) + 1;
    for (const tag of remote) {
      if (existing.has(tag.id)) {
        await d.prepare("UPDATE tags SET name=?, created_at=?, updated_at=?, deleted_at=NULL WHERE id=?").run(tag.name, tag.createdAt, tag.updatedAt, tag.id);
        continue;
      }
      await d.prepare("INSERT INTO tags(id,name,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,NULL)")
        .run(tag.id, tag.name, nextSortOrder, tag.createdAt, tag.updatedAt);
      existing.add(tag.id);
      nextSortOrder += 1;
    }
    for (const id of removed) {
      for (const noteId of await listQuickNoteIdsForTags(d, [id])) removedNoteIds.add(noteId);
      // 先清关联/版本（*InTransaction：调用方已持事务，不会重复 BEGIN），再删目录行。
      await removeQuickNoteTagLinksInTransaction(d, id);
      // 261105 P1：文档关系（target_kind='note'）同库一并清。
      await removeNoteTagLinksInTransaction(d, id);
      await d.prepare("DELETE FROM tags WHERE id=?").run(id);
    }
  });
  return { removedNoteIds: [...removedNoteIds] };
}

/**
 * 一次性迁移（261105 删除 = 缺席）：旧库把 `deleted_at` 当墓碑，新口径要求这些行**不存在**。
 * 把墓碑 id 并入本机待删 → 物理删行 + 清关联/版本 → 置 `tag_absent_migrated=1`。
 * **必须在第一次同步前跑**（bridge 开库时）；失败不置标记、事务回滚，下次开库重试。
 */
export async function migrateTagAbsence(d: MobileDb): Promise<{ migrated: string[]; noteIds: string[] }> {
  if ((await readDeviceValue(d, TAG_ABSENCE_MIGRATED_KEY)) === "1") return { migrated: [], noteIds: [] };
  const rows = await d.prepare("SELECT id FROM tags WHERE deleted_at IS NOT NULL").all() as Array<{ id: string }>;
  const migrated = rows.map((row) => String(row.id));
  const noteIds = new Set<string>();
  await d.transaction(async () => {
    for (const id of migrated) {
      for (const noteId of await listQuickNoteIdsForTags(d, [id])) noteIds.add(noteId);
      await removeQuickNoteTagLinksInTransaction(d, id);
      await d.prepare("DELETE FROM tags WHERE id=?").run(id);
    }
    if (migrated.length > 0) await writePendingTagDeletes(d, [...(await listPendingTagDeletes(d)), ...migrated]);
    await writeDeviceValue(d, TAG_ABSENCE_MIGRATED_KEY, "1");
  });
  return { migrated, noteIds: [...noteIds] };
}

export async function assertQuickNoteTagsExist(d: MobileDb, tagIds: readonly string[]): Promise<void> {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  const rows = await d.prepare(`SELECT id FROM tags WHERE deleted_at IS NULL AND id IN (${unique.map(() => "?").join(",")})`).all(...unique) as Array<{ id: string }>;
  if (rows.length !== unique.length) throw new Error("标签不存在或已删除");
}
