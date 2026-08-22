import type { DbLike } from "../src/core/dbLike.js";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { lakeHtmlToPlain } from "../src/core/lakeCaches.js";

export interface HistorySnapshotSummary {
  id: number;
  createdAt: string;
  size: number;
  contentHash: string;
  refCount: number;
  filePath: string;
}

export interface HistorySnapshotPreview {
  plain: string;
  /** Lake 原文 HTML（viewer 渲染预览用，保留图片/代码块/公式等样式） */
  html: string;
  createdAt: string;
  contentHash: string;
}

interface HistoryRow {
  id: number;
  created_at: string;
  size: number;
  content_hash: string;
  ref_count: number;
  file_path: string;
}

interface HistoryPreviewRow {
  file_path: string;
  created_at: string;
  content_hash: string;
}

/** Read-only history access; snapshot creation/deletion remains in Store. */
export class HistoryRepository {
  constructor(private readonly db: DbLike, private readonly root: string) {}

  listForNote(noteId: string): HistorySnapshotSummary[] {
    const rows = this.db.prepare(
      "SELECT id,created_at,size,content_hash,ref_count,file_path FROM note_history WHERE note_id=? ORDER BY created_at DESC"
    ).all(noteId) as HistoryRow[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      size: row.size,
      contentHash: row.content_hash,
      refCount: row.ref_count,
      filePath: row.file_path,
    }));
  }

  preview(historyId: number): HistorySnapshotPreview | null {
    const row = this.db.prepare("SELECT file_path,created_at,content_hash FROM note_history WHERE id=?").get(historyId) as HistoryPreviewRow | undefined;
    if (!row) return null;
    try {
      const body = zlib.gunzipSync(fs.readFileSync(path.join(this.root, row.file_path))).toString("utf8");
      return { plain: lakeHtmlToPlain(body), html: body, createdAt: row.created_at, contentHash: row.content_hash };
    } catch {
      return null;
    }
  }

  stats(): { snapshotCount: number; totalBytes: number } {
    const row = this.db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS bytes FROM note_history").get() as { c: number; bytes: number };
    return { snapshotCount: row.c, totalBytes: row.bytes };
  }
}
