/**
 * 移动端 Quick Notes 同步端口（quickNotesSyncEngine 的本地存储实现）。
 *
 * 独立于 bridge.ts 以便单测（注入测试用同步 DB + 资产文件依赖，不依赖 Capacitor/native SQLite 装载）：
 * - native SQLite 单库方案：quick_notes 行 + content 列（序列化正文）；图片**纯文件**（无 BLOB，与桌面一致），
 *   同步端口通过注入的 assetBytes 内存层 + 文件读写操作图片（复用 Lake 资源同步的既有模式：
 *   内存 Map 同步访问 + fire-and-forget 落盘 + 读时文件兜底）；
 * - 与桌面 QuickNotesStore 语义对齐：软删保留内容（墓碑携带）、恢复标记、同步基线、冲突归档新 id。
 *
 * 内容格式：content 列 = serializeQuickNoteContent 输出（与桌面 .qnote 文件字节一致），
 * content_hash = sha256Sync(该字节)，两端哈希天然一致。
 */
import { sha256Sync } from "../../core/sha256Sync.js";
import { previewQuickNote, validateQuickNoteContent } from "../../core/quickNoteModel.js";
import type { StoredQuickNoteContent } from "../../core/quickNoteModel.js";
import type { QuickNoteSyncItemImage, QuickNotesSyncDbPort } from "../../core/quickNotesSyncEngine.js";
import type { MobileDb } from "./sqliteDb.js";
import { stageAssetWrites } from "../native/assetWrites.js";
import { deleteQuickNoteBody, readQuickNoteBody, writeQuickNoteBody } from "./noteBodies.js";
import { applyRemoteQuickNoteTags, resolveQuickNoteTagNames } from "./quickNotesRepository.js";

/** 小记图片文件访问依赖（注入：bridge 用 Capacitor Filesystem + 内存 assets Map；测试用内存实现）。
 * 键 = "quick-notes/{quickNoteId}/{filename}"（与 Lake 资源的 note-assets/{noteId}/{file} 同构）。 */
export interface QuickNotesAssetFsDeps {
  /** 同步内存层（运行期字节真相；文件为持久层）。 */
  assetBytes: Map<string, Uint8Array>;
  /** 落盘（异步；失败必须向上传播，由调用方回滚或保持未同步状态）。 */
  saveAssetFile(key: string, bytes: Uint8Array): Promise<void>;
  /** 读文件（缺失 → null）。 */
  loadAssetFile(key: string): Promise<Uint8Array | null>;
  /** 删除文件（幂等）。 */
  removeAssetFile(key: string): Promise<void>;
  /** 正文文件读写（可选注入；缺省走全局 BodyStore。多设备测试各注入一份独立实现）。 */
  bodyFs?: QuickNotesBodyFs;
}

/** 小记正文文件的最小依赖（BodyStore 的测试替身/生产全局实现）。 */
export interface QuickNotesBodyFs {
  read(id: string): Promise<string | null>;
  write(id: string, text: string): Promise<number>;
  remove(id: string): Promise<void>;
}

const quickNoteAssetKey = (id: string, filename: string): string => "quick-notes/" + id + "/" + filename;

/**
 * P2 同步端口所需的 schema 增量（幂等：列缺失才 ALTER，表缺失才 CREATE）。
 *
 * 返回**语句清单**而不是直接执行：移动端原生 SQLite 每条语句都是一次 JS↔原生桥往返
 * （实测 ~68ms），启动时由 `data/schema.ts` 用 `executeSet` 把整批 DDL 合成**一次**下发。
 */
