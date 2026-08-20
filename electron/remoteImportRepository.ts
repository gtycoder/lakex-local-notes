import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SyncNote, SyncFolder } from "./noteQueries.js";
import { AppError } from "./storeErrors.js";

interface RemoteAsset {
  filename: string;
  bytes: Buffer;
}

interface RemoteImportDeps {
  db: Database.Database;
  workspaceId: string;
  trashNotebookId: string;
  notePathFor(noteId: string): string;
  assetDirFor(noteId: string): string;
  isSafeSegment(value: string): boolean;
  detectOrphans(noteId: string, content: string): void;
  ensureNoteCaches(noteId: string, content: string): boolean;
  logImport(noteId: string, contentBytes: number, assetCount: number, startedAt: number): void;
}

/** Owns remote note staging and atomic file placement; Store keeps the wrapper. */
export class RemoteImportRepository {
  constructor(private readonly deps: RemoteImportDeps) {}

  importNote(note: SyncNote, content: Buffer, assets: RemoteAsset[]): void {
    const startedAt = Date.now();
    const lakePath = this.deps.notePathFor(note.id);
    for (const asset of assets) {
      if (!this.deps.isSafeSegment(asset.filename)) {
        throw new AppError("InvalidInput", `无效的资源文件名: ${asset.filename}`);
      }
    }

    const assetDir = assets.length > 0 ? this.deps.assetDirFor(note.id) : null;
    const lakeTmp = `${lakePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    const assetTmpDir = assetDir ? `${assetDir}.staging-${crypto.randomBytes(4).toString("hex")}` : null;
    let moved = false;
    let lakePlaced = false;
    let previousLakeBackedUp = false;
    const lakeBackup = `${lakePath}.previous-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    const movedAssetPaths: string[] = [];
    try {
      // 先完成文件落盘，再提交 DB。这样 rename 故障不会留下“DB 已 synced、正文文件不存在”的半状态。
      fs.writeFileSync(lakeTmp, content, "utf8");
      if (assetTmpDir) {
        fs.mkdirSync(assetTmpDir, { recursive: true });
        for (const asset of assets) fs.writeFileSync(path.join(assetTmpDir, asset.filename), asset.bytes);
      }

      fs.mkdirSync(path.dirname(lakePath), { recursive: true });
      if (fs.existsSync(lakePath)) {
        fs.renameSync(lakePath, lakeBackup);
        previousLakeBackedUp = true;
      }
      fs.renameSync(lakeTmp, lakePath);
      lakePlaced = true;

      if (assetTmpDir && assetDir) {
        fs.mkdirSync(assetDir, { recursive: true });
        for (const asset of assets) {
          const destination = path.join(assetDir, asset.filename);
          fs.renameSync(path.join(assetTmpDir, asset.filename), destination);
          movedAssetPaths.push(destination);
        }
        try { fs.rmdirSync(assetTmpDir); } catch { /* staging cleanup is best effort */ }
      }

      const transaction = this.deps.db.transaction(() => {
        const trashed = note.parentId === this.deps.trashNotebookId;
        const trashedAt = trashed ? (note.trashedAt ?? null) : null;
        const deletedFrom = trashed ? (note.deletedFromParentId ?? null) : null;
        this.deps.db.prepare(
          `INSERT INTO notes(id,title,parent_id,sort_order,updated_at,sync_state,is_conflict,deleted_at,is_locked,locked_at,trashed_at,deleted_from_parent_id)
           VALUES(?,?,?,?,?,'synced',?,NULL,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title,parent_id=excluded.parent_id,
             sort_order=excluded.sort_order,updated_at=excluded.updated_at,
             is_locked=excluded.is_locked,locked_at=excluded.locked_at,
             sync_state='synced',is_conflict=excluded.is_conflict,deleted_at=NULL,
             trashed_at=excluded.trashed_at,deleted_from_parent_id=excluded.deleted_from_parent_id`
        ).run(note.id, note.title, note.parentId, note.sortOrder, note.updatedAt, note.isConflict ? 1 : 0,
          note.isLocked ? 1 : 0, note.lockedAt ?? null, trashedAt, deletedFrom);
        this.deps.db.prepare(
          `INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,deleted_at,sync_state,is_conflict,icon,trashed_at,deleted_from_parent_id)
           VALUES(?,?,?,'note',?,?,?,?,?,NULL,'synced',?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,title=excluded.title,
             sort_order=excluded.sort_order,updated_at=excluded.updated_at,
             deleted_at=NULL,sync_state='synced',is_conflict=excluded.is_conflict,icon=excluded.icon,
             trashed_at=excluded.trashed_at,deleted_from_parent_id=excluded.deleted_from_parent_id`
        ).run(note.id, this.deps.workspaceId, note.parentId, note.title, note.id, note.sortOrder, note.updatedAt, note.updatedAt, note.isConflict ? 1 : 0, note.icon ?? null, trashedAt, deletedFrom);
      });
      transaction();
      if (previousLakeBackedUp) { try { fs.rmSync(lakeBackup, { force: true }); } catch { /* best effort */ } }
      moved = true;
    } catch (error) {
      // DB 尚未提交时，回滚所有已经落盘的临时/目标文件；保留旧正文备份。
      for (const file of movedAssetPaths) { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
      if (lakePlaced) { try { fs.rmSync(lakePath, { force: true }); } catch { /* best effort */ } }
      if (previousLakeBackedUp && fs.existsSync(lakeBackup)) {
        try { fs.renameSync(lakeBackup, lakePath); } catch { /* best effort */ }
      }
      try { fs.rmSync(lakeTmp, { force: true }); } catch { /* best effort */ }
      if (assetTmpDir) { try { fs.rmSync(assetTmpDir, { recursive: true, force: true }); } catch { /* best effort */ } }
      throw error;
    } finally {
      if (!moved) {
        try { fs.rmSync(lakeTmp, { force: true }); } catch { /* best effort */ }
        if (assetTmpDir) { try { fs.rmSync(assetTmpDir, { recursive: true, force: true }); } catch { /* best effort */ } }
      }
      if (previousLakeBackedUp && fs.existsSync(lakeBackup)) {
        try { fs.rmSync(lakeBackup, { force: true }); } catch { /* best effort */ }
      }
    }

    const text = content.toString("utf8");
    try { this.deps.detectOrphans(note.id, text); }
    catch (error) { console.warn("[store] 导入后孤儿对账失败（不影响导入）:", error); }
    try { this.deps.ensureNoteCaches(note.id, text); }
    catch (error) { console.warn("[store] 导入后缓存生成失败（不影响导入）:", error); }
    this.deps.logImport(note.id, content.length, assets.length, startedAt);
  }
}
