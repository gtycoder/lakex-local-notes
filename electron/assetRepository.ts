import type { DbLike } from "../src/core/dbLike.js";
import fs from "node:fs";

export interface OrphanAsset {
  id: number;
  noteId: string;
  filename: string;
  filePath: string;
  size: number;
  mimeType: string;
  detectedAt: string;
}

export interface OrphanAssetRow {
  id: number;
  note_id: string;
  filename: string;
  file_path: string;
  size: number;
  mime_type: string;
  detected_at: string;
}

interface AssetRepositoryDeps {
  db: DbLike;
  notePathFor(noteId: string): string;
  extractAssetRefs(content: string): Set<string>;
}

/** Read-only asset reference/orphan queries; cleanup and upload writes remain in Store. */
export class AssetRepository {
  private readonly db: DbLike;
  private readonly notePathFor: AssetRepositoryDeps["notePathFor"];
  private readonly extractAssetRefs: AssetRepositoryDeps["extractAssetRefs"];

  constructor({ db, notePathFor, extractAssetRefs }: AssetRepositoryDeps) {
    this.db = db;
    this.notePathFor = notePathFor;
    this.extractAssetRefs = extractAssetRefs;
  }

  listOrphanAssets(): OrphanAsset[] {
    const rows = this.db.prepare("SELECT * FROM orphan_assets ORDER BY detected_at DESC").all() as OrphanAssetRow[];
    return rows.map((row) => ({
      id: row.id,
      noteId: row.note_id,
      filename: row.filename,
      filePath: row.file_path,
      size: row.size,
      mimeType: row.mime_type,
      detectedAt: row.detected_at,
    }));
  }

  getCurrentContentRefs(noteId: string): Set<string> {
    const filePath = this.notePathFor(noteId);
    if (!fs.existsSync(filePath)) return new Set();
    return this.extractAssetRefs(fs.readFileSync(filePath, "utf8"));
  }

  getHistoryRefs(noteId: string): Set<string> {
    const rows = this.db.prepare("SELECT refs_json FROM note_history WHERE note_id=?").all(noteId) as Array<{ refs_json: string }>;
    const refs = new Set<string>();
    for (const row of rows) {
      try {
        for (const filename of JSON.parse(row.refs_json) as string[]) refs.add(filename);
      } catch {
        // Ignore one malformed historical refs entry; other snapshots remain usable.
      }
    }
    return refs;
  }

  getProtectedRefs(noteId: string): Set<string> {
    const refs = this.getCurrentContentRefs(noteId);
    for (const filename of this.getHistoryRefs(noteId)) refs.add(filename);
    return refs;
  }

  listNoteIdsWithHistory(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT note_id AS id FROM note_history").all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }
}
