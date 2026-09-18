import type { DbLike } from "./dbLike.js";
import fs from "node:fs";

export interface OrphanAsset {
  id: number;
  noteId: string;
  filename: string;
  filePath: string;
  size: number;
  mimeType: string;
  detectedAt: string;
  /** 所属文档标题（store 列表时补全；active/trash/missing）。 */
  noteTitle?: string;
  noteState?: "active" | "trash" | "missing";
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
  /** 未保存草稿（draft-journal）引用的资源文件名；缺省 = 不做草稿保护。 */
  draftRefsFor?(noteId: string): Set<string>;
}

/** Read-only asset reference/orphan queries; cleanup and upload writes remain in Store. */
export class AssetRepository {
  private readonly db: DbLike;
  private readonly notePathFor: AssetRepositoryDeps["notePathFor"];
  private readonly extractAssetRefs: AssetRepositoryDeps["extractAssetRefs"];
  private readonly draftRefsFor: AssetRepositoryDeps["draftRefsFor"];

  constructor({ db, notePathFor, extractAssetRefs, draftRefsFor }: AssetRepositoryDeps) {
    this.db = db;
    this.notePathFor = notePathFor;
    this.extractAssetRefs = extractAssetRefs;
    this.draftRefsFor = draftRefsFor;
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
    // 未保存草稿引用的资源同受保护。粘贴图落盘即登记孤儿、正文要等防抖保存（1s）才引用它，
    // 草稿正是这段窗口里"用户还要它"的唯一记录（审计 260918 D3/F6：崩溃/强制退出后重启，
    // 历史清理会把草稿里的图物理删掉 → 草稿恢复即死链，且孤儿不上传 ⇒ 云端也没有 = 真丢）。
    // 放在这个单点上 ⇒ 所有删除路径（自动 cleanupUnreferencedAssetsForNote / 全局 cleanOrphanAssets /
    // 单条 deleteOrphanAsset）与云端 GC（keep 集、待回收标记）口径一致。
    // 例外：listNoteOrphans/listRemovedAssets 是纯展示，仍按「当前正文 ∪ 历史」判定，
    // 所以草稿期的文件会显示为孤儿但清理会跳过它（宁可不删，不可误删）。
    for (const filename of this.draftRefsFor?.(noteId) ?? []) refs.add(filename);
    return refs;
  }

  listNoteIdsWithHistory(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT note_id AS id FROM note_history").all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }
}
