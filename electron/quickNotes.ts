import Database from "better-sqlite3";
import { isSafePathSegment as isSafeSegment } from "../src/core/storeUtils.js";
import { createSilentLoggerScopes, type LoggerScopes } from "../src/core/logger.js";
import type { DbLike } from "./dbLike.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { ASSET_PORT } from "./assetServer.js";
import { localAssetHttpUrl } from "../src/core/assetUrl.js";
import { AppError } from "../src/core/storeErrors.js";
import {
  QUICK_NOTE_VERSION,
  normalizeQuickNoteContent,
  parseQuickNoteContent,
  previewQuickNote,
  serializeQuickNoteContent,
  validateQuickNoteContent,
  validateQuickNoteImageBytes,
  validateQuickNoteImageDimensions,
  QuickNoteModelError,
  type StoredQuickNoteContent,
} from "./quickNoteModel.js";
import type { QuickNoteDeleted, QuickNoteDocument, QuickNoteImage, QuickNoteImageInput, SaveQuickNoteInput } from "./quickNoteTypes.js";
import { QuickNotesQueries, type QuickNoteConversionRow, type QuickNoteDeletedRow, type QuickNoteRow } from "./quickNotesQueries.js";

export { QUICK_NOTE_VERSION, MAX_QUICK_NOTE_TEXT_LENGTH } from "./quickNoteModel.js";
export type { QuickNoteContent, QuickNoteConversion, QuickNoteDeleted, QuickNoteDocument, QuickNoteImage, QuickNoteImageInput, QuickNoteSummary, SaveQuickNoteInput } from "./quickNoteTypes.js";
export type { StoredQuickNoteContent } from "./quickNoteModel.js";

export { MAX_IMAGE_BYTES as MAX_QUICK_NOTE_IMAGE_BYTES } from "../src/core/storeLimits.js";
/** V5 §5.3：save 轻量 staging 文件约定（staging/{draftId}/ 内） */
const SAVE_BODY_FILE = "content.qnote";
const SAVE_META_FILE = "meta.json";

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

/**
 * 小记的本地数据空间。它不读取或写入既有 metadata.sqlite3 / notes / note-assets，
 * 唯一跨空间动作由 main.ts 的转换协调器通过 conversion journal 显式编排。
 */
export class QuickNotesStore {
  private db: DbLike;
  private root: string;
  private itemsDir: string;
  private assetsDir: string;
  private stagingDir: string;
  private queries: QuickNotesQueries;
  /** V5 Phase 2：日志注入点（桌面默认 = electron-log，由 main.ts 装配；quickNotesSync 经此读取） */
  readonly logScopes: LoggerScopes;

  constructor(workspaceRoot: string, logScopes: LoggerScopes = createSilentLoggerScopes()) {
    this.logScopes = logScopes;
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
    this.recoverStagedSaves();
    this.recoverImports();
    this.queries = new QuickNotesQueries({
      db: this.db,
      itemPath: (id) => this.itemPath(id),
      imageUrl: (noteId, filename) => this.quickImageUrl(noteId, filename),
    });
  }

