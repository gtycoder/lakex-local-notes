import type { DbLike } from "./sqliteDb";

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
  getDatabaseSizeBytes: () => number;
}

export async function getDiagnostics(
  d: DbLike,
  deps: DiagnosticsRepositoryDeps,
): Promise<MobileDiagnostics> {
  const count = (sql: string) => (d.prepare(sql).get() as { c: number }).c;
  return {
    noteCount: count("SELECT COUNT(*) c FROM notes WHERE deleted_at IS NULL AND trashed_at IS NULL"),
    folderCount: count("SELECT COUNT(*) c FROM folders WHERE trashed_at IS NULL"),
    quickNoteCount: count("SELECT COUNT(*) c FROM quick_notes"),
    resourceCount: (await deps.listAssetKeys()).length,
    orphanCount: count("SELECT COUNT(*) c FROM orphan_assets"),
    gcPendingCount: count("SELECT COUNT(*) c FROM s3_gc_pending"),
    snapshotCount: count("SELECT COUNT(*) c FROM note_history"),
    dbBytes: deps.getDatabaseSizeBytes(),
  };
}