export async function buildQuickNotesSyncSchemaStatements(d: MobileDb): Promise<string[]> {
  const statements: string[] = [];
  const qCols = ((await d.prepare("PRAGMA table_info(quick_notes)").all()) as Array<{ name: string }>).map((c) => c.name);
  if (!qCols.includes("deleted_at")) statements.push("ALTER TABLE quick_notes ADD COLUMN deleted_at TEXT");
  if (!qCols.includes("base_hash")) statements.push("ALTER TABLE quick_notes ADD COLUMN base_hash TEXT");
  // ready_to_sync：0 = 纯本地归档（冲突归档新 id，不向云端发布删除记录，防幽灵墓碑，对齐桌面）；1 = 可同步的删除墓碑
  if (!qCols.includes("ready_to_sync")) statements.push("ALTER TABLE quick_notes ADD COLUMN ready_to_sync INTEGER NOT NULL DEFAULT 1");
  if (!qCols.includes("tags_json")) statements.push("ALTER TABLE quick_notes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
  if (!qCols.includes("tag_ids_json")) statements.push("ALTER TABLE quick_notes ADD COLUMN tag_ids_json TEXT NOT NULL DEFAULT '[]'");
  if (!qCols.includes("first_image")) statements.push("ALTER TABLE quick_notes ADD COLUMN first_image TEXT");
  if (!qCols.includes("list_metadata_version")) statements.push("ALTER TABLE quick_notes ADD COLUMN list_metadata_version INTEGER NOT NULL DEFAULT 0");
  statements.push(`CREATE TABLE IF NOT EXISTS quick_note_tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`);
  statements.push(`CREATE TABLE IF NOT EXISTS quick_note_deleted (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL
  )`);
  return statements;
}

/** 兼容入口（单测/旧调用）：逐条执行；启动路径请走 build + 批量下发。 */
export async function applyQuickNotesSyncSchema(d: MobileDb): Promise<void> {
  for (const statement of await buildQuickNotesSyncSchemaStatements(d)) await d.exec(statement);
}

/** 端口实现：注入已打开的小记库 + 资产文件依赖，供 syncQuickNotesViaEngine 使用。 */
export function createQuickNotesSyncDbPort(d: MobileDb, assetFs: QuickNotesAssetFsDeps): QuickNotesSyncDbPort {
  const { assetBytes, saveAssetFile, loadAssetFile, removeAssetFile } = assetFs;
  // 正文文件端口：生产 = 全局 BodyStore；测试可注入每设备独立实现（避免多设备共用内存 Map 串正文）。
  const bodyFs: QuickNotesBodyFs = assetFs.bodyFs ?? {
    read: readQuickNoteBody,
    write: writeQuickNoteBody,
    remove: deleteQuickNoteBody,
  };
  return {
    async listLocalQuickNotes() {
      const rows = await d.prepare("SELECT id, created_at, updated_at, content_hash, sync_state, is_conflict FROM quick_notes WHERE deleted_at IS NULL").all() as Array<Record<string, unknown>>;
      return Promise.all(rows.map(async (r) => {
        let images: QuickNoteSyncItemImage[] = [];
        try {
          const text = await bodyFs.read(String(r.id));
          if (text == null) throw new Error("正文文件缺失");
          const parsed = JSON.parse(text) as StoredQuickNoteContent;
          images = parsed.images.map(({ id, filename, mimeType, width, height, size, hash }) => ({ id, filename, mimeType, width, height, size, hash }));
        } catch (reason) {
          // P2-3（GPT 审计）：内容损坏不得静默当无图继续进 manifest——对齐桌面 readStoredContent 抛错
          throw new Error(`小记内容损坏: ${r.id}: ${(reason as Error).message}`);
        }
        return {
          id: String(r.id),
          createdAt: String(r.created_at),
          updatedAt: String(r.updated_at),
          contentHash: String(r.content_hash),
          syncState: String(r.sync_state),
          isConflict: !!r.is_conflict,
          images,
        };
      }));
    },
    async readContent(id) {
      const text = await bodyFs.read(id);
      return text == null ? null : new TextEncoder().encode(text);
    },
    async readAsset(id, filename) {
      // 纯文件为准（无 BLOB）：内存层优先，文件兜底（对齐 Lake readLocalAsset 模式）
      const key = quickNoteAssetKey(id, filename);
      return assetBytes.get(key) ?? await loadAssetFile(key);
    },
    async applyRemoteQuickNote(item, content, assets) {
      const text = new TextDecoder().decode(content);
      let parsed: StoredQuickNoteContent;
      try { parsed = validateQuickNoteContent(JSON.parse(text)); }
      catch (reason) { throw new Error(`远端小记内容无效: ${item.id}: ${(reason as Error).message}`); }
      const contentHash = sha256Sync(content);
      if (contentHash !== item.contentHash) throw new Error(`小记内容哈希不符: ${item.id}`);
      const tagNames = (await resolveQuickNoteTagNames(d, parsed.tagIds)).filter(Boolean);
      // 预校验图片齐全（在写 DB 前——原子性：任一缺失则整体失败，正文不落库，对齐桌面事务回滚语义）
      const byName = new Map(assets.map((a) => [a.filename, a]));
      for (const image of parsed.images) {
        if (!byName.get(image.filename)?.bytes) throw new Error("小记图片缺失: " + item.id + "/" + image.filename);
      }
      // 先落图片文件，再提交 DB；任一失败都会回滚本次文件写入，避免 DB 声称图片存在。
      const imageWrites = parsed.images.map((image) => ({
        key: quickNoteAssetKey(item.id, image.filename),
        bytes: byName.get(image.filename)!.bytes,
      }));
      const rollbackAssets = await stageAssetWrites(imageWrites, {
        memory: assetBytes,
        read: loadAssetFile,
        save: saveAssetFile,
        remove: removeAssetFile,
      });

      // 正文先落文件（与图片同一原子边界：任一失败回滚本次文件写入），再提交 DB。
      const previousBody = await bodyFs.read(item.id);
      try {
        await bodyFs.write(item.id, text);
        await d.transaction(async () => {
          await d.prepare(
            "INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, sync_state, is_conflict, restore_pending_at, ready_to_sync, tags_json, tag_ids_json, first_image, list_metadata_version) " +
            "VALUES (?,?,?,?,?,?, 'synced', ?, NULL, 1, ?, ?, ?, 1) " +
            "ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, sync_state=excluded.sync_state, is_conflict=excluded.is_conflict, restore_pending_at=NULL, deleted_at=NULL, ready_to_sync=1, tags_json=excluded.tags_json, tag_ids_json=excluded.tag_ids_json, first_image=excluded.first_image, list_metadata_version=1"
          ).run(item.id, item.createdAt, item.updatedAt, previewQuickNote(parsed.text, parsed.images.length), parsed.images.length, contentHash, item.isConflict ? 1 : 0, JSON.stringify(tagNames), JSON.stringify(parsed.tagIds), parsed.images[0]?.filename ?? null);
        });
      } catch (error) {
        // DB 失败 ⇒ 正文文件回滚到应用前版本（没有旧版本则删掉本次新写的），避免"文件新、DB 旧"。
        if (previousBody == null) await bodyFs.remove(item.id).catch(() => undefined);
        else await bodyFs.write(item.id, previousBody).catch(() => undefined);
        await rollbackAssets();
        throw error;
      }
      // 不做旧文件清理：每次上传/同步生成唯一新文件，旧文件由 GC/孤儿清理回收；冗余是设计理念。
    },
    async applyTombstoneContent(id, content) {
      const contentHash = sha256Sync(content);
      const previousBody = await bodyFs.read(id);
      try {
        await bodyFs.write(id, new TextDecoder().decode(content));
        await d.prepare("UPDATE quick_notes SET content_hash=? WHERE id=?").run(contentHash, id);
      } catch (error) {
        if (previousBody == null) await bodyFs.remove(id).catch(() => undefined);
        else await bodyFs.write(id, previousBody).catch(() => undefined);
        throw error;
      }
    },
    async listDeletedQuickNoteAssets(id) {
      // 墓碑携带图片（A）：读软删保留的 .qnote 文件解析删除前图片元数据；文件缺失/解析失败 → []
      const text = await bodyFs.read(id);
      if (text == null) return [];
      try {
        const parsed = JSON.parse(text) as StoredQuickNoteContent;
        return parsed.images.map(({ id: imageId, filename, mimeType, width, height, size, hash }) => ({ id: imageId, filename, mimeType, width, height, size, hash }));
      } catch { return []; }
    },
    async applyTombstoneAssets(id, assets) {
      // 墓碑携带图片（A）：删除前图片字节落盘文件（软删行保留，恢复时图片完整；无 BLOB）。
      // 覆盖写：本机可能已有同 id 图片（此前同步过），墓碑携带的删除前最新字节应覆盖。
      await stageAssetWrites(
        assets.map((asset) => ({
          key: quickNoteAssetKey(id, asset.metadata.filename),
          bytes: asset.bytes,
        })),
        { memory: assetBytes, read: loadAssetFile, save: saveAssetFile, remove: removeAssetFile },
      );
    },
    async deleteLocalQuickNote(id) {
      await d.prepare("UPDATE quick_notes SET deleted_at=?, restore_pending_at=NULL, sync_state='local', ready_to_sync=1 WHERE id=?").run(new Date().toISOString(), id);
    },
    async archiveLocalQuickNoteToTrash(id) {
      const row = await d.prepare("SELECT created_at, preview_text, image_count, content_hash FROM quick_notes WHERE id=?").get(id) as { created_at: string; preview_text: string; image_count: number; content_hash: string } | undefined;
      if (!row) return;
      const bodyText = await bodyFs.read(id);
      if (bodyText == null) return;

      const newId = crypto.randomUUID();
      const now = new Date().toISOString();
      let parsed: StoredQuickNoteContent | null = null;
      try {
        parsed = JSON.parse(bodyText) as StoredQuickNoteContent;
      } catch { /* 内容解析失败：图片文件保持旧 id（归档回收站仍可读） */ }

      const imageWrites: Array<{ key: string; bytes: Uint8Array }> = [];
      if (parsed) {
        for (const image of parsed.images) {
          const oldKey = quickNoteAssetKey(id, image.filename);
          const bytes = assetBytes.get(oldKey) ?? await loadAssetFile(oldKey);
          if (bytes) imageWrites.push({ key: quickNoteAssetKey(newId, image.filename), bytes });
        }
      }
      const rollbackAssets = imageWrites.length > 0
        ? await stageAssetWrites(imageWrites, { memory: assetBytes, read: loadAssetFile, save: saveAssetFile, remove: removeAssetFile })
        : async () => {};

      try {
        await bodyFs.write(newId, bodyText);
        await d.transaction(async () => {
          // ready_to_sync=0：纯本地归档，不向云端发布删除记录（其他端从未持有该 id，防幽灵墓碑，对齐桌面 archiveLocalToTrash）
          await d.prepare("INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, sync_state, is_conflict, restore_pending_at, deleted_at, ready_to_sync) VALUES (?,?,?,?,?,?,'local',0,NULL,?,0)").run(newId, row.created_at, now, row.preview_text, row.image_count, row.content_hash, now);
        });
      } catch (error) {
        // 归档行没提交 ⇒ 新 id 的正文文件也不能留下（否则是一个"打不开的孤儿小记"）。
        await bodyFs.remove(newId).catch(() => undefined);
        await rollbackAssets();
        throw error;
      }

      if (parsed) {
        for (const image of parsed.images) {
          const oldKey = quickNoteAssetKey(id, image.filename);
          assetBytes.delete(oldKey);
          await removeAssetFile(oldKey).catch(() => undefined);
        }
      }
    },
    async listDeletedQuickNotes() {
      // ready_to_sync=1 才作为可同步墓碑；冲突归档（=0）纯本地保留不发布
      const local = await d.prepare("SELECT id, created_at, updated_at, deleted_at FROM quick_notes WHERE deleted_at IS NOT NULL AND ready_to_sync=1").all() as Array<Record<string, unknown>>;
      const learned = await d.prepare("SELECT id, created_at, updated_at, deleted_at FROM quick_note_deleted").all() as Array<Record<string, unknown>>;
      const merged = new Map<string, { id: string; createdAt: string; updatedAt: string; deletedAt: string }>();
      for (const r of [...local, ...learned]) {
        const item = { id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), deletedAt: String(r.deleted_at) };
        const previous = merged.get(item.id);
        // 同一个 id 可能同时存在于本地软删行和远端学习墓碑表；保留较新的删除时间，
        // 避免一份删除在 manifest 中发布两次，也避免旧墓碑覆盖新墓碑。
        if (!previous || item.deletedAt > previous.deletedAt) merged.set(item.id, item);
      }
      return [...merged.values()];
    },
    async markDeletedPublished(ids) {
      // 墓碑发布 → 清待同步标记（对齐桌面）。本地软删行置 ready_to_sync=0（不再重复发布/计数）；
      // quick_note_deleted 是远端学习墓碑（无本地副本），无可清的 ready 标记，跳过。
      for (const id of ids) {
        await d.prepare("UPDATE quick_notes SET ready_to_sync=0 WHERE id=? AND deleted_at IS NOT NULL").run(id);
      }
    },
    async listAllDeletedQuickNotes() {
      // 下载方向 LWW 需要全部墓碑（含已发布 ready=0）：软删行任意 ready + 远端学习表合并
      const local = await d.prepare("SELECT id, created_at, updated_at, deleted_at FROM quick_notes WHERE deleted_at IS NOT NULL").all() as Array<Record<string, unknown>>;
      const learned = await d.prepare("SELECT id, created_at, updated_at, deleted_at FROM quick_note_deleted").all() as Array<Record<string, unknown>>;
      const merged = new Map<string, { id: string; createdAt: string; updatedAt: string; deletedAt: string }>();
      for (const r of [...local, ...learned]) {
        const item = { id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), deletedAt: String(r.deleted_at) };
        const previous = merged.get(item.id);
        if (!previous || item.deletedAt > previous.deletedAt) merged.set(item.id, item);
      }
      return [...merged.values()];
    },
    async listDeferredDeletedQuickNotes() { return []; }, // 移动端无小记→笔记转换
    async rememberDeletedQuickNote(item) {
      await d.prepare("INSERT OR REPLACE INTO quick_note_deleted (id, created_at, updated_at, deleted_at) VALUES (?,?,?,?)").run(item.id, item.createdAt, item.updatedAt, item.deletedAt);
    },
    async revokeLocalDeletion(id) {
      await d.transaction(async () => {
        await d.prepare("UPDATE quick_notes SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL").run(id);
        await d.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
      });
    },
    async isRestorePending(id) {
      const row = await d.prepare("SELECT restore_pending_at FROM quick_notes WHERE id=?").get(id) as { restore_pending_at: string | null } | undefined;
      return row ? row.restore_pending_at !== null : false;
    },
    async baseHash(id) {
      const row = await d.prepare("SELECT base_hash FROM quick_notes WHERE id=?").get(id) as { base_hash: string | null } | undefined;
      return row ? row.base_hash : null;
    },
    async setBaseHash(id, contentHash) {
      await d.prepare("UPDATE quick_notes SET base_hash=? WHERE id=?").run(contentHash, id);
    },
    async markSynced(id) {
      // restore_pending_at 一并清除：恢复已生效后残留标记会让本设备永远 local-wins（墓碑永胜被破坏）。
      await d.prepare("UPDATE quick_notes SET sync_state='synced', restore_pending_at=NULL WHERE id=?").run(id);
    },
    async markSyncedIfUnchanged(id, expectedContentHash) {
      // I2（见 core/maintenancePolicy）：同步期间内容被编辑 ⇒ 不标 synced，保持 local 下轮重传。
      // 判据是**实算内容 hash**（与 content_hash 列同源：sha256Sync(序列化字节)），不读可能陈旧的列。
      const row = await d.prepare("SELECT id FROM quick_notes WHERE id=?").get(id);
      if (!row) return;
      const body = await bodyFs.read(id);
      if (body == null) return;
      const currentHash = sha256Sync(new TextEncoder().encode(body));
      if (currentHash !== expectedContentHash) return;
      await d.prepare("UPDATE quick_notes SET sync_state='synced', restore_pending_at=NULL WHERE id=?").run(id);
    },
    async mergeRemoteQuickNoteTags(remote) {
      return applyRemoteQuickNoteTags(d, remote);
    },
    log(msg) {
      console.log("[mobile-quick-sync]", msg);
    },
  };
}