  /** A1 一致性 DB 快照：VACUUM INTO 单文件（无 WAL 依赖、可独立打开）。目标必须不存在。 */
  backupDatabaseTo(targetPath: string): void {
    const escaped = targetPath.replace(/'/g, "''");
    this.db.exec(`VACUUM INTO '${escaped}'`);
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
      CREATE TABLE IF NOT EXISTS quick_note_file_ops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_type TEXT NOT NULL,
        quick_note_id TEXT NOT NULL,
        old_content_path TEXT,
        new_content_path TEXT,
        old_assets_path TEXT,
        new_assets_path TEXT,
        staging_key TEXT,
        content_hash TEXT,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_message TEXT
      );
    `);
    const deletedCols = this.db.prepare("PRAGMA table_info(quick_note_deleted)").all() as Array<{ name: string }>;
    if (!deletedCols.some((c) => c.name === "purged_at")) {
      this.db.exec("ALTER TABLE quick_note_deleted ADD COLUMN purged_at TEXT");
    }
    // 墓碑发布记账（对齐 Lake deleted_notes.published_at）：发布到 manifest 后写入，
    // 只表示"本机墓碑已上云"，记录本身保留供下载方向 LWW（墓碑 vs 远端恢复）判定。
    if (!deletedCols.some((c) => c.name === "published_at")) {
      this.db.exec("ALTER TABLE quick_note_deleted ADD COLUMN published_at TEXT");
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
    return localAssetHttpUrl(noteId, filename, { port: ASSET_PORT, space: "quick-notes" });
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

  private readRow(id: string): QuickNoteRow {
    return this.queries.readRow(id);
  }

  listQuickNotes(): QuickNoteDocument[] {
    return this.queries.list();
  }

  /** 关于页概览用：小记条数（独立库；小记无软删列，删除走 quick_note_deleted）。 */
  countQuickNotes(): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM quick_notes").get() as { c: number }).c;
  }

  readQuickNote(id: string): QuickNoteDocument {
    return this.queries.read(id);
  }

  async stageImage(draftId: string, input: QuickNoteImageInput): Promise<QuickNoteImage> {
    if (!input || !Array.isArray(input.bytes)) throw new AppError("InvalidInput", "图片数据无效");
    const bytes = Buffer.from(input.bytes);
    const format = toStoreValidation(() => validateQuickNoteImageBytes(bytes));
    const metadata = await sharp(bytes, { animated: true }).metadata().catch(() => null);
    if (!metadata?.width || !metadata?.height) throw new AppError("InvalidInput", "图片尺寸读取失败");
    toStoreValidation(() => validateQuickNoteImageDimensions({ width: metadata.width, height: metadata.height }));
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

    // V5 §5.3：staging 全量组装 → DB 事务提交 → promote（文件绝不先于 DB 落正式路径；
    // DB 失败时正式路径保持旧内容 + 旧索引一致，staging 残留由启动恢复清理）。
    // 组装前确保 staging 目录存在（无图片保存时 draft 目录可能不存在）
    fs.mkdirSync(stagingDir, { recursive: true });
    const stagedBodyPath = path.join(stagingDir, SAVE_BODY_FILE);
    this.atomicWrite(stagedBodyPath, encoded);
    const assetFilenames = stagedMetadata.map((image) => image.filename);
    this.atomicWrite(path.join(stagingDir, SAVE_META_FILE), JSON.stringify({
      operationId: input.draftId, quickNoteId: id, contentHash,
      assetFilenames, createdAt, state: "prepared",
    }));
    // DB 事务（只更新索引，不碰正式路径）
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
    // DB 已提交 → promote（正文 rename 原子；图片逐个 rename）
    this.promoteStagedSave(stagingDir, id, contentHash, assetFilenames);
    // promote 成功后清理：removed 旧图 + staging 全部（崩溃在清理前 → 孤儿残留无害，下次可清）
    for (const image of removed) {
      try { fs.rmSync(path.join(targetAssets, image.filename), { force: true }); } catch { /* 后续手工清理 */ }
    }
    try { fs.rmSync(stagingDir, { force: true, recursive: true }); } catch { /* optional */ }
    return this.readQuickNote(id);
  }

  /** V5 §5.3：把 staging 组装好的内容 promote 到正式路径（DB 已提交后调用，幂等）。
   * 图片先全部 promote，正文最后 rename：正文存在即代表本次文件集已完整落地，
   * 崩溃恢复时源/目标任一存在就跳过，缺失则保留 staging 待人工处理。 */
  private promoteStagedSave(stagingDir: string, id: string, _contentHash: string, assetFilenames: string[]): void {
    const assetDir = this.assetDirFor(id);
    fs.mkdirSync(assetDir, { recursive: true });
    for (const filename of assetFilenames) {
      const src = path.join(stagingDir, filename);
      const dst = path.join(assetDir, filename);
      if (fs.existsSync(src)) fs.renameSync(src, dst);
      else if (!fs.existsSync(dst)) throw new AppError("Internal", `staging 缺少图片文件: ${id}/${filename}`);
    }
    const bodySrc = path.join(stagingDir, SAVE_BODY_FILE);
    const bodyDst = this.itemPath(id);
    if (fs.existsSync(bodySrc)) fs.renameSync(bodySrc, bodyDst);
    else if (!fs.existsSync(bodyDst)) {
      throw new AppError("Internal", `staging 缺少正文文件: ${stagingDir}`);
    }
  }

  /** V5 §5.3 启动恢复：扫描 staging 残留，按 DB content_hash 判定（先提交为确定 → 只补做不撤销）。
   * DB == staging contentHash → 已提交 → 补 promote；否则未提交 → 删 staging；meta 损坏 → 保留待查。 */
  private recoverStagedSaves(): void {
    if (!fs.existsSync(this.stagingDir)) return;
    for (const entry of fs.readdirSync(this.stagingDir)) {
      const dir = path.join(this.stagingDir, entry);
      if (!fs.statSync(dir).isDirectory()) continue;
      const metaPath = path.join(dir, SAVE_META_FILE);
      if (!fs.existsSync(metaPath)) continue; // 无 meta：遗留 draft 或未知，保留（无法判断）
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { quickNoteId: string; contentHash: string; assetFilenames?: string[]; state?: string };
        const row = this.db.prepare("SELECT content_hash FROM quick_notes WHERE id=?").get(meta.quickNoteId) as { content_hash: string } | undefined;
        if (row && row.content_hash === meta.contentHash) {
          try {
            this.promoteStagedSave(dir, meta.quickNoteId, meta.contentHash, meta.assetFilenames ?? []);
            fs.rmSync(dir, { force: true, recursive: true });
            console.info(`[quick][recover] save promote 完成: ${meta.quickNoteId}`);
          } catch (error) {
            console.warn(`[quick][recover] save promote 失败（保留 staging 待查）: ${meta.quickNoteId} ${String(error)}`);
          }
        } else {
          fs.rmSync(dir, { force: true, recursive: true });
          console.info(`[quick][recover] save 未提交，清理 staging: ${meta.quickNoteId ?? entry}`);
        }
      } catch (error) {
        console.warn(`[quick][recover] staging meta 损坏，保留待查: ${dir} ${String(error)}`);
      }
    }
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
    // 幂等删除：小记已不存在时静默返回，不再抛 NotFound。UI「乐观删除 + 5 秒撤销窗口」内，
    // 若同步先应用了远端删除（或本端已被其它路径删除），窗口到期提交时不应误报"删除失败"并把卡片塞回列表。
    let row: QuickNoteRow;
    try {
      row = this.readRow(id);
    } catch (reason) {
      if (reason instanceof AppError && reason.kind === "NotFound") return;
      throw reason;
    }
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

  private deleteSourceAndRemember(row: QuickNoteRow, conversionTargetNoteId: string | null, readyToSync: boolean, keepFiles: boolean): void {
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
  getPendingSyncSummary(): { items: number; resources: number } {
    const row = this.db.prepare("SELECT COUNT(*) AS items, COALESCE(SUM(image_count), 0) AS resources FROM quick_notes WHERE sync_state != 'synced'").get() as { items: number; resources: number };
    // 墓碑计数只算"可发布"的（ready=1 且未发布）；已发布（published_at 非空）不再计入待同步
    const deleted = this.db.prepare("SELECT COUNT(*) AS items FROM quick_note_deleted WHERE ready_to_sync=1 AND published_at IS NULL").get() as { items: number };
    return { items: row.items + deleted.items, resources: row.resources };
  }
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

  /** 墓碑已发布到 manifest → 清除待同步标记。 */
  markDeletedPublished(ids: string[]): void {
    this.queries.markDeletedPublished(ids);
  }

  /** 全部墓碑记录（含已发布）：下载方向 LWW 判定用。 */
  listAllDeleted(): QuickNoteDeleted[] {
    return this.queries.listAllDeleted();
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

  /** 远端小记导入（V5 §5.4：4 态 journal 驱动） */
  importRemoteQuickNote(item: { id: string; createdAt: string; updatedAt: string; contentHash: string; isConflict: boolean }, contentBytes: Buffer, assets: { filename: string; bytes: Buffer }[]): void {
    if (!isSafeSegment(item.id)) throw new AppError("InvalidInput", "远端小记 ID 无效");
    if (hash(contentBytes) !== item.contentHash) throw new AppError("InvalidInput", "远端小记内容哈希不符");
    const parsed = this.validateStoredContent(parseQuickNoteContent(contentBytes.toString("utf8")));
    for (const image of parsed.images) {
      const asset = assets.find((candidate) => candidate.filename === image.filename);
      if (!asset || asset.bytes.length !== image.size || hash(asset.bytes) !== image.hash) throw new AppError("InvalidInput", `远端图片不完整: ${image.filename}`);
    }
    for (const asset of assets) {
      if (!isSafeSegment(asset.filename)) throw new AppError("InvalidInput", "远端图片文件名无效");
    }
    const assetDir = this.assetDirFor(item.id);
    const itemPath = this.itemPath(item.id);
    const opId = uuid();
    const stagingKey = `import-${opId}`;
    const temporary = path.join(this.stagingDir, stagingKey);
    const oldAssetsBackup = `${assetDir}.bak-${opId}`;
    fs.mkdirSync(temporary, { recursive: true });
    for (const asset of assets) {
      this.atomicWrite(path.join(temporary, asset.filename), asset.bytes);
    }
    this.atomicWrite(path.join(temporary, SAVE_BODY_FILE), contentBytes);
    const now = nowIso();
    const journalId = Number(this.db.prepare(
      "INSERT INTO quick_note_file_ops(operation_type,quick_note_id,old_content_path,new_content_path,old_assets_path,new_assets_path,staging_key,content_hash,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ).run("import_remote", item.id, itemPath, path.join(temporary, SAVE_BODY_FILE), oldAssetsBackup, assetDir, stagingKey, item.contentHash, "prepared", now, now).lastInsertRowid);
    try {
      const tx = this.db.transaction(() => {
        this.db.prepare("INSERT INTO quick_notes(id,created_at,updated_at,preview_text,image_count,content_hash,sync_state,is_conflict) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,updated_at=excluded.updated_at,preview_text=excluded.preview_text,image_count=excluded.image_count,content_hash=excluded.content_hash,sync_state='synced',is_conflict=excluded.is_conflict")
          .run(item.id, item.createdAt, item.updatedAt, previewQuickNote(parsed.text, parsed.images.length), parsed.images.length, item.contentHash, "synced", item.isConflict ? 1 : 0);
        this.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(item.id);
        const insert = this.db.prepare("INSERT INTO quick_note_assets(id,quick_note_id,filename,mime_type,width,height,size,content_hash) VALUES(?,?,?,?,?,?,?,?)");
        for (const image of parsed.images) insert.run(image.id, item.id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash);
        this.db.prepare("UPDATE quick_note_file_ops SET state=?, updated_at=? WHERE id=?").run("db_committed", now, journalId);
      });
      tx();
    } catch (error) {
      this.db.prepare("DELETE FROM quick_note_file_ops WHERE id=?").run(journalId);
      try { fs.rmSync(temporary, { force: true, recursive: true }); } catch { /* best effort */ }
      throw error;
    }
    this.promoteImport(temporary, itemPath, assetDir, oldAssetsBackup, journalId, now);
  }

  /** V5 §5.4 promote：正文 rename 原子；目录替换带幂等判断。 */
  private promoteImport(temporary: string, itemPath: string, assetDir: string, oldAssetsBackup: string, journalId: number, now: string): void {
    try {
      const bodySrc = path.join(temporary, SAVE_BODY_FILE);
      if (fs.existsSync(bodySrc)) fs.renameSync(bodySrc, itemPath);
      const files = fs.readdirSync(temporary).filter((f) => f !== SAVE_BODY_FILE && !f.startsWith("."));
      const alreadyPromoted = files.every((f) => fs.existsSync(path.join(assetDir, f)));
      if (!alreadyPromoted) {
        if (fs.existsSync(assetDir)) {
          if (fs.existsSync(oldAssetsBackup)) fs.rmSync(oldAssetsBackup, { force: true, recursive: true });
          fs.renameSync(assetDir, oldAssetsBackup);
        }
        fs.mkdirSync(path.dirname(assetDir), { recursive: true });
        fs.renameSync(temporary, assetDir);
      }
      this.db.prepare("UPDATE quick_note_file_ops SET state=?, updated_at=? WHERE id=?").run("files_promoted", now, journalId);
    } catch (error) {
      this.db.prepare("UPDATE quick_note_file_ops SET error_message=?, updated_at=? WHERE id=?").run(String(error), now, journalId);
      throw error;
    }
    try { fs.rmSync(oldAssetsBackup, { force: true, recursive: true }); } catch { /* best effort */ }
    try { fs.rmSync(temporary, { force: true, recursive: true }); } catch { /* best effort */ }
    this.db.prepare("DELETE FROM quick_note_file_ops WHERE id=?").run(journalId);
  }

  /** V5 §5.4 启动恢复：未完成 import journal 按状态补做。 */
  private recoverImports(): void {
    type Row = { id: number; quick_note_id: string; old_assets_path: string | null; staging_key: string | null; state: string };
    const rows = this.db.prepare("SELECT id,quick_note_id,old_assets_path,staging_key,state FROM quick_note_file_ops WHERE state IN (?,?,?)").all("prepared", "db_committed", "files_promoted") as Row[];
    for (const row of rows) {
      try {
        const temporary = row.staging_key ? path.join(this.stagingDir, row.staging_key) : null;
        if (row.state === "prepared") {
          if (temporary) { try { fs.rmSync(temporary, { force: true, recursive: true }); } catch { /* best effort */ } }
          this.db.prepare("DELETE FROM quick_note_file_ops WHERE id=?").run(row.id);
        } else if (row.state === "db_committed") {
          const assetDir = this.assetDirFor(row.quick_note_id);
          const oldBackup = row.old_assets_path ?? `${assetDir}.bak-recover`;
          if (!temporary) throw new Error("staging_key 缺失");
          this.promoteImport(temporary, this.itemPath(row.quick_note_id), assetDir, oldBackup, row.id, nowIso());
        } else if (row.state === "files_promoted") {
          if (row.old_assets_path) { try { fs.rmSync(row.old_assets_path, { force: true, recursive: true }); } catch { /* best effort */ } }
          if (temporary) { try { fs.rmSync(temporary, { force: true, recursive: true }); } catch { /* best effort */ } }
          this.db.prepare("DELETE FROM quick_note_file_ops WHERE id=?").run(row.id);
        }
      } catch (error) {
        console.warn(`[quick][recover] import 恢复失败: ${row.quick_note_id} ${String(error)}`);
      }
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
