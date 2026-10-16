import type { MobileDb } from "./sqliteDb";

export interface OrphanAsset {
  id: number;
  noteId: string;
  filename: string;
  size: number;
  mimeType: string;
  detectedAt: string;
}

export interface OrphanAssetRepositoryDeps {
  assets: Map<string, Uint8Array>;
  removeAssetFile: (key: string) => Promise<void>;
}

function rowToOrphanAsset(row: {
  id: number;
  note_id: string;
  filename: string;
  size: number;
  mime_type: string;
  detected_at: string;
}): OrphanAsset {
  return {
    id: row.id,
    noteId: row.note_id,
    filename: row.filename,
    size: row.size,
    mimeType: row.mime_type,
    detectedAt: row.detected_at,
  };
}

export async function listOrphanAssets(d: MobileDb): Promise<OrphanAsset[]> {
  const rows = await d.prepare(
    "SELECT id, note_id, filename, size, mime_type, detected_at FROM orphan_assets ORDER BY detected_at DESC",
  ).all() as Array<{
    id: number;
    note_id: string;
    filename: string;
    size: number;
    mime_type: string;
    detected_at: string;
  }>;
  return rows.map(rowToOrphanAsset);
}

/** 删除孤儿前先移除文件；文件失败时不删 DB 行，避免登记与真实文件状态分叉。 */
export async function deleteOrphanAsset(
  d: MobileDb,
  id: number,
  deps: OrphanAssetRepositoryDeps,
): Promise<void> {
  const row = await d.prepare("SELECT note_id, filename FROM orphan_assets WHERE id=?").get(id) as {
    note_id: string;
    filename: string;
  } | undefined;
  if (!row) return;
  const key = `${row.note_id}/${row.filename}`;
  await deps.removeAssetFile(key);
  deps.assets.delete(key);
  await d.prepare("DELETE FROM orphan_assets WHERE id=?").run(id);
}

export async function cleanOrphanAssets(
  d: MobileDb,
  deps: OrphanAssetRepositoryDeps,
): Promise<void> {
  const rows = await d.prepare("SELECT note_id, filename FROM orphan_assets").all() as Array<{
    note_id: string;
    filename: string;
  }>;
  for (const row of rows) {
    const key = `${row.note_id}/${row.filename}`;
    await deps.removeAssetFile(key);
    deps.assets.delete(key);
  }
  await d.prepare("DELETE FROM orphan_assets").run();
}
