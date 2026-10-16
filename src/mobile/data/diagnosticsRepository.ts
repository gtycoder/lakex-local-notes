import type { MobileDb } from "./sqliteDb";

export interface MobileDiagnostics {
  noteCount: number;
  folderCount: number;
  quickNoteCount: number;
  resourceCount: number;
  orphanCount: number;
  gcPendingCount: number;
  snapshotCount: number;
  dbBytes: number;
}

export interface DiagnosticsRepositoryDeps {
  listAssetKeys: () => Promise<string[]>;
  getDatabaseSizeBytes: () => Promise<number>;
}

export async function getDiagnostics(
  d: MobileDb,
  deps: DiagnosticsRepositoryDeps,
): Promise<MobileDiagnostics> {
  const count = async (sql: string): Promise<number> => {
    const row = await d.prepare(sql).get() as { c: number };
    return row.c;
  };
  return {
    noteCount: await count("SELECT COUNT(*) c FROM notes WHERE deleted_at IS NULL AND trashed_at IS NULL"),
    folderCount: await count("SELECT COUNT(*) c FROM folders WHERE trashed_at IS NULL"),
    quickNoteCount: await count("SELECT COUNT(*) c FROM quick_notes"),
    resourceCount: (await deps.listAssetKeys()).length,
    orphanCount: await count("SELECT COUNT(*) c FROM orphan_assets"),
    gcPendingCount: await count("SELECT COUNT(*) c FROM s3_gc_pending"),
    snapshotCount: await count("SELECT COUNT(*) c FROM note_history"),
    dbBytes: await deps.getDatabaseSizeBytes(),
  };
}
