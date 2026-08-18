import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { ASSET_PORT } from "./assetServer.js";
import { AppError } from "./storeErrors.js";
import { sniffImageFormat } from "./imageUtils.js";
import {
  QUICK_NOTE_VERSION,
  normalizeQuickNoteContent,
  parseQuickNoteContent,
  previewQuickNote,
  serializeQuickNoteContent,
  validateQuickNoteContent,
  QuickNoteModelError,
  type StoredQuickNoteContent,
} from "./quickNoteModel.js";
import type { QuickNoteDeleted, QuickNoteDocument, QuickNoteImage, QuickNoteImageInput, SaveQuickNoteInput } from "./quickNoteTypes.js";
import { QuickNotesQueries, type QuickNoteConversionRow, type QuickNoteDeletedRow, type QuickNoteRow } from "./quickNotesQueries.js";

export { QUICK_NOTE_VERSION, MAX_QUICK_NOTE_TEXT_LENGTH } from "./quickNoteModel.js";
export type { QuickNoteContent, QuickNoteConversion, QuickNoteDeleted, QuickNoteDocument, QuickNoteImage, QuickNoteImageInput, QuickNoteSummary, SaveQuickNoteInput } from "./quickNoteTypes.js";
export type { StoredQuickNoteContent } from "./quickNoteModel.js";

export const MAX_QUICK_NOTE_IMAGE_BYTES = 25 * 1024 * 1024;
/** 小记图片解码后像素上限（与 Lake 图片一致：50MP，防解压炸弹） */
const MAX_QUICK_NOTE_IMAGE_PIXELS = 50_000_000;

function nowIso(): string { return new Date().toISOString(); }
function uuid(): string { return crypto.randomUUID(); }
function hash(bytes: Buffer | string): string { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function toStoreValidation<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (error instanceof QuickNoteModelError) throw new AppError(error.kind, error.message);
    throw error;
  }
}
function isSafeSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\");
}

/**
 * 小记的本地数据空间。它不读取或写入既有 metadata.sqlite3 / notes / note-assets，
 * 唯一跨空间动作由 main.ts 的转换协调器通过 conversion journal 显式编排。
 */
export class QuickNotesStore {
  private db: Database.Database;
  private root: string;
  private itemsDir: string;
  private assetsDir: string;
  private stagingDir: string;
  private queries: QuickNotesQueries;

