/**
 * 小记**落盘管线**（V5 §5.3 保存 / §5.4 远端导入）—— 261112 从 electron/quickNotes.ts 拆出。
 *
 * ## 顺序不变量（拆文件时**逐字保留**，不要"优化"）
 * 保存 = **① staging 组装落盘 → ② db.transaction 提交（只改索引行，不碰正式路径）→ ③ promote 改名**。
 * 三步在 `saveQuickNoteInternal` **一个函数里顺序执行、不对外暴露中间态**：
 *  - 文件绝不先于 DB 落正式路径（反过来会出现"行还是旧 hash、文件已是新内容"）；
 *  - DB 失败 ⇒ 正式路径保持旧内容，staging 残留由启动恢复清理；
 *  - promote 失败 ⇒ DB 已前进，`recoverStagedSaves` 下次启动按 content_hash 相等补做（只补不撤）。
 * 导入（import_remote）同理：staging 临时目录 → journal(prepared) → DB 事务 → promote → 清 journal。
 *
 * ## 事务纪律
 * 本模块是唯一在小记库上开 `db.transaction` 的写管线（与 tagLinks.merge 的单事务并列）；
 * 同连接上的嵌套调用会退化成 SAVEPOINT ⇒ **不要**从别的模块再套一层事务进来。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isSafePathSegment as isSafeSegment } from "../../src/core/storeUtils.js";
import { AppError } from "../../src/core/storeErrors.js";
import {
  normalizeQuickNoteContent,
  previewQuickNote,
  quickNoteBodyFromTextAndImages,
  rewriteQuickNoteAssetScope,
  sameQuickNoteContent,
  serializeQuickNoteContent,
  parseQuickNoteContent,
  type StoredQuickNoteContent,
} from "../quickNoteModel.js";
import type { QuickNoteDocument, QuickNoteImage, SaveQuickNoteInput } from "../quickNoteTypes.js";
import type { QuickNotesQueries } from "../quickNotesQueries.js";
import type { DbLike } from "../dbLike.js";
import {
  SAVE_BODY_FILE,
  SAVE_META_FILE,
  assetDirOf,
  atomicWriteFile,
  itemPathOf,
  nowIso,
  quickImageUrlOf,
  sha256Hex,
  stagingDirOf,
  toStoreValidation,
  uuid,
  validateStoredContent,
  type QuickNotePaths,
} from "./context.js";
import { readAllStagedMetadata, readStagedMetadata } from "./staging.js";
import { reindexQuickNoteFromDisk, removeQuickNoteSearchIndex, type QuickNoteSearchDeps } from "./searchIndex.js";

export interface QuickNoteSaveDeps {
  readonly db: DbLike;
  readonly paths: QuickNotePaths;
  readonly queries: QuickNotesQueries;
  readonly search: QuickNoteSearchDeps;
}

export function createQuickNote(deps: QuickNoteSaveDeps, input: SaveQuickNoteInput): QuickNoteDocument {
  const id = uuid();
  const createdAt = nowIso();
  return saveQuickNoteInternal(deps, id, input, createdAt, createdAt, false);
}

export function updateQuickNote(deps: QuickNoteSaveDeps, id: string, input: SaveQuickNoteInput): QuickNoteDocument {
  const previous = deps.queries.readRow(id);
  return saveQuickNoteInternal(deps, id, input, previous.created_at, nowIso(), true, previous.updated_at);
}

function saveQuickNoteInternal(
  deps: QuickNoteSaveDeps,
  id: string,
  input: SaveQuickNoteInput,
  createdAt: string,
  updatedAt: string,
  updating: boolean,
  previousUpdatedAt?: string,
): QuickNoteDocument {
  if (!input || typeof input.text !== "string" || typeof input.draftId !== "string" || !Array.isArray(input.stagedImageIds)) {
    throw new AppError("InvalidInput", "小记保存参数无效");
  }
  if (new Set(input.stagedImageIds).size !== input.stagedImageIds.length) throw new AppError("InvalidInput", "图片列表包含重复项");
  const oldContent = updating ? deps.queries.readStoredContent(id) : null;
  const existing = oldContent?.images ?? [];
  const retainedIds = input.retainedImageIds ?? existing.map((image) => image.id);
  if (new Set(retainedIds).size !== retainedIds.length) throw new AppError("InvalidInput", "保留图片列表包含重复项");
  const existingById = new Map(existing.map((image) => [image.id, image]));
  const retained = retainedIds.map((assetId) => {
    const image = existingById.get(assetId);
    if (!image) throw new AppError("InvalidInput", "保留图片不属于当前小记");
    return image;
  });

  const stagingDir = stagingDirOf(deps.paths, input.draftId);
  // v2：正文一律是内核形态。调用方没给（移动端输入框 / 旧调用点）→ 按 text 合成；
  // 给了（桌面编辑态）→ 原样采用，但要把 staging 资源作用域改写成正式小记作用域。
  const makeId = () => `u${crypto.randomBytes(5).toString("hex")}`;
  const rawBodyInput = typeof input.body === "string" ? input.body : "";
  // 资源清单以**正文引用**为准（260919）：staging 目录里的 sidecar 是落盘事实，
  // 渲染层给的 ids 只当"点名"，并集后再按 `rawBody.includes(filename)` 过滤 ——
  // 既补上"卡已在正文、id 还没到"的时序缺口，也顺手丢掉"编辑器里已删卡但清单还在"的幽灵资源。
  const stagedById = new Map<string, Omit<QuickNoteImage, "url">>();
  for (const item of [...readStagedMetadata(stagingDir, input.stagedImageIds), ...readAllStagedMetadata(stagingDir)]) {
    if (!stagedById.has(item.id)) stagedById.set(item.id, item);
  }
  const stagedMetadata = rawBodyInput.trim()
    ? [...stagedById.values()].filter((item) => rawBodyInput.includes(item.filename))
    : [...stagedById.values()];
  const referencedRetained = rawBodyInput.trim()
    ? retained.filter((item) => rawBodyInput.includes(item.filename))
    : retained;
  const allImages = [...referencedRetained, ...stagedMetadata];
  const rawBody = typeof input.body === "string" && input.body.trim()
    ? input.body
    : quickNoteBodyFromTextAndImages(
        input.text,
        allImages,
        (filename) => quickImageUrlOf(id, filename),
        makeId,
      );
  const body = rewriteQuickNoteAssetScope(rawBody, `/quick-notes/staging/${input.draftId}/`, `/quick-notes/${id}/`);
  // 正文保存不处理标签：标签关系是独立 API（setQuickNoteTags），两个子系统只在关联表相交。
  const content = toStoreValidation(() => normalizeQuickNoteContent(input.text, body, allImages));
  const effectiveUpdatedAt = oldContent && previousUpdatedAt && sameQuickNoteContent(oldContent, content)
    ? previousUpdatedAt
    : updatedAt;
  const encoded = Buffer.from(serializeQuickNoteContent(content), "utf8");
  const contentHash = sha256Hex(encoded);
  const targetAssets = assetDirOf(deps.paths, id);
  // 已被正文遗弃的资源（编辑器里删了卡）连同文件一起清掉，避免幽灵资源占位（HANDOFF §2.10 三.9）。
  const keptIds = new Set(allImages.map((image) => image.id));
  const removed = existing.filter((image) => !keptIds.has(image.id));

  // V5 §5.3：staging 全量组装 → DB 事务提交 → promote（文件绝不先于 DB 落正式路径；
  // DB 失败时正式路径保持旧内容 + 旧索引一致，staging 残留由启动恢复清理）。
  // 组装前确保 staging 目录存在（无图片保存时 draft 目录可能不存在）
  fs.mkdirSync(stagingDir, { recursive: true });
  const stagedBodyPath = path.join(stagingDir, SAVE_BODY_FILE);
  atomicWriteFile(stagedBodyPath, encoded);
  const assetFilenames = stagedMetadata.map((image) => image.filename);
  atomicWriteFile(path.join(stagingDir, SAVE_META_FILE), JSON.stringify({
    operationId: input.draftId, quickNoteId: id, contentHash,
    assetFilenames, createdAt, state: "prepared",
  }));
  // DB 事务（只更新索引，不碰正式路径）
  const tx = deps.db.transaction(() => {
    if (updating) {
      deps.db.prepare("UPDATE quick_notes SET updated_at=?,preview_text=?,image_count=?,content_hash=?,is_dirty=1,is_conflict=0 WHERE id=?")
        .run(effectiveUpdatedAt, previewQuickNote(content.text, content.images.length), content.images.length, contentHash, id);
      deps.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(id);
    } else {
      deps.db.prepare("INSERT INTO quick_notes(id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES(?,?,?,?,?,?, 1, 0)")
        .run(id, createdAt, effectiveUpdatedAt, previewQuickNote(content.text, content.images.length), content.images.length, contentHash);
    }
    const insert = deps.db.prepare("INSERT INTO quick_note_assets(id,quick_note_id,filename,mime_type,width,height,size,content_hash) VALUES(?,?,?,?,?,?,?,?)");
    for (const image of content.images) insert.run(image.id, id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash);
  });
  tx();
  // DB 已提交 → promote（正文 rename 原子；图片逐个 rename）
  promoteStagedSave(deps, stagingDir, id, contentHash, assetFilenames);
  // promote 成功后清理：removed 旧图 + staging 全部（崩溃在清理前 → 孤儿残留无害，下次可清）
  for (const image of removed) {
    try { fs.rmSync(path.join(targetAssets, image.filename), { force: true }); } catch { /* 后续手工清理 */ }
  }
  try { fs.rmSync(stagingDir, { force: true, recursive: true }); } catch { /* optional */ }
  return deps.queries.read(id);
}

