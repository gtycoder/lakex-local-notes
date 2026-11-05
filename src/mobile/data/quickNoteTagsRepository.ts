/**
 * 移动端标签目录子系统：只拥有 `tags`（通用标签目录），不认识小记、不读正文。
 * 关系在 `quickNoteTagLinksRepository`；两者只在 `quickNoteTagService` 里组合。
 *
 * 261105 用户定稿：目录顺序是**设备本地视图**（不参与同步；置顶功能已删除）。
 * - 未手动排序：默认「新的在前（created_at DESC）→ 名称」；
 * - 手动拖拽后：device_state 记本机标记，按本机 sort_order；新增标签追加末尾；
 * - 同步合并只更新名称/墓碑/时间，不覆盖本机顺序。
 */
import { mergeQuickNoteTags, normalizeQuickNoteTag, quickNoteTagId, type QuickNoteTag } from "../../core/quickNoteTags.js";
import type { MobileDb } from "./sqliteDb.js";

type QuickNoteTagRow = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const MANUAL_ORDER_KEY = "quick_tags_manual_order";

function mapRow(row: QuickNoteTagRow): QuickNoteTag {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "zh-CN");
}

/** 是否已在本机手动排序过（设备本地标记，不参与同步）。 */
export async function isQuickNoteTagManualOrder(d: MobileDb): Promise<boolean> {
  const row = await d.prepare("SELECT value FROM device_state WHERE key=?").get(MANUAL_ORDER_KEY) as { value?: string } | undefined;
  return row?.value === "1";
}

async function markManualOrder(d: MobileDb): Promise<void> {
  await d.prepare("INSERT INTO device_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(MANUAL_ORDER_KEY, "1");
}

/** 目录列表（本地展示顺序）：手动排序过按 sort_order，否则新→旧 → 名称。 */
export async function listQuickNoteTags(d: MobileDb, options: { includeDeleted?: boolean } = {}): Promise<QuickNoteTag[]> {
  const where = options.includeDeleted ? "" : "WHERE deleted_at IS NULL";
  const rows = await d.prepare(`SELECT * FROM tags ${where}`).all() as QuickNoteTagRow[];
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

/** 幂等创建：同名 active 直接返回；同名墓碑复活。新标签默认追加到末尾。 */
export async function ensureQuickNoteTag(d: MobileDb, rawName: string, at = new Date().toISOString()): Promise<QuickNoteTag> {
  const name = normalizeQuickNoteTag(rawName);
  const existing = await d.prepare("SELECT * FROM tags WHERE name=? AND deleted_at IS NULL ORDER BY created_at LIMIT 1").get(name) as QuickNoteTagRow | undefined;
  if (existing) return mapRow(existing);
  const id = quickNoteTagId(name);
  const previous = await d.prepare("SELECT * FROM tags WHERE id=?").get(id) as QuickNoteTagRow | undefined;
  const maxRow = await d.prepare("SELECT IFNULL(MAX(sort_order), -1) AS m FROM tags WHERE deleted_at IS NULL").get() as { m: number };
  const tag: QuickNoteTag = {
    id,
    name,
    createdAt: previous ? String(previous.created_at) : at,
    updatedAt: at,
    deletedAt: null,
  };
  await d.prepare("INSERT INTO tags(id,name,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?)")
    .run(tag.id, tag.name, Number(maxRow.m) + 1, tag.createdAt, tag.updatedAt, tag.deletedAt);
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
    deletedAt: null,
  };
  await d.prepare("UPDATE tags SET name=?, updated_at=?, deleted_at=NULL WHERE id=?").run(next.name, next.updatedAt, id);
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

/** 写墓碑（关联清理由协调层负责）。 */
export async function tombstoneQuickNoteTag(d: MobileDb, id: string, at = new Date().toISOString()): Promise<void> {
  const row = await active(d, id);
  if (!row) throw new Error("标签不存在或已删除");
  await d.prepare("UPDATE tags SET updated_at=?, deleted_at=? WHERE id=?").run(at, at, id);
}

/**
 * 目录 LWW 合并：返回合并后的全量目录（含墓碑）。
 * 只合并名称/墓碑/时间；本机 sort_order 不动；远端新标签追加到本机末尾。
 */
export async function mergeRemoteQuickNoteTags(d: MobileDb, remote: readonly QuickNoteTag[]): Promise<QuickNoteTag[]> {
  const merged = mergeQuickNoteTags(await listQuickNoteTags(d, { includeDeleted: true }), remote);
  const maxRow = await d.prepare("SELECT IFNULL(MAX(sort_order), -1) AS m FROM tags WHERE deleted_at IS NULL").get() as { m: number };
  let nextSortOrder = Number(maxRow.m) + 1;
  await d.transaction(async () => {
    for (const tag of merged) {
      const exists = await d.prepare("SELECT 1 FROM tags WHERE id=?").get(tag.id) as unknown;
      if (exists) {
        await d.prepare("UPDATE tags SET name=?, updated_at=?, deleted_at=? WHERE id=?").run(tag.name, tag.updatedAt, tag.deletedAt ?? null, tag.id);
        continue;
      }
      await d.prepare("INSERT INTO tags(id,name,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?)")
        .run(tag.id, tag.name, nextSortOrder, tag.createdAt, tag.updatedAt, tag.deletedAt ?? null);
      nextSortOrder += 1;
    }
  });
  return merged;
}

export async function assertQuickNoteTagsExist(d: MobileDb, tagIds: readonly string[]): Promise<void> {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  const rows = await d.prepare(`SELECT id FROM tags WHERE deleted_at IS NULL AND id IN (${unique.map(() => "?").join(",")})`).all(...unique) as Array<{ id: string }>;
  if (rows.length !== unique.length) throw new Error("标签不存在或已删除");
}