  constructor(workspaceRoot: string) {
    this.root = path.join(workspaceRoot, "quick-notes");
    this.itemsDir = path.join(this.root, "items");
    this.assetsDir = path.join(this.root, "assets");
    this.stagingDir = path.join(this.root, "staging");
    fs.mkdirSync(this.itemsDir, { recursive: true });
    fs.mkdirSync(this.assetsDir, { recursive: true });
    fs.mkdirSync(this.stagingDir, { recursive: true });
    this.db = new Database(path.join(this.root, "metadata.sqlite3"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
    this.queries = new QuickNotesQueries({
      db: this.db,
      itemPath: (id) => this.itemPath(id),
      imageUrl: (noteId, filename) => this.quickImageUrl(noteId, filename),
    });
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quick_notes (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        preview_text TEXT NOT NULL,
        image_count INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        sync_state TEXT NOT NULL DEFAULT 'local',
        is_conflict INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS quick_note_assets (
        id TEXT PRIMARY KEY,
        quick_note_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        size INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        FOREIGN KEY (quick_note_id) REFERENCES quick_notes(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_quick_note_assets_file ON quick_note_assets(quick_note_id, filename);
      CREATE TABLE IF NOT EXISTS quick_note_sync_base (
        quick_note_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quick_note_deleted (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        conversion_target_note_id TEXT,
        ready_to_sync INTEGER NOT NULL DEFAULT 1,
        purged_at TEXT
      );
      CREATE TABLE IF NOT EXISTS quick_note_conversions (
        source_quick_note_id TEXT PRIMARY KEY,
        target_note_id TEXT NOT NULL,
        target_notebook_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('prepared','target_created','source_deleted_waiting_sync','complete')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const deletedCols = this.db.prepare("PRAGMA table_info(quick_note_deleted)").all() as Array<{ name: string }>;
    if (!deletedCols.some((c) => c.name === "purged_at")) {
      this.db.exec("ALTER TABLE quick_note_deleted ADD COLUMN purged_at TEXT");
    }
    // 恢复标记（墓碑权威的显式例外）：restoreQuickNote 写入，markSynced 清除。
    const quickCols = this.db.prepare("PRAGMA table_info(quick_notes)").all() as Array<{ name: string }>;
    if (!quickCols.some((c) => c.name === "restore_pending_at")) {
      this.db.exec("ALTER TABLE quick_notes ADD COLUMN restore_pending_at TEXT");
    }
  }

  private itemPath(id: string): string {
    if (!isSafeSegment(id)) throw new AppError("InvalidInput", `无效的小记 ID: ${id}`);
    return path.join(this.itemsDir, `${id}.qnote`);
  }

  private assetDirFor(id: string): string {
    if (!isSafeSegment(id)) throw new AppError("InvalidInput", `无效的小记 ID: ${id}`);
    return path.join(this.assetsDir, id);
  }

  private stagingDirFor(draftId: string): string {
    if (!isSafeSegment(draftId)) throw new AppError("InvalidInput", "无效的小记草稿会话");
    return path.join(this.stagingDir, draftId);
  }

  private quickImageUrl(noteId: string, filename: string): string {
    return `http://127.0.0.1:${ASSET_PORT}/quick-notes/${noteId}/${filename}`;
  }

  private stagingImageUrl(draftId: string, filename: string): string {
    return `http://127.0.0.1:${ASSET_PORT}/quick-notes/staging/${draftId}/${filename}`;
  }

  private atomicWrite(filePath: string, bytes: string | Buffer): void {
    const temporary = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, filePath);
  }

  private readStoredContent(id: string): StoredQuickNoteContent {
    return this.queries.readStoredContent(id);
  }

  private validateStoredContent(raw: unknown): StoredQuickNoteContent {
    return toStoreValidation(() => validateQuickNoteContent(raw));
  }

  private mapDocument(row: QuickNoteRow, content: StoredQuickNoteContent): QuickNoteDocument {
    return this.queries.mapDocument(row, content);
  }

  private readRow(id: string): QuickNoteRow {
    return this.queries.readRow(id);
  }

  listQuickNotes(): QuickNoteDocument[] {
    return this.queries.list();
  }

  readQuickNote(id: string): QuickNoteDocument {
    return this.queries.read(id);
  }

  async stageImage(draftId: string, input: QuickNoteImageInput): Promise<QuickNoteImage> {
    if (!input || !Array.isArray(input.bytes)) throw new AppError("InvalidInput", "图片数据无效");
    if (input.bytes.length === 0 || input.bytes.length > MAX_QUICK_NOTE_IMAGE_BYTES) throw new AppError("InvalidInput", "图片为空或超过 25 MiB");
    const bytes = Buffer.from(input.bytes);
    const format = sniffImageFormat(bytes);
    if (!format) throw new AppError("InvalidInput", "仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片");
    const metadata = await sharp(bytes, { animated: true }).metadata().catch(() => null);
    if (metadata?.width && metadata?.height && metadata.width * metadata.height > MAX_QUICK_NOTE_IMAGE_PIXELS) {
      throw new AppError("InvalidInput", `图片尺寸过大（${metadata.width}x${metadata.height}），上限 ${MAX_QUICK_NOTE_IMAGE_PIXELS} 像素`);
    }
    const id = uuid();
    const filename = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${format.extension}`;
    const stagingDir = this.stagingDirFor(draftId);
    fs.mkdirSync(stagingDir, { recursive: true });
    const staged = {
      id, filename, mimeType: format.mimeType, width: metadata?.width ?? null, height: metadata?.height ?? null,
      size: bytes.length, hash: hash(bytes),
    };
    this.atomicWrite(path.join(stagingDir, filename), bytes);
    this.atomicWrite(path.join(stagingDir, `.${id}.json`), JSON.stringify(staged));
    return { ...staged, url: this.stagingImageUrl(draftId, filename) };
  }

  discardDraft(draftId: string): void {
    fs.rmSync(this.stagingDirFor(draftId), { force: true, recursive: true });
  }

  createQuickNote(input: SaveQuickNoteInput): QuickNoteDocument {
    const id = uuid();
    const createdAt = nowIso();
    return this.saveQuickNoteInternal(id, input, createdAt, createdAt, false);
  }

  updateQuickNote(id: string, input: SaveQuickNoteInput): QuickNoteDocument {
    const previous = this.readRow(id);
    return this.saveQuickNoteInternal(id, input, previous.created_at, nowIso(), true);
  }

  private saveQuickNoteInternal(id: string, input: SaveQuickNoteInput, createdAt: string, updatedAt: string, updating: boolean): QuickNoteDocument {
    if (!input || typeof input.text !== "string" || typeof input.draftId !== "string" || !Array.isArray(input.stagedImageIds)) {
      throw new AppError("InvalidInput", "小记保存参数无效");
    }
    if (new Set(input.stagedImageIds).size !== input.stagedImageIds.length) throw new AppError("InvalidInput", "图片列表包含重复项");
    const oldContent = updating ? this.readStoredContent(id) : null;
    const existing = oldContent?.images ?? [];
    const retainedIds = input.retainedImageIds ?? existing.map((image) => image.id);
    if (new Set(retainedIds).size !== retainedIds.length) throw new AppError("InvalidInput", "保留图片列表包含重复项");
    const existingById = new Map(existing.map((image) => [image.id, image]));
    const retained = retainedIds.map((assetId) => {
      const image = existingById.get(assetId);
      if (!image) throw new AppError("InvalidInput", "保留图片不属于当前小记");
      return image;
    });

    const stagingDir = this.stagingDirFor(input.draftId);
    const stagedMetadata = this.readStagedMetadata(stagingDir, input.stagedImageIds);
    const content = toStoreValidation(() => normalizeQuickNoteContent(input.text, [...retained, ...stagedMetadata]));
    const encoded = Buffer.from(serializeQuickNoteContent(content), "utf8");
    const contentHash = hash(encoded);
    const targetAssets = this.assetDirFor(id);
    const removed = existing.filter((image) => !retainedIds.includes(image.id));

    // 目标资源先复制/移动并写入临时内容，随后单 DB 事务更新索引；失败时保留源 staging，用户可重试。
    fs.mkdirSync(targetAssets, { recursive: true });
    const movedFiles: string[] = [];
    try {
      for (const image of stagedMetadata) {
        const source = path.join(stagingDir, image.filename);
        const destination = path.join(targetAssets, image.filename);
        if (!fs.existsSync(source)) throw new AppError("NotFound", `暂存图片不存在: ${image.filename}`);
        if (fs.existsSync(destination)) throw new AppError("InvalidInput", `图片文件名冲突: ${image.filename}`);
        fs.renameSync(source, destination);
        movedFiles.push(destination);
      }
      this.atomicWrite(this.itemPath(id), encoded);
      const tx = this.db.transaction(() => {
        if (updating) {
          this.db.prepare("UPDATE quick_notes SET updated_at=?,preview_text=?,image_count=?,content_hash=?,sync_state='local',is_conflict=0 WHERE id=?")
            .run(updatedAt, previewQuickNote(content.text, content.images.length), content.images.length, contentHash, id);
          this.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(id);
        } else {
          this.db.prepare("INSERT INTO quick_notes(id,created_at,updated_at,preview_text,image_count,content_hash,sync_state,is_conflict) VALUES(?,?,?,?,?,?, 'local', 0)")
            .run(id, createdAt, updatedAt, previewQuickNote(content.text, content.images.length), content.images.length, contentHash);
        }
        const insert = this.db.prepare("INSERT INTO quick_note_assets(id,quick_note_id,filename,mime_type,width,height,size,content_hash) VALUES(?,?,?,?,?,?,?,?)");
        for (const image of content.images) insert.run(image.id, id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash);
      });
      tx();
      for (const image of removed) {
        try { fs.rmSync(path.join(targetAssets, image.filename), { force: true }); } catch { /* 后续手工清理，不影响已保存内容 */ }
      }
      // 保存完成后，已选资源均已移动到目标目录；其余暂存内容属于放弃的草稿，必须一并清除。
      try { fs.rmSync(stagingDir, { force: true, recursive: true }); } catch { /* optional */ }
    } catch (error) {
      for (const destination of movedFiles) {
        try {
          const source = path.join(stagingDir, path.basename(destination));
          if (!fs.existsSync(source)) fs.renameSync(destination, source);
        } catch { /* best effort */ }
      }
      throw error;
    }
    return this.readQuickNote(id);
  }

  private readStagedMetadata(stagingDir: string, imageIds: string[]): Omit<QuickNoteImage, "url">[] {
    // stagedImageIds encode no filename; renderer sends prior IPC return only. Persist a small sidecar would add state.
    // To keep the API unforgeable, each stage writes a hidden metadata file alongside the image.
    return imageIds.map((assetId) => {
      if (!isSafeSegment(assetId)) throw new AppError("InvalidInput", "无效的暂存图片 ID");
      const metaPath = path.join(stagingDir, `.${assetId}.json`);
      let raw: unknown;
      try { raw = parseQuickNoteContent(fs.readFileSync(metaPath, "utf8")); } catch { throw new AppError("NotFound", "暂存图片已失效，请重新添加"); }
      const image = this.validateStoredContent({ version: QUICK_NOTE_VERSION, text: "x", images: [raw] }).images[0];
      const imagePath = path.join(stagingDir, image.filename);
      if (!fs.existsSync(imagePath)) throw new AppError("NotFound", "暂存图片文件不存在");
      const bytes = fs.readFileSync(imagePath);
      if (bytes.length !== image.size || hash(bytes) !== image.hash) throw new AppError("InvalidInput", "暂存图片校验失败");
      return image;
    });
  }

  /** 删除单张未保存暂存图片。 */
  discardStagedImage(draftId: string, assetId: string): void {
    if (!isSafeSegment(assetId)) return;
    const dir = this.stagingDirFor(draftId);
    const metaPath = path.join(dir, `.${assetId}.json`);
    try {
      const raw = parseQuickNoteContent(fs.readFileSync(metaPath, "utf8"));
      const image = this.validateStoredContent({ version: QUICK_NOTE_VERSION, text: "x", images: [raw] }).images[0];
      fs.rmSync(path.join(dir, image.filename), { force: true });
    } catch { /* metadata/file may already be gone */ }
    fs.rmSync(metaPath, { force: true });
  }

  deleteQuickNote(id: string): void {
    const row = this.readRow(id);
    this.deleteSourceAndRemember(row, null, true, true);
  }

  /** 小记回收站只读查询。 */
  listQuickNoteTrash(): Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string }> {
    return this.queries.listTrash();
  }

  /** M6 小记回收站恢复：从保留的本地内容文件读回，清墓碑并置 local 待上传。 */
  restoreQuickNote(id: string): QuickNoteDocument {
    if (!isSafeSegment(id)) throw new AppError("InvalidInput", "无效的小记 ID");
    const tomb = this.db.prepare(
      "SELECT * FROM quick_note_deleted WHERE id=? AND conversion_target_note_id IS NULL AND purged_at IS NULL"
    ).get(id) as QuickNoteDeletedRow | undefined;
    if (!tomb) throw new AppError("NotFound", "小记不在回收站");
    const itemPath = this.itemPath(id);
    if (!fs.existsSync(itemPath)) throw new AppError("NotFound", "小记内容文件已丢失，无法恢复");
    const content = this.validateStoredContent(JSON.parse(fs.readFileSync(itemPath, "utf8")));
    const encoded = Buffer.from(`${JSON.stringify(content, null, 2)}
`, "utf8");
    const contentHash = hash(encoded);
    const tx = this.db.transaction(() => {
      this.db.prepare("INSERT OR REPLACE INTO quick_notes(id,created_at,updated_at,preview_text,image_count,content_hash,sync_state,is_conflict,restore_pending_at) VALUES(?,?,?,?,?,?, 'local', 0, ?)")
        .run(id, tomb.created_at, nowIso(), previewQuickNote(content.text, content.images.length), content.images.length, contentHash, nowIso());
      this.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(id);
      const insert = this.db.prepare("INSERT INTO quick_note_assets(id,quick_note_id,filename,mime_type,width,height,size,content_hash) VALUES(?,?,?,?,?,?,?,?)");
      for (const image of content.images) insert.run(image.id, id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash);
      this.db.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
    });
    tx();
    return this.readQuickNote(id);
  }

  /**
   * 撤销本地删除（sync 下载分支在"远端恢复较新"时调用）：移除普通删除墓碑。
   * 小记软删保留内容文件；恢复以远端为准（随后走下载/对账并 markSynced）。
   * 转换墓碑（conversion_target_note_id 非空）与已 purge 的不在此列。
   */
  revokeLocalDeletion(id: string): void {
    if (!isSafeSegment(id)) throw new AppError("InvalidInput", "无效的小记 ID");
    this.db.prepare(
      "DELETE FROM quick_note_deleted WHERE id=? AND conversion_target_note_id IS NULL AND purged_at IS NULL"
    ).run(id);
  }

  /** M6 小记彻底删除：删除保留的本地文件并标记 purged_at（tombstone 保留供同步传播删除）。 */
  purgeQuickNote(id: string): void {
    if (!isSafeSegment(id)) throw new AppError("InvalidInput", "无效的小记 ID");
    const tomb = this.db.prepare("SELECT * FROM quick_note_deleted WHERE id=?").get(id) as QuickNoteDeletedRow | undefined;
    if (!tomb) throw new AppError("NotFound", "小记不在回收站");
    this.db.prepare("UPDATE quick_note_deleted SET purged_at=?,ready_to_sync=1 WHERE id=?").run(nowIso(), id);
    try { fs.rmSync(this.itemPath(id), { force: true }); } catch { /* best effort */ }
    try { fs.rmSync(this.assetDirFor(id), { force: true, recursive: true }); } catch { /* best effort */ }
  }

  private deleteSourceAndRemember(row: any, conversionTargetNoteId: string | null, readyToSync: boolean, keepFiles: boolean): void {
    const content = this.readStoredContent(row.id);
    const deletedAt = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare("INSERT OR REPLACE INTO quick_note_deleted(id,created_at,updated_at,deleted_at,conversion_target_note_id,ready_to_sync) VALUES(?,?,?,?,?,?)")
        .run(row.id, row.created_at, row.updated_at, deletedAt, conversionTargetNoteId, readyToSync ? 1 : 0);
      this.db.prepare("DELETE FROM quick_note_sync_base WHERE quick_note_id=?").run(row.id);
      this.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(row.id);
      this.db.prepare("DELETE FROM quick_notes WHERE id=?").run(row.id);
    });
    tx();
    if (!keepFiles) {
      try { fs.rmSync(this.itemPath(row.id), { force: true }); } catch { /* tombstone remains authoritative */ }
      try { fs.rmSync(this.assetDirFor(row.id), { force: true, recursive: true }); } catch { /* tombstone remains authoritative */ }
    }
    // keep a reference so TypeScript and reviewers see content has been intentionally loaded before source removal.
    void content;
  }

  beginConversion(sourceQuickNoteId: string, targetNoteId: string, targetNotebookId: string): QuickNoteDocument {
    if (!isSafeSegment(targetNoteId) || !isSafeSegment(targetNotebookId)) throw new AppError("InvalidInput", "转换目标无效");
    const source = this.readQuickNote(sourceQuickNoteId);
    const now = nowIso();
    this.db.prepare("INSERT OR REPLACE INTO quick_note_conversions(source_quick_note_id,target_note_id,target_notebook_id,state,created_at,updated_at) VALUES(?,?,?,?,COALESCE((SELECT created_at FROM quick_note_conversions WHERE source_quick_note_id=?),?),?)")
      .run(sourceQuickNoteId, targetNoteId, targetNotebookId, "prepared", sourceQuickNoteId, now, now);
    return source;
  }

  markConversionTargetCreated(sourceQuickNoteId: string): void {
    const changed = this.db.prepare("UPDATE quick_note_conversions SET state='target_created',updated_at=? WHERE source_quick_note_id=? AND state='prepared'")
      .run(nowIso(), sourceQuickNoteId).changes;
    if (!changed) throw new AppError("Internal", "小记转换状态异常");
  }

  finalizeConversion(sourceQuickNoteId: string): void {
    const conversion = this.db.prepare("SELECT * FROM quick_note_conversions WHERE source_quick_note_id=?").get(sourceQuickNoteId) as QuickNoteConversionRow | undefined;
    if (!conversion) throw new AppError("NotFound", "小记转换记录不存在");
    if (conversion.state === "complete" || conversion.state === "source_deleted_waiting_sync") return;
    if (conversion.state !== "target_created") throw new AppError("Internal", "转换目标尚未验证");
    const source = this.readRow(sourceQuickNoteId);
    this.deleteSourceAndRemember(source, conversion.target_note_id, false, false);
    this.db.prepare("UPDATE quick_note_conversions SET state='source_deleted_waiting_sync',updated_at=? WHERE source_quick_note_id=?")
      .run(nowIso(), sourceQuickNoteId);
  }

  recoverConversions(noteExists: (noteId: string) => boolean, cleanupUntrackedTarget: (noteId: string) => void): void {
    const rows = this.db.prepare("SELECT * FROM quick_note_conversions WHERE state IN ('prepared','target_created')").all() as QuickNoteConversionRow[];
    for (const row of rows) {
      if (noteExists(row.target_note_id)) {
        if (row.state === "prepared") {
          this.db.prepare("UPDATE quick_note_conversions SET state='target_created',updated_at=? WHERE source_quick_note_id=?").run(nowIso(), row.source_quick_note_id);
        }
        try { this.finalizeConversion(row.source_quick_note_id); }
        catch (error) { console.warn("[quick-notes] 转换恢复未完成:", error); }
      } else if (row.state === "prepared") {
        cleanupUntrackedTarget(row.target_note_id);
        this.db.prepare("DELETE FROM quick_note_conversions WHERE source_quick_note_id=?").run(row.source_quick_note_id);
      }
    }
  }

  markTargetNotesSynced(noteIds?: Set<string>): void {
    const conversions = this.db.prepare("SELECT * FROM quick_note_conversions WHERE state='source_deleted_waiting_sync'").all() as QuickNoteConversionRow[];
    const tx = this.db.transaction(() => {
      for (const conversion of conversions) {
        if (noteIds && !noteIds.has(conversion.target_note_id)) continue;
        this.db.prepare("UPDATE quick_note_deleted SET ready_to_sync=1 WHERE id=? AND conversion_target_note_id=?")
          .run(conversion.source_quick_note_id, conversion.target_note_id);
        this.db.prepare("UPDATE quick_note_conversions SET state='complete',updated_at=? WHERE source_quick_note_id=?")
          .run(nowIso(), conversion.source_quick_note_id);
      }
    });
    tx();
  }

  // ===== Quick Note S3 sync adapter =====
  listQuickNotesForSync(): QuickNoteDocument[] { return this.listQuickNotes(); }
  quickNotePathFor(id: string): string { return this.itemPath(id); }
  quickNoteAssetsPathFor(id: string): string { return this.assetDirFor(id); }
  baseHash(id: string): string | null {
    const row = this.db.prepare("SELECT content_hash FROM quick_note_sync_base WHERE quick_note_id=?").get(id) as { content_hash: string } | undefined;
    return row?.content_hash ?? null;
  }
  setBaseHash(id: string, contentHash: string): void {
    this.db.prepare("INSERT INTO quick_note_sync_base(quick_note_id,content_hash) VALUES(?,?) ON CONFLICT(quick_note_id) DO UPDATE SET content_hash=excluded.content_hash").run(id, contentHash);
  }
  markSynced(id: string): void {
    // restore_pending_at 一并清除：恢复已生效后残留标记会让本设备永远 local-wins（墓碑永胜被破坏）。
    this.db.prepare("UPDATE quick_notes SET sync_state='synced', restore_pending_at=NULL WHERE id=?").run(id);
  }

  /** 是否处于"小记回收站恢复后待同步"状态（显式恢复标记）。 */
  isRestorePending(id: string): boolean {
    return this.queries.isRestorePending(id);
  }
  markLocal(id: string): void { this.db.prepare("UPDATE quick_notes SET sync_state='local' WHERE id=?").run(id); }
  listDeletedForSync(): QuickNoteDeleted[] {
    return this.queries.listDeletedForSync();
  }

  /** 已删除、但尚不能同步出去的转换 tombstone。 */
  listDeferredDeletedForSync(): QuickNoteDeleted[] {
    return this.queries.listDeferredDeletedForSync();
  }

  hasDeleted(id: string): boolean { return this.queries.hasDeleted(id); }
  deletedRecord(id: string): QuickNoteDeleted | null { return this.queries.deletedRecord(id); }
  rememberDeleted(item: { id: string; createdAt: string; updatedAt: string; deletedAt: string }): void {
    if (!isSafeSegment(item.id)) throw new AppError("InvalidInput", "无效的小记删除记录");
    this.db.prepare("INSERT OR IGNORE INTO quick_note_deleted(id,created_at,updated_at,deleted_at,conversion_target_note_id,ready_to_sync) VALUES(?,?,?,?,NULL,1)")
      .run(item.id, item.createdAt, item.updatedAt, item.deletedAt);
  }

  importRemoteQuickNote(item: { id: string; createdAt: string; updatedAt: string; contentHash: string; isConflict: boolean }, contentBytes: Buffer, assets: { filename: string; bytes: Buffer }[]): void {
    if (!isSafeSegment(item.id)) throw new AppError("InvalidInput", "远端小记 ID 无效");
    if (hash(contentBytes) !== item.contentHash) throw new AppError("InvalidInput", "远端小记内容哈希不符");
    const parsed = this.validateStoredContent(parseQuickNoteContent(contentBytes.toString("utf8")));
    for (const image of parsed.images) {
      const asset = assets.find((candidate) => candidate.filename === image.filename);
      if (!asset || asset.bytes.length !== image.size || hash(asset.bytes) !== image.hash) throw new AppError("InvalidInput", `远端图片不完整: ${image.filename}`);
    }
    // 任何文件系统写入前完成路径校验，避免恶意 manifest 留下空目录或临时垃圾。
    for (const asset of assets) {
      if (!isSafeSegment(asset.filename)) throw new AppError("InvalidInput", "远端图片文件名无效");
    }
    const assetDir = this.assetDirFor(item.id);
    const itemPath = this.itemPath(item.id);
    fs.mkdirSync(assetDir, { recursive: true });
    const temporary = `${assetDir}.incoming-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
    fs.mkdirSync(temporary, { recursive: true });
    try {
      for (const asset of assets) {
        this.atomicWrite(path.join(temporary, asset.filename), asset.bytes);
      }
      this.atomicWrite(itemPath, contentBytes);
      const tx = this.db.transaction(() => {
        this.db.prepare("INSERT INTO quick_notes(id,created_at,updated_at,preview_text,image_count,content_hash,sync_state,is_conflict) VALUES(?,?,?,?,?,?, 'synced', ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,updated_at=excluded.updated_at,preview_text=excluded.preview_text,image_count=excluded.image_count,content_hash=excluded.content_hash,sync_state='synced',is_conflict=excluded.is_conflict")
          .run(item.id, item.createdAt, item.updatedAt, previewQuickNote(parsed.text, parsed.images.length), parsed.images.length, item.contentHash, item.isConflict ? 1 : 0);
        this.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(item.id);
        const insert = this.db.prepare("INSERT INTO quick_note_assets(id,quick_note_id,filename,mime_type,width,height,size,content_hash) VALUES(?,?,?,?,?,?,?,?)");
        for (const image of parsed.images) insert.run(image.id, item.id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash);
      });
      tx();
      fs.rmSync(assetDir, { force: true, recursive: true });
      fs.renameSync(temporary, assetDir);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true, recursive: true }); } catch { /* best effort */ }
      throw error;
    }
  }

  /** 冲突归档（验收 #4 定稿：B 方案——远端覆盖本地，本地版本进小记回收站，恢复后作为一条新小记）。
   * 把本地小记复制为一条「新 id」的回收站条目：内容文件 + 资源文件保留，写墓碑（ready_to_sync=0，
   * 纯本地归档，不向云端发布删除记录——其他端从未持有该 id，避免幽灵回收站条目）；
   * 恢复 = restoreQuickNote(newId) → 一条全新小记。返回新 id。
   * 调用方（sync 下载冲突分支）随后用远端内容覆盖原条目。 */
  archiveLocalToTrash(id: string): string {
    if (!isSafeSegment(id)) throw new AppError("InvalidInput", "无效的小记 ID");
    const row = this.readRow(id);
    const newId = uuid();
    const now = nowIso();
    // 内容复制到新 id：图片 id 重映射为新 uuid（原条目在冲突覆盖后仍持有相同 image id，
    // 直接复用会在恢复/同步时撞 quick_note_assets.id 全局 UNIQUE；图片字节不变）。
    const content = this.readStoredContent(id);
    let body: Buffer;
    if (content.images.length > 0) {
      const remap = new Map(content.images.map((image) => [image.id, uuid()] as const));
      const rewritten = { ...content, images: content.images.map((image) => ({ ...image, id: remap.get(image.id)! })) };
      body = Buffer.from(`${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
    } else {
      body = fs.readFileSync(this.itemPath(id));
    }
    fs.writeFileSync(this.itemPath(newId), body);
    const srcAssets = this.assetDirFor(id);
    const dstAssets = this.assetDirFor(newId);
    if (fs.existsSync(srcAssets)) {
      fs.mkdirSync(dstAssets, { recursive: true });
      for (const filename of fs.readdirSync(srcAssets)) {
        const src = path.join(srcAssets, filename);
        if (!fs.statSync(src).isFile()) continue;
        fs.copyFileSync(src, path.join(dstAssets, filename));
      }
    }
    this.db.prepare("INSERT OR REPLACE INTO quick_note_deleted(id,created_at,updated_at,deleted_at,conversion_target_note_id,ready_to_sync) VALUES(?,?,?,?,NULL,0)")
      .run(newId, row.created_at, row.updated_at, now);
    return newId;
  }
}
