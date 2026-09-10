import { extractAssetRefs } from "../core/assetNaming.js";
import { sha256Sync } from "../core/sha256Sync.js";
import { selectHistoryDrops } from "../core/storeUtils.js";
import type { MobileDb } from "./sqliteDb";

export interface HistoryMobileSettings {
  maxSnapshots: number;
  retentionDays: number;
  cleanupIntervalHours: number;
  snapshotIntervalMinutes: number;
}

export interface HistorySnapshotSummary {
  id: number;
  title: string;
  createdAt: string;
}

export const DEFAULT_HISTORY_SETTINGS: HistoryMobileSettings = {
  maxSnapshots: 100,
  retentionDays: 30,
  cleanupIntervalHours: 24,
  snapshotIntervalMinutes: 15,
};

type HistoryMeta = {
  title: string;
  parentId: string | null;
  sortOrder: number;
  protectedDays?: number;
};

/** 历史快照引用的资产路径集合（形如 assets/{noteId}/{filename}），深清理 GC 必须保留。 */
export async function historyAssetRefs(d: MobileDb): Promise<Set<string>> {
  const refs = new Set<string>();
  const rows = await d.prepare("SELECT note_id, content FROM note_history").all() as Array<{ note_id: string; content: string }>;
  for (const row of rows) {
    for (const filename of extractAssetRefs(row.content)) {
      refs.add(`assets/${row.note_id}/${filename}`);
    }
  }
  return refs;
}

/** 同 hash 24 小时内只留一份，避免编辑器高频保存撑爆历史表。 */
export async function createHistorySnapshot(d: MobileDb, noteId: string, content: string, meta: HistoryMeta): Promise<void> {
  const contentHash = sha256Sync(new TextEncoder().encode(content));
  const duplicate = await d.prepare("SELECT 1 FROM note_history WHERE note_id=? AND content_hash=? AND created_at > ? LIMIT 1")
    .get(noteId, contentHash, new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  if (duplicate) return;
  await d.prepare("INSERT INTO note_history (note_id, content, content_hash, title, parent_id, sort_order, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(noteId, content, contentHash, meta.title, meta.parentId, meta.sortOrder, new Date().toISOString());
}

export async function listNoteHistory(d: MobileDb, noteId: string): Promise<HistorySnapshotSummary[]> {
  const rows = await d.prepare("SELECT id, title, created_at FROM note_history WHERE note_id=? ORDER BY created_at DESC, id DESC").all(noteId) as Array<{
    id: number;
    title: string;
    created_at: string;
  }>;
  return rows.map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at }));
}

export async function readHistory(d: MobileDb, historyId: number): Promise<{ noteId: string; title: string; content: string } | null> {
  const row = await d.prepare("SELECT note_id, title, content FROM note_history WHERE id=?").get(historyId) as {
    note_id: string;
    title: string;
    content: string;
  } | undefined;
  return row ? { noteId: row.note_id, title: row.title, content: row.content } : null;
}

/** 恢复前给当前正文留档，保证历史恢复本身可以反悔。 */
export async function backupCurrentNote(d: MobileDb, noteId: string): Promise<void> {
  const row = await d.prepare("SELECT title, content, parent_id, sort_order FROM notes WHERE id=?").get(noteId) as {
    title: string;
    content: string;
    parent_id: string | null;
    sort_order: number;
  } | undefined;
  if (!row) return;
  await createHistorySnapshot(d, noteId, row.content, {
    title: row.title,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
  });
}

export async function deleteHistory(d: MobileDb, historyId: number): Promise<void> {
  await d.prepare("DELETE FROM note_history WHERE id=?").run(historyId);
}

export async function getHistorySettings(d: MobileDb): Promise<HistoryMobileSettings> {
  const row = await d.prepare("SELECT value FROM device_state WHERE key='history_settings'").get() as { value: string } | undefined;
  if (!row) return DEFAULT_HISTORY_SETTINGS;
  try {
    const parsed = JSON.parse(row.value) as Partial<HistoryMobileSettings>;
    return {
      maxSnapshots: normalizePositive(parsed.maxSnapshots, DEFAULT_HISTORY_SETTINGS.maxSnapshots),
      retentionDays: normalizePositive(parsed.retentionDays, DEFAULT_HISTORY_SETTINGS.retentionDays),
      cleanupIntervalHours: normalizeNonNegative(parsed.cleanupIntervalHours, DEFAULT_HISTORY_SETTINGS.cleanupIntervalHours),
      snapshotIntervalMinutes: normalizeNonNegative(parsed.snapshotIntervalMinutes, DEFAULT_HISTORY_SETTINGS.snapshotIntervalMinutes),
    };
  } catch {
    return DEFAULT_HISTORY_SETTINGS;
  }
}

function normalizePositive(value: unknown, fallback: number): number {
  return typeof value === "number" && value > 0 ? value : fallback;
}

function normalizeNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && value >= 0 ? value : fallback;
}

export async function saveHistorySettings(d: MobileDb, settings: HistoryMobileSettings): Promise<void> {
  await d.prepare("INSERT INTO device_state(key,value) VALUES('history_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(settings));
}

export async function snapshotNote(d: MobileDb, noteId: string): Promise<void> {
  const row = await d.prepare("SELECT title, content, parent_id, sort_order FROM notes WHERE id=? AND trashed_at IS NULL").get(noteId) as {
    title: string;
    content: string;
    parent_id: string | null;
    sort_order: number;
  } | undefined;
  if (!row) return;
  await createHistorySnapshot(d, noteId, row.content, {
    title: row.title,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
  });
}

/** 分层保留 + 每篇上限 + 保留天数；删除逻辑由共享纯函数决策，本层只负责落库。 */
export async function cleanupHistory(d: MobileDb, settings: HistoryMobileSettings): Promise<{ deleted: number }> {
  const noteIds = await d.prepare("SELECT DISTINCT note_id FROM note_history").all() as Array<{ note_id: string }>;
  let deleted = 0;
  for (const { note_id } of noteIds) {
    const rows = await d.prepare("SELECT id, created_at FROM note_history WHERE note_id=? ORDER BY created_at ASC").all(note_id) as Array<{
      id: number;
      created_at: string;
    }>;
    if (rows.length === 0) continue;
    const drops = selectHistoryDrops(rows.map((row) => row.created_at), {
      maxSnapshots: settings.maxSnapshots,
      retentionDays: settings.retentionDays,
    });
    for (const row of rows) {
      if (drops.has(row.created_at)) {
        deleted += (await d.prepare("DELETE FROM note_history WHERE id=?").run(row.id)).changes;
      }
    }
  }
  return { deleted };
}
