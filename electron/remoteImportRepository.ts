import type { DbLike } from "../src/core/dbLike.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SyncNote } from "../src/core/noteQueries.js";
import { AppError } from "../src/core/storeErrors.js";

interface RemoteAsset {
  filename: string;
  bytes: Buffer;
}

interface RemoteImportDeps {
  db: DbLike;
  workspaceId: string;
  trashNotebookId: string;
  notePathFor(noteId: string): string;
  assetDirFor(noteId: string): string;
  isSafeSegment(value: string): boolean;
  detectOrphans(noteId: string, content: string): void;
  ensureNoteCaches(noteId: string, content: string): boolean;
  logImport(noteId: string, contentBytes: number, assetCount: number, startedAt: number): void;
}

interface FilePlacement {
  destination: string;
  backupPath: string | null;
  placed: boolean;
}

function placeFile(source: string, destination: string, backupDir: string | null): FilePlacement {
  const backupPath = fs.existsSync(destination)
    ? backupDir
      ? path.join(backupDir, path.basename(destination))
      : `${destination}.previous-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
    : null;
  const placement: FilePlacement = { destination, backupPath, placed: false };

  if (backupPath) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.renameSync(destination, backupPath);
  }
  fs.renameSync(source, destination);
  placement.placed = true;
  return placement;
}

function rollbackPlacements(placements: FilePlacement[]): string[] {
  const failures: string[] = [];
  for (let index = placements.length - 1; index >= 0; index -= 1) {
    const placement = placements[index]!;
    try {
      if (placement.backupPath && fs.existsSync(placement.backupPath)) {
        if (fs.existsSync(placement.destination)) fs.rmSync(placement.destination, { force: true });
        fs.renameSync(placement.backupPath, placement.destination);
      } else if (placement.placed) {
        fs.rmSync(placement.destination, { force: true });
      }
    } catch {
      failures.push(placement.backupPath ?? placement.destination);
    }
  }
  return failures;
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
    if (new Set(assets.map((asset) => asset.filename)).size !== assets.length) {
      throw new AppError("InvalidInput", "远端资源文件名重复");
    }

    const assetDir = assets.length > 0 ? this.deps.assetDirFor(note.id) : null;
    const lakeTmp = `${lakePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    const assetTmpDir = assetDir ? `${assetDir}.staging-${crypto.randomBytes(4).toString("hex")}` : null;
    const assetBackupDir = assetDir ? `${assetDir}.backup-${crypto.randomBytes(4).toString("hex")}` : null;
    const placements: FilePlacement[] = [];
    let committed = false;
    try {
      // 先完成文件落盘，再提交 DB。这样 rename 故障不会留下“DB 已 synced、正文文件不存在”的半状态。
      fs.writeFileSync(lakeTmp, content, "utf8");
      if (assetTmpDir) {
        fs.mkdirSync(assetTmpDir, { recursive: true });
        for (const asset of assets) fs.writeFileSync(path.join(assetTmpDir, asset.filename), asset.bytes);
      }

      fs.mkdirSync(path.dirname(lakePath), { recursive: true });
      placements.push(placeFile(lakeTmp, lakePath, null));

      if (assetTmpDir && assetDir) {
        fs.mkdirSync(assetDir, { recursive: true });
        for (const asset of assets) {
          const destination = path.join(assetDir, asset.filename);
          placements.push(placeFile(path.join(assetTmpDir, asset.filename), destination, assetBackupDir));
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
      committed = true;
      for (const placement of placements) {
        if (placement.backupPath) {
          try { fs.rmSync(placement.backupPath, { force: true }); } catch { /* best effort */ }
        }
      }
      if (assetBackupDir) {
        try { fs.rmSync(assetBackupDir, { recursive: true, force: true }); } catch { /* best effort */ }
      }
    } catch (error) {
      // DB 尚未提交时，按落位逆序恢复旧文件；恢复失败的备份必须保留。
      const rollbackFailures = rollbackPlacements(placements);
      if (assetDir) {
        try { if (fs.existsSync(assetDir) && fs.readdirSync(assetDir).length === 0) fs.rmdirSync(assetDir); } catch { /* best effort */ }
      }
      if (rollbackFailures.length > 0) {
        throw new AppError(
          "Internal",
          `远端导入回滚失败，已保留备份: ${rollbackFailures.join(", ")}；原错误: ${(error as Error).message}`,
        );
      }
      throw error;
    } finally {
      try { fs.rmSync(lakeTmp, { force: true }); } catch { /* best effort */ }
      if (assetTmpDir) { try { fs.rmSync(assetTmpDir, { recursive: true, force: true }); } catch { /* best effort */ } }
      if (!committed && assetBackupDir && fs.existsSync(assetBackupDir) && fs.readdirSync(assetBackupDir).length === 0) {
        try { fs.rmdirSync(assetBackupDir); } catch { /* best effort */ }
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
