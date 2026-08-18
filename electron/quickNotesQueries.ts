import Database from "better-sqlite3";
import fs from "node:fs";
import type { QuickNoteDocument, QuickNoteSummary, QuickNoteDeleted } from "./quickNoteTypes.js";
import { AppError } from "./storeErrors.js";
import { parseQuickNoteContent, validateQuickNoteContent, type StoredQuickNoteContent } from "../src/lib/quickNoteModel.js";

export interface QuickNoteRow {
  id: string;
  created_at: string;
  updated_at: string;
  preview_text: string;
  image_count: number;
  content_hash: string;
  sync_state: QuickNoteSummary["syncState"];
  is_conflict: number;
  restore_pending_at?: string | null;
}

export interface QuickNoteDeletedRow {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string;
  conversion_target_note_id: string | null;
  ready_to_sync: number;
  purged_at?: string | null;
}

export interface QuickNoteConversionRow {
  source_quick_note_id: string;
  target_note_id: string;
  target_notebook_id: string;
  state: "prepared" | "target_created" | "source_deleted_waiting_sync" | "complete";
  created_at: string;
  updated_at: string;
}

interface QuickNotesQueryDeps {
  db: Database.Database;
  itemPath(id: string): string;
  imageUrl(noteId: string, filename: string): string;
}

/** Read-only Quick Notes queries; write/state-machine operations stay in QuickNotesStore. */
export class QuickNotesQueries {
  constructor(private readonly deps: QuickNotesQueryDeps) {}

  readRow(id: string): QuickNoteRow {
    const row = this.deps.db.prepare("SELECT * FROM quick_notes WHERE id=?").get(id) as QuickNoteRow | undefined;
    if (!row) throw new AppError("NotFound", "小记不存在");
    return row;
  }

  readStoredContent(id: string): StoredQuickNoteContent {
    let raw: unknown;
    try { raw = parseQuickNoteContent(fs.readFileSync(this.deps.itemPath(id), "utf8")); }
    catch (error) { throw new AppError("Internal", `小记内容损坏: ${error instanceof Error ? error.message : String(error)}`); }
    try { return validateQuickNoteContent(raw); }
    catch (error) { throw new AppError("InvalidInput", error instanceof Error ? error.message : String(error)); }
  }

  mapDocument(row: QuickNoteRow, content: StoredQuickNoteContent): QuickNoteDocument {
    const images = content.images.map((image) => ({ ...image, url: this.deps.imageUrl(row.id, image.filename) }));
    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      previewText: row.preview_text,
      imageCount: row.image_count,
      contentHash: row.content_hash,
      syncState: row.sync_state,
      isConflict: !!row.is_conflict,
      content: { version: content.version, text: content.text, images },
    };
  }

  read(id: string): QuickNoteDocument {
    const row = this.readRow(id);
    return this.mapDocument(row, this.readStoredContent(id));
  }

  list(): QuickNoteDocument[] {
    const rows = this.deps.db.prepare("SELECT * FROM quick_notes ORDER BY created_at DESC").all() as QuickNoteRow[];
    return rows.map((row) => this.mapDocument(row, this.readStoredContent(row.id)));
  }

  listTrash(): Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string }> {
    return (this.deps.db.prepare(
      "SELECT id,created_at,updated_at,deleted_at FROM quick_note_deleted WHERE conversion_target_note_id IS NULL AND purged_at IS NULL ORDER BY deleted_at DESC"
    ).all() as Array<{ id: string; created_at: string; updated_at: string; deleted_at: string }>)
      .filter((row) => fs.existsSync(this.deps.itemPath(row.id)))
      .map((row) => ({ id: row.id, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at }));
  }

  isRestorePending(id: string): boolean {
    return !!this.deps.db.prepare("SELECT 1 FROM quick_notes WHERE id=? AND restore_pending_at IS NOT NULL").get(id);
  }

  hasDeleted(id: string): boolean {
    return !!this.deps.db.prepare("SELECT 1 FROM quick_note_deleted WHERE id=?").get(id);
  }

  deletedRecord(id: string): QuickNoteDeleted | null {
    const row = this.deps.db.prepare("SELECT * FROM quick_note_deleted WHERE id=?").get(id) as QuickNoteDeletedRow | undefined;
    return row ? {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      conversionTargetNoteId: row.conversion_target_note_id ?? null,
      readyToSync: !!row.ready_to_sync,
    } : null;
  }

  listDeletedForSync(): QuickNoteDeleted[] {
    return this.mapDeletedRows(this.deps.db.prepare("SELECT * FROM quick_note_deleted WHERE ready_to_sync=1 ORDER BY deleted_at").all() as QuickNoteDeletedRow[]);
  }

  listDeferredDeletedForSync(): QuickNoteDeleted[] {
    return this.mapDeletedRows(this.deps.db.prepare("SELECT * FROM quick_note_deleted WHERE ready_to_sync=0 ORDER BY deleted_at").all() as QuickNoteDeletedRow[]);
  }

  private mapDeletedRows(rows: QuickNoteDeletedRow[]): QuickNoteDeleted[] {
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      conversionTargetNoteId: row.conversion_target_note_id ?? null,
      readyToSync: !!row.ready_to_sync,
    }));
  }
}
