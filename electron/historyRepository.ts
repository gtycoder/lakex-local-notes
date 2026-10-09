import type { DbLike } from "./dbLike.js";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { lakeHtmlToPlain } from "../src/core/lakeCaches.js";
import { normalizeNoteKind, type NoteKind } from "../src/core/noteKind.js";
import { searchTextForKind } from "../src/core/noteSearchText.js";

export interface HistorySnapshotSummary {
  id: number;
  createdAt: string;
  size: number;
  contentHash: string;
  refCount: number;
  filePath: string;
  /** B3：冲突归档保护截止（ISO）；未到期的受保护快照不被自动清理。null=普通快照。 */
  protectedUntil: string | null;
  /** 文档类型：渲染层据此预热对应的预览分包（同一篇文档的所有快照同类型）。 */
  kind: NoteKind;
}

export interface HistorySnapshotPreview {
  /** 文档类型：doc 的 `html` 是 Lake 正文（只读 viewer 渲染）；非 doc 是内部 JSON（按 kind 渲染结构化预览）。 */
  kind: NoteKind;
  plain: string;
  /** 快照正文原文：doc = Lake HTML（viewer 渲染用）；usheet/bitable/board = 各自的内部 JSON。 */
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
  protected_until: string | null;
  kind?: string | null;
}

interface HistoryPreviewRow {
  file_path: string;
  created_at: string;
  content_hash: string;
  kind?: string | null;
}

/** Read-only history access; snapshot creation/deletion remains in Store. */
export class HistoryRepository {
  constructor(private readonly db: DbLike, private readonly root: string) {}

  listForNote(noteId: string): HistorySnapshotSummary[] {
    const rows = this.db.prepare(
      "SELECT h.id,h.created_at,h.size,h.content_hash,h.ref_count,h.file_path,h.protected_until,n.kind" +
      " FROM note_history h LEFT JOIN notes n ON n.id = h.note_id WHERE h.note_id=? ORDER BY h.created_at DESC"
    ).all(noteId) as HistoryRow[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      size: row.size,
      contentHash: row.content_hash,
      refCount: row.ref_count,
      filePath: row.file_path,
      protectedUntil: row.protected_until ?? null,
      kind: normalizeNoteKind(row.kind),
    }));
  }

  preview(historyId: number): HistorySnapshotPreview | null {
    // 带上文档类型：doc 的快照正文是 Lake HTML，usheet/bitable/board 是内部 JSON（渲染方式完全不同）。
    const row = this.db.prepare(
      "SELECT h.file_path AS file_path, h.created_at AS created_at, h.content_hash AS content_hash, n.kind AS kind" +
      " FROM note_history h LEFT JOIN notes n ON n.id = h.note_id WHERE h.id = ?"
    ).get(historyId) as HistoryPreviewRow | undefined;
    if (!row) return null;
    try {
      const body = zlib.gunzipSync(fs.readFileSync(path.join(this.root, row.file_path))).toString("utf8");
      const kind = normalizeNoteKind(row.kind);
      // doc 走 Lake 解析；非 doc 的正文是内部 JSON，喂 HTML 解析器只会得到一堆 JSON 碎片 ⇒ 走与搜索索引
      // 同一口径的派生（src/core/noteSearchText.ts）。渲染层再按 kind 决定用只读 viewer 还是结构化预览。
      const plain = kind === "doc" ? lakeHtmlToPlain(body) : (searchTextForKind(kind, body).plain ?? "");
      return { kind, plain, html: body, createdAt: row.created_at, contentHash: row.content_hash };
    } catch {
      return null;
    }
  }

  stats(): { snapshotCount: number; totalBytes: number } {
    const row = this.db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS bytes FROM note_history").get() as { c: number; bytes: number };
    return { snapshotCount: row.c, totalBytes: row.bytes };
  }
}