/**
 * V5 §5.3 把 staging 组装好的内容 promote 到正式路径（DB 已提交后调用，幂等）。
 * 图片先全部 promote，正文最后 rename：正文存在即代表本次文件集已完整落地，
 * 崩溃恢复时源/目标任一存在就跳过，缺失则保留 staging 待人工处理。
 */
function promoteStagedSave(deps: QuickNoteSaveDeps, stagingDir: string, id: string, _contentHash: string, assetFilenames: string[]): void {
  const assetDir = assetDirOf(deps.paths, id);
  fs.mkdirSync(assetDir, { recursive: true });
  for (const filename of assetFilenames) {
    const src = path.join(stagingDir, filename);
    const dst = path.join(assetDir, filename);
    if (fs.existsSync(src)) fs.renameSync(src, dst);
    else if (!fs.existsSync(dst)) throw new AppError("Internal", `staging 缺少图片文件: ${id}/${filename}`);
  }
  const bodySrc = path.join(stagingDir, SAVE_BODY_FILE);
  const bodyDst = itemPathOf(deps.paths, id);
  if (fs.existsSync(bodySrc)) fs.renameSync(bodySrc, bodyDst);
  else if (!fs.existsSync(bodyDst)) {
    throw new AppError("Internal", `staging 缺少正文文件: ${stagingDir}`);
  }
  reindexQuickNoteFromDisk(deps.search, id);
}

