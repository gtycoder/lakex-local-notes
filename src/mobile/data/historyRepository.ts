import { extractAssetRefs } from "../../core/assetNaming.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { selectHistoryDrops } from "../../core/storeUtils.js";
import { normalizeNoteKind } from "../../core/noteKind.js";
import { historySnapshotRelativePath } from "../../core/noteBodyPaths.js";
import type { MobileDb } from "./sqliteDb";
import { readNoteBody, readHistorySnapshot, writeHistorySnapshot, deleteHistorySnapshot } from "./noteBodies.js";

/**
 * 移动端历史快照（261019 起与桌面同构）：
 * - 正文 = history/{noteId}/*.body.gz（gzip 文件，原生 BodyStore 压缩）；
 * - SQLite note_history 只存 file_path / content_hash / size / refs_json / 时间 / 保护期；
 * - 保留策略与桌面共用 selectHistoryDrops。
 */

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
  const rows = await d.prepare("SELECT note_id, refs_json FROM note_history").all() as Array<{ note_id: string; refs_json: string }>;
  for (const row of rows) {
    try {
      for (const filename of JSON.parse(row.refs_json) as string[]) refs.add(`assets/${row.note_id}/${filename}`);
    } catch { /* 单条坏账跳过 */ }
  }
  return refs;
}

function snapshotFileName(contentHash: string): string {
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${ts}-${contentHash.slice(0, 16)}-${random}.body.gz`;
}

/** 同 hash 24 小时内只留一份，避免编辑器高频保存撑爆历史。 */
export async function createHistorySnapshot(d: MobileDb, noteId: string, content: string, meta: HistoryMeta): Promise<void> {
  const contentHash = sha256Sync(new TextEncoder().encode(content));
  const duplicate = await d.prepare("SELECT 1 FROM note_history WHERE note_id=? AND content_hash=? AND created_at > ? LIMIT 1")
    .get(noteId, contentHash, new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  if (duplicate) return;
  const filePath = historySnapshotRelativePath(noteId, snapshotFileName(contentHash));
  // 先落盘再写 DB：DB 不应声称快照存在而文件不在。
  const size = await writeHistorySnapshot(filePath, content);
  const refs = [...extractAssetRefs(content)];
  const protectedUntil = meta.protectedDays && meta.protectedDays > 0
    ? new Date(Date.now() + meta.protectedDays * 24 * 3600 * 1000).toISOString()
    : null;
  try {
    await d.prepare(
      "INSERT INTO note_history (note_id, file_path, content_hash, title, created_at, size, refs_json, ref_count, protected_until) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(noteId, filePath, contentHash, meta.title, new Date().toISOString(), size, JSON.stringify(refs), refs.length, protectedUntil);
  } catch (error) {
    // 行没写成 ⇒ 不留一份无人引用的快照文件。
    await deleteHistorySnapshot(filePath).catch(() => undefined);
    throw error;
  }
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
  const row = await d.prepare("SELECT note_id, title, file_path FROM note_history WHERE id=?").get(historyId) as {
    note_id: string;
    title: string;
    file_path: string;
  } | undefined;
  if (!row) return null;
  const content = await readHistorySnapshot(row.file_path);
  return content == null ? null : { noteId: row.note_id, title: row.title, content };
}

/** 恢复前给当前正文留档，保证历史恢复本身可以反悔。 */
export async function backupCurrentNote(d: MobileDb, noteId: string): Promise<void> {
  const row = await d.prepare("SELECT title, parent_id, sort_order, doc_kind FROM notes WHERE id=?").get(noteId) as {
    title: string;
    parent_id: string | null;
    sort_order: number;
    doc_kind?: string | null;
  } | undefined;
  if (!row) return;
  const content = await readNoteBody(normalizeNoteKind(row.doc_kind), noteId);
  if (content == null) return;
  await createHistorySnapshot(d, noteId, content, {
    title: row.title,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
  });
}

export async function deleteHistory(d: MobileDb, historyId: number): Promise<void> {
  const row = await d.prepare("SELECT file_path FROM note_history WHERE id=?").get(historyId) as { file_path: string } | undefined;
  if (row) {
    // 先删文件再删行（与桌面同序）：最坏只留"行在、文件没了"，会被健检暴露。
    try { await deleteHistorySnapshot(row.file_path); } catch { /* 文件已缺失不阻断删行 */ }
  }
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
  const row = await d.prepare("SELECT title, parent_id, sort_order, doc_kind FROM notes WHERE id=? AND trashed_at IS NULL").get(noteId) as {
    title: string;
    parent_id: string | null;
    sort_order: number;
    doc_kind?: string | null;
  } | undefined;
  if (!row) return;
  const content = await readNoteBody(normalizeNoteKind(row.doc_kind), noteId);
  if (content == null) return;
  await createHistorySnapshot(d, noteId, content, {
    title: row.title,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
  });
}

/** 分层保留 + 每篇上限 + 保留天数；删除逻辑由共享纯函数决策，本层只负责落库与删文件。 */
export async function cleanupHistory(d: MobileDb, settings: HistoryMobileSettings): Promise<{ deleted: number }> {
  const noteIds = await d.prepare("SELECT DISTINCT note_id FROM note_history").all() as Array<{ note_id: string }>;
  let deleted = 0;
  for (const { note_id } of noteIds) {
    const rows = await d.prepare("SELECT id, file_path, created_at, protected_until FROM note_history WHERE note_id=? ORDER BY created_at ASC").all(note_id) as Array<{
      id: number;
      file_path: string;
      created_at: string;
      protected_until: string | null;
    }>;
    if (rows.length === 0) continue;
    const nowIso = new Date().toISOString();
    // 到期保护回归普通保留策略（对齐桌面）。
    for (const row of rows) {
      if (row.protected_until != null && row.protected_until <= nowIso) {
        await d.prepare("UPDATE note_history SET protected_until=NULL WHERE id=?").run(row.id);
        row.protected_until = null;
      }
    }
    const drops = selectHistoryDrops(rows.map((row) => row.created_at), {
      maxSnapshots: settings.maxSnapshots,
      retentionDays: settings.retentionDays,
    });
    for (const row of rows) {
      if (!drops.has(row.created_at)) continue;
      // 冲突归档保护窗口内是"被覆盖方唯一可恢复副本"，即使命中保留策略也不自动删（对齐桌面 B3）。
      if (row.protected_until != null && row.protected_until > nowIso) continue;
      try { await deleteHistorySnapshot(row.file_path); } catch { /* 文件已缺失不阻断删行 */ }
      deleted += (await d.prepare("DELETE FROM note_history WHERE id=?").run(row.id)).changes;
    }
  }
  return { deleted };
}