/**
 * V5 §5.3 启动恢复：扫描 staging 残留，按 DB content_hash 判定（先提交为确定 → 只补做不撤销）。
 * DB == staging contentHash → 已提交 → 补 promote；否则未提交 → 删 staging；meta 损坏 → 保留待查。
 */
export function recoverStagedSaves(deps: QuickNoteSaveDeps): void {
  if (!fs.existsSync(deps.paths.stagingDir)) return;
  for (const entry of fs.readdirSync(deps.paths.stagingDir)) {
    const dir = path.join(deps.paths.stagingDir, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    const metaPath = path.join(dir, SAVE_META_FILE);
    if (!fs.existsSync(metaPath)) continue; // 无 meta：遗留 draft 或未知，保留（无法判断）
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { quickNoteId: string; contentHash: string; assetFilenames?: string[]; state?: string };
      const row = deps.db.prepare("SELECT content_hash FROM quick_notes WHERE id=?").get(meta.quickNoteId) as { content_hash: string } | undefined;
      if (row && row.content_hash === meta.contentHash) {
        try {
          promoteStagedSave(deps, dir, meta.quickNoteId, meta.contentHash, meta.assetFilenames ?? []);
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

/** 一条小记内容 + 资源文件的原子写入（journal 4 态：prepared → db_committed → files_promoted）。 */
function writeQuickNoteFromContent(
  deps: QuickNoteSaveDeps,
  item: { id: string; createdAt: string; updatedAt: string; isConflict: boolean },
  parsed: StoredQuickNoteContent,
  contentBytes: Buffer,
  assets: { filename: string; bytes: Buffer }[],
  options: { operationType: string; dirty: 0 | 1 },
): void {
  const assetDir = assetDirOf(deps.paths, item.id);
  const itemPath = itemPathOf(deps.paths, item.id);
  const contentHash = sha256Hex(contentBytes);
  const opId = uuid();
  const stagingKey = `${options.operationType}-${opId}`;
  const temporary = path.join(deps.paths.stagingDir, stagingKey);
  const oldAssetsBackup = `${assetDir}.bak-${opId}`;
  fs.mkdirSync(temporary, { recursive: true });
  for (const asset of assets) {
    atomicWriteFile(path.join(temporary, asset.filename), asset.bytes);
  }
  atomicWriteFile(path.join(temporary, SAVE_BODY_FILE), contentBytes);
  const now = nowIso();
  const journalId = Number(deps.db.prepare(
    "INSERT INTO quick_note_file_ops(operation_type,quick_note_id,old_content_path,new_content_path,old_assets_path,new_assets_path,staging_key,content_hash,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
  ).run(options.operationType, item.id, itemPath, path.join(temporary, SAVE_BODY_FILE), oldAssetsBackup, assetDir, stagingKey, contentHash, "prepared", now, now).lastInsertRowid);
  try {
    const tx = deps.db.transaction(() => {
      deps.db.prepare("INSERT INTO quick_notes(id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at,updated_at=excluded.updated_at,preview_text=excluded.preview_text,image_count=excluded.image_count,content_hash=excluded.content_hash,is_dirty=excluded.is_dirty,is_conflict=excluded.is_conflict,cloud_deleted=0")
        .run(item.id, item.createdAt, item.updatedAt, previewQuickNote(parsed.text, parsed.images.length), parsed.images.length, contentHash, options.dirty, item.isConflict ? 1 : 0);
      deps.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(item.id);
      // 他端恢复/显式恢复：远端 active 条目回来时清掉本地 purged 墓碑（否则每轮又会被当成删除）。
      deps.db.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(item.id);
      const insert = deps.db.prepare("INSERT INTO quick_note_assets(id,quick_note_id,filename,mime_type,width,height,size,content_hash) VALUES(?,?,?,?,?,?,?,?)");
      for (const image of parsed.images) insert.run(image.id, item.id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash);
      deps.db.prepare("UPDATE quick_note_file_ops SET state=?, updated_at=? WHERE id=?").run("db_committed", now, journalId);
    });
    tx();
  } catch (error) {
    deps.db.prepare("DELETE FROM quick_note_file_ops WHERE id=?").run(journalId);
    try { fs.rmSync(temporary, { force: true, recursive: true }); } catch { /* best effort */ }
    throw error;
  }
  promoteImport(deps, temporary, itemPath, assetDir, oldAssetsBackup, journalId, now);
  reindexQuickNoteFromDisk(deps.search, item.id);
}

/** 远端小记导入（V5 §5.4：4 态 journal 驱动）。 */
export function importRemoteQuickNote(
  deps: QuickNoteSaveDeps,
  item: { id: string; createdAt: string; updatedAt: string; contentHash: string; isConflict: boolean },
  contentBytes: Buffer,
  assets: { filename: string; bytes: Buffer }[],
): void {
  if (!isSafeSegment(item.id)) throw new AppError("InvalidInput", "远端小记 ID 无效");
  if (sha256Hex(contentBytes) !== item.contentHash) throw new AppError("InvalidInput", "远端小记内容哈希不符");
  const parsed = validateStoredContent(parseQuickNoteContent(contentBytes.toString("utf8")));
  for (const image of parsed.images) {
    const asset = assets.find((candidate) => candidate.filename === image.filename);
    if (!asset || asset.bytes.length !== image.size || sha256Hex(asset.bytes) !== image.hash) throw new AppError("InvalidInput", `远端图片不完整: ${image.filename}`);
  }
  for (const asset of assets) {
    if (!isSafeSegment(asset.filename)) throw new AppError("InvalidInput", "远端图片文件名无效");
  }
  writeQuickNoteFromContent(deps, item, parsed, contentBytes, assets, { operationType: "import_remote", dirty: 0 });
}

/**
 * 本地「日记 → 小记」转换用：用**已构造好的内容 + 资产字节**创建一条小记。
 * 与远端导入共用同一套 journal/promote（失败不产生半成品；`is_dirty=1` 等下一轮同步上传）。
 */
export function createQuickNoteFromContent(
  deps: QuickNoteSaveDeps,
  input: { id: string; content: StoredQuickNoteContent; assets: { filename: string; bytes: Buffer }[] },
): void {
  if (!isSafeSegment(input.id)) throw new AppError("InvalidInput", "小记 ID 无效");
  for (const asset of input.assets) {
    if (!isSafeSegment(asset.filename)) throw new AppError("InvalidInput", "资源文件名无效");
  }
  for (const image of input.content.images) {
    const asset = input.assets.find((candidate) => candidate.filename === image.filename);
    if (!asset || asset.bytes.length !== image.size || sha256Hex(asset.bytes) !== image.hash) {
      throw new AppError("InvalidInput", `资源不完整: ${image.filename}`);
    }
  }
  const contentBytes = Buffer.from(serializeQuickNoteContent(input.content), "utf8");
  const now = nowIso();
  writeQuickNoteFromContent(
    deps,
    { id: input.id, createdAt: now, updatedAt: now, isConflict: false },
    input.content,
    contentBytes,
    input.assets,
    { operationType: "local_convert", dirty: 1 },
  );
}

/**
 * **仅转换失败回滚用**：删除一条「本次刚创建、尚未同步」的小记（行/内容/资产/搜索索引）。
 * 不写墓碑——这条从未发布到云端，写墓碑会让同步传播一条不存在的删除。
 */
export function removeUnsyncedQuickNote(deps: QuickNoteSaveDeps, id: string): void {
  if (!isSafeSegment(id)) return;
  const row = deps.db.prepare("SELECT is_dirty FROM quick_notes WHERE id=?").get(id) as { is_dirty: number } | undefined;
  // 261112 发版复核 F-03：即使行没写全（创建中途失败），也要清掉该 id 的 journal 与 staging，
  // 否则重启 recoverImports 会按 db_committed 把半成品 promote 成一条小记（转换报错却留下副本）。
  const ops = deps.db.prepare("SELECT id, staging_key FROM quick_note_file_ops WHERE quick_note_id=?").all(id) as Array<{ id: number; staging_key: string | null }>;
  for (const op of ops) {
    if (op.staging_key) { try { fs.rmSync(path.join(deps.paths.stagingDir, op.staging_key), { force: true, recursive: true }); } catch { /* best effort */ } }
    try { deps.db.prepare("DELETE FROM quick_note_file_ops WHERE id=?").run(op.id); } catch { /* best effort */ }
  }
  if (!row) return;
  const tx = deps.db.transaction(() => {
    deps.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(id);
    deps.db.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
    deps.db.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
  });
  tx();
  try { fs.rmSync(itemPathOf(deps.paths, id), { force: true }); } catch { /* best effort */ }
  try { fs.rmSync(assetDirOf(deps.paths, id), { force: true, recursive: true }); } catch { /* best effort */ }
  removeQuickNoteSearchIndex(deps.search, [id]);
}

/**
 * 日记「转为小记」= **移动**（261113 用户裁决，覆盖旧的「复制 + 原稿进回收站」）：
 * 把已经改写好作用域的正文 + 已搬到小记资产目录（或即将搬）的**同一批资产**登记成一条小记。
 *
 * 与 `createQuickNoteFromContent` 的区别：不再读/写资产字节副本，也不再 strip 卡片 ——
 * 正文原样（只改资源 URL 作用域），资产**目录整体迁移**（`note-assets/{id}/` → `quick-notes/assets/{id}/`）。
 *
 * 顺序（跨两个 SQLite + 文件系统，无全局事务）：
 *  ① 校验（正文/清单/资源字节 hash）→ ② 写小记正文（原子）→ ③ 小记库事务插行/资源行
 *  → ④ 资产目录迁移 → ⑤ 搜索索引。③ 之后任一步失败都在本函数内回滚，调用方只需保证
 *  「Lake 侧删除失败时调 `rollbackAdoptedQuickNote` 把资产移回」。
 *
 * **无副本语义**：迁移完成后 Lake 侧原稿由调用方物理移除（不写可恢复副本、不进回收站）；
 * 小记没有历史快照 ⇒ 原文档 history 快照也由调用方删除并明说（见 electron/diaryQuickNoteConversion.ts）。
 */
export function adoptMovedNoteAsQuickNote(
  deps: QuickNoteSaveDeps,
  input: {
    id: string;
    content: StoredQuickNoteContent;
    createdAt: string;
    updatedAt: string;
    /** 源文档资产目录（note-assets/{noteId}/，绝对路径）。不存在 = 本篇没有资产。 */
    sourceAssetsDir: string;
  },
): void {
  const { id } = input;
  if (!isSafeSegment(id)) throw new AppError("InvalidInput", "小记 ID 无效");
  // id 沿用 Lake note id（减少接线）：已有同 id 小记/墓碑时必须拒绝，否则会覆盖或复活一条已删小记。
  if (deps.db.prepare("SELECT 1 FROM quick_notes WHERE id=?").get(id)) throw new AppError("InvalidInput", `小记已存在: ${id}`);
  if (deps.db.prepare("SELECT 1 FROM quick_note_deleted WHERE id=?").get(id)) throw new AppError("InvalidInput", `该 id 有已删除小记记录，不能复用: ${id}`);
  const content = validateStoredContent(input.content);
  // 资源清单必须与源目录里的**实际字节**一致（移动前校验，避免把小记指向不存在的文件）。
  for (const image of content.images) {
    const file = path.join(input.sourceAssetsDir, image.filename);
    let bytes: Buffer;
    try { bytes = fs.readFileSync(file); }
    catch { throw new AppError("InvalidInput", `小记资源缺失: ${image.filename}`); }
    if (bytes.length !== image.size || sha256Hex(bytes) !== image.hash) {
      throw new AppError("InvalidInput", `小记资源内容不一致: ${image.filename}`);
    }
  }
  const encoded = Buffer.from(serializeQuickNoteContent(content), "utf8");
  const contentHash = sha256Hex(encoded);
  const itemPath = itemPathOf(deps.paths, id);
  const assetDir = assetDirOf(deps.paths, id);
  atomicWriteFile(itemPath, encoded);
  try {
    const tx = deps.db.transaction(() => {
      deps.db.prepare("INSERT INTO quick_notes(id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict) VALUES(?,?,?,?,?,?,1,0)")
        .run(id, input.createdAt, input.updatedAt, previewQuickNote(content.text, content.images.length), content.images.length, contentHash);
      const insert = deps.db.prepare("INSERT INTO quick_note_assets(id,quick_note_id,filename,mime_type,width,height,size,content_hash) VALUES(?,?,?,?,?,?,?,?)");
      for (const image of content.images) insert.run(image.id, id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash);
    });
    tx();
  } catch (error) {
    try { fs.rmSync(itemPath, { force: true }); } catch { /* best effort */ }
    throw error;
  }
  try {
    // 整个目录搬走（含正文未引用的残留文件）：不留下「原资产副本」，符合移动语义。
    moveAssetDirectorySync(input.sourceAssetsDir, assetDir);
  } catch (error) {
    try {
      deps.db.transaction(() => {
        deps.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(id);
        deps.db.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
      })();
    } catch { /* best effort */ }
    try { fs.rmSync(itemPath, { force: true }); } catch { /* best effort */ }
    throw error;
  }
  reindexQuickNoteFromDisk(deps.search, id);
}

/**
 * **仅「移动到小记」失败回滚用**：删小记行/正文/索引，并把资产目录**移回**原 Lake 资产目录
 * （不删字节 —— 这一步发生在 Lake 原稿还在的时候，删了就是数据丢失）。
 * 资产移回失败只告警并**保留小记**（行/正文/资产都还在）：宁可留一条可手删的小记，也不丢唯一资产副本。
 */
export function rollbackAdoptedQuickNote(deps: QuickNoteSaveDeps, id: string, restoreAssetsToDir: string): void {
  if (!isSafeSegment(id)) return;
  // 顺序：**先把资产移回 Lake 目录**（原稿重新完整），成功后才删小记行/正文。
  // 若移回失败（极端：目标被占用/跨盘拷不动），**保留小记**不删 —— 内容仍在，绝不为了「删干净」丢掉唯一的资产副本。
  try { moveAssetDirectorySync(assetDirOf(deps.paths, id), restoreAssetsToDir); }
  catch (error) {
    console.warn("[quick][move] 回滚时资产目录移回失败，保留小记以免丢字节:", id, String(error));
    return;
  }
  try {
    deps.db.transaction(() => {
      deps.db.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(id);
      deps.db.prepare("DELETE FROM quick_note_sync_base WHERE quick_note_id=?").run(id);
      deps.db.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
    })();
  } catch { /* best effort */ }
  try { fs.rmSync(itemPathOf(deps.paths, id), { force: true }); } catch { /* best effort */ }
  removeQuickNoteSearchIndex(deps.search, [id]);
}

/**
 * 目录迁移（移动语义）：同盘 = `rename`（原子）；跨盘 = 先全量复制、成功后再删源（破坏性最小）。
 * 目标已存在且非空 ⇒ 明确失败（避免把两篇文档的资产混在一个目录里）。
 * 源目录不存在 = 本篇没有资产（no-op）。
 */
export function moveAssetDirectorySync(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) return;
  if (fs.existsSync(targetDir)) {
    if (fs.readdirSync(targetDir).length > 0) throw new AppError("Internal", `目标资产目录已存在且非空: ${targetDir}`);
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  try {
    fs.renameSync(sourceDir, targetDir);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  // 跨盘回退：复制全部文件 → 校验数量 → 删源（中途失败清掉目标，源保持完整）。
  fs.mkdirSync(targetDir, { recursive: true });
  try {
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true }).filter((entry) => entry.isFile());
    for (const entry of entries) {
      fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
    }
    if (fs.readdirSync(targetDir).length !== entries.length) throw new AppError("Internal", "资产目录复制不完整");
  } catch (error) {
    try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch { /* best effort */ }
    throw error;
  }
  fs.rmSync(sourceDir, { recursive: true, force: true });
}

/** V5 §5.4 promote：正文 rename 原子；目录替换带幂等判断。 */
function promoteImport(deps: QuickNoteSaveDeps, temporary: string, itemPath: string, assetDir: string, oldAssetsBackup: string, journalId: number, now: string): void {
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
    deps.db.prepare("UPDATE quick_note_file_ops SET state=?, updated_at=? WHERE id=?").run("files_promoted", now, journalId);
  } catch (error) {
    deps.db.prepare("UPDATE quick_note_file_ops SET error_message=?, updated_at=? WHERE id=?").run(String(error), now, journalId);
    throw error;
  }
  try { fs.rmSync(oldAssetsBackup, { force: true, recursive: true }); } catch { /* best effort */ }
  try { fs.rmSync(temporary, { force: true, recursive: true }); } catch { /* best effort */ }
  deps.db.prepare("DELETE FROM quick_note_file_ops WHERE id=?").run(journalId);
}

/** V5 §5.4 启动恢复：未完成 import journal 按状态补做。 */
export function recoverImports(deps: QuickNoteSaveDeps): void {
  type Row = { id: number; quick_note_id: string; old_assets_path: string | null; staging_key: string | null; state: string };
  const rows = deps.db.prepare("SELECT id,quick_note_id,old_assets_path,staging_key,state FROM quick_note_file_ops WHERE state IN (?,?,?)").all("prepared", "db_committed", "files_promoted") as Row[];
  for (const row of rows) {
    try {
      const temporary = row.staging_key ? path.join(deps.paths.stagingDir, row.staging_key) : null;
      if (row.state === "prepared") {
        if (temporary) { try { fs.rmSync(temporary, { force: true, recursive: true }); } catch { /* best effort */ } }
        deps.db.prepare("DELETE FROM quick_note_file_ops WHERE id=?").run(row.id);
      } else if (row.state === "db_committed") {
        const assetDir = assetDirOf(deps.paths, row.quick_note_id);
        const oldBackup = row.old_assets_path ?? `${assetDir}.bak-recover`;
        if (!temporary) throw new Error("staging_key 缺失");
        promoteImport(deps, temporary, itemPathOf(deps.paths, row.quick_note_id), assetDir, oldBackup, row.id, nowIso());
        reindexQuickNoteFromDisk(deps.search, row.quick_note_id);
      } else if (row.state === "files_promoted") {
        if (row.old_assets_path) { try { fs.rmSync(row.old_assets_path, { force: true, recursive: true }); } catch { /* best effort */ } }
        if (temporary) { try { fs.rmSync(temporary, { force: true, recursive: true }); } catch { /* best effort */ } }
        deps.db.prepare("DELETE FROM quick_note_file_ops WHERE id=?").run(row.id);
      }
    } catch (error) {
      console.warn(`[quick][recover] import 恢复失败: ${row.quick_note_id} ${String(error)}`);
    }
  }
}
