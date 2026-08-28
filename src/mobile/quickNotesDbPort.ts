/**
 * 移动端 Quick Notes 同步端口（quickNotesSyncEngine 的本地存储实现）。
 *
 * 独立于 bridge.ts 以便单测（注入 DbLike + 资产文件依赖，不依赖 Capacitor/sql.js WASM 装载）：
 * - sql.js 单库方案：quick_notes 行 + content 列（序列化正文）；图片**纯文件**（无 BLOB，与桌面一致），
 *   同步端口通过注入的 assetBytes 内存层 + 文件读写操作图片（复用 Lake 资源同步的既有模式：
 *   内存 Map 同步访问 + fire-and-forget 落盘 + 读时文件兜底）；
 * - 与桌面 QuickNotesStore 语义对齐：软删保留内容（墓碑携带）、恢复标记、同步基线、冲突归档新 id。
 *
 * 内容格式：content 列 = serializeQuickNoteContent 输出（与桌面 .qnote 文件字节一致），
 * content_hash = sha256Sync(该字节)，两端哈希天然一致。
 */
import { sha256Sync } from "../core/sha256Sync.js";
import { previewQuickNote, validateQuickNoteContent } from "../core/quickNoteModel.js";
import type { StoredQuickNoteContent } from "../core/quickNoteModel.js";
import type { QuickNoteSyncItemImage, QuickNotesSyncDbPort } from "../core/quickNotesSyncEngine.js";
import type { DbLike } from "./sqliteDb.js";

/** 小记图片文件访问依赖（注入：bridge 用 Capacitor Filesystem + 内存 assets Map；测试用内存实现）。
 * 键 = "quick-notes/{quickNoteId}/{filename}"（与 Lake 资源的 note-assets/{noteId}/{file} 同构）。 */
export interface QuickNotesAssetFsDeps {
  /** 同步内存层（运行期字节真相；文件为持久层）。 */
  assetBytes: Map<string, Uint8Array>;
  /** 落盘（异步；调用方 fire-and-forget，失败不阻断同步主流程）。 */
  saveAssetFile(key: string, bytes: Uint8Array): Promise<void>;
  /** 读文件（缺失 → null）。 */
  loadAssetFile(key: string): Promise<Uint8Array | null>;
  /** 删除文件（幂等）。 */
  removeAssetFile(key: string): Promise<void>;
}

const quickNoteAssetKey = (id: string, filename: string): string => "quick-notes/" + id + "/" + filename;

/** P2 同步端口所需的 schema 增量（幂等应用：列缺失才 ALTER，表缺失才 CREATE）。 */
export function applyQuickNotesSyncSchema(d: DbLike): void {
  const qCols = (d.prepare("PRAGMA table_info(quick_notes)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!qCols.includes("deleted_at")) d.exec("ALTER TABLE quick_notes ADD COLUMN deleted_at TEXT");
  if (!qCols.includes("base_hash")) d.exec("ALTER TABLE quick_notes ADD COLUMN base_hash TEXT");
  // ready_to_sync：0 = 纯本地归档（冲突归档新 id，不向云端发布删除记录，防幽灵墓碑，对齐桌面）；1 = 可同步的删除墓碑
  if (!qCols.includes("ready_to_sync")) d.exec("ALTER TABLE quick_notes ADD COLUMN ready_to_sync INTEGER NOT NULL DEFAULT 1");
  d.exec(`CREATE TABLE IF NOT EXISTS quick_note_deleted (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT NOT NULL
  )`);
}

/** 端口实现：注入已打开的小记库（sql.js DbLike）+ 资产文件依赖，供 syncQuickNotesViaEngine 使用。 */
export function createQuickNotesSyncDbPort(d: DbLike, assetFs: QuickNotesAssetFsDeps): QuickNotesSyncDbPort {
  const { assetBytes, saveAssetFile, loadAssetFile, removeAssetFile } = assetFs;
  return {
    listLocalQuickNotes() {
      const rows = d.prepare("SELECT id, created_at, updated_at, content_hash, sync_state, is_conflict, content FROM quick_notes WHERE deleted_at IS NULL").all() as Array<Record<string, unknown>>;
      return rows.map((r) => {
        let images: QuickNoteSyncItemImage[] = [];
        try {
          const parsed = JSON.parse(String(r.content)) as StoredQuickNoteContent;
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
      });
    },
    readContent(id) {
      const row = d.prepare("SELECT content FROM quick_notes WHERE id=?").get(id) as { content: string } | undefined;
      return row ? new TextEncoder().encode(row.content) : null;
    },
    readAsset(id, filename) {
      // 纯文件为准（无 BLOB）：内存层优先，文件兜底（对齐 Lake readLocalAsset 模式）
      const key = quickNoteAssetKey(id, filename);
      return assetBytes.get(key) ?? loadAssetFile(key);
    },
    applyRemoteQuickNote(item, content, assets) {
      const text = new TextDecoder().decode(content);
      let parsed: StoredQuickNoteContent;
      try { parsed = validateQuickNoteContent(JSON.parse(text)); }
      catch (reason) { throw new Error(`远端小记内容无效: ${item.id}: ${(reason as Error).message}`); }
      const contentHash = sha256Sync(content);
      if (contentHash !== item.contentHash) throw new Error(`小记内容哈希不符: ${item.id}`);
      // 预校验图片齐全（在写 DB 前——原子性：任一缺失则整体失败，正文不落库，对齐桌面事务回滚语义）
      const byName = new Map(assets.map((a) => [a.filename, a]));
      for (const image of parsed.images) {
        if (!byName.get(image.filename)?.bytes) throw new Error("小记图片缺失: " + item.id + "/" + image.filename);
      }
      // 对齐桌面 importRemoteQuickNote：保留清单时间戳（LWW 依据）、冲突标记、直接置 synced（引擎收尾再记账）
      const tx = d.transaction(() => {
        d.prepare(
          "INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict, restore_pending_at, ready_to_sync) " +
          "VALUES (?,?,?,?,?,?,?, 'synced', ?, NULL, 1) " +
          "ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, content=excluded.content, sync_state=excluded.sync_state, is_conflict=excluded.is_conflict, restore_pending_at=NULL, deleted_at=NULL, ready_to_sync=1"
        ).run(item.id, item.createdAt, item.updatedAt, previewQuickNote(parsed.text, parsed.images.length), parsed.images.length, contentHash, text, item.isConflict ? 1 : 0);
      });
      tx();
      // 图片纯文件（无 BLOB）：写新图片（内存层 + fire-and-forget 落盘）。
      // 不做旧文件清理：与文档资源一致（每次上传/同步生成唯一新文件，旧文件由 GC/孤儿清理回收；冗余是设计理念）。
      for (const image of parsed.images) {
        const bytes = byName.get(image.filename)?.bytes;
        if (!bytes) throw new Error("小记图片缺失: " + item.id + "/" + image.filename);
        const key = quickNoteAssetKey(item.id, image.filename);
        assetBytes.set(key, bytes);
        void saveAssetFile(key, bytes).catch((e) => console.warn("[mobile-quick-sync] 小记图片落盘失败:", e));
      }
    },
    applyTombstoneContent(id, content) {
      const contentHash = sha256Sync(content);
      const tx = d.transaction(() => {
        d.prepare("UPDATE quick_notes SET content=?, content_hash=? WHERE id=?").run(new TextDecoder().decode(content), contentHash, id);
      });
      tx();
    },
    listDeletedQuickNoteAssets(id) {
      // 墓碑携带图片（A）：读软删保留的 content 列解析删除前图片元数据；行缺失/解析失败 → []
      const row = d.prepare("SELECT content FROM quick_notes WHERE id=?").get(id) as { content: string } | undefined;
      if (!row) return [];
      try {
        const parsed = JSON.parse(row.content) as StoredQuickNoteContent;
        return parsed.images.map(({ id: imageId, filename, mimeType, width, height, size, hash }) => ({ id: imageId, filename, mimeType, width, height, size, hash }));
      } catch { return []; }
    },
    applyTombstoneAssets(id, assets) {
      // 墓碑携带图片（A）：删除前图片字节落盘文件（软删行保留，恢复时图片完整；无 BLOB）。
      // 覆盖写：本机可能已有同 id 图片（此前同步过），墓碑携带的删除前最新字节应覆盖。
      for (const a of assets) {
        const key = quickNoteAssetKey(id, a.metadata.filename);
        assetBytes.set(key, a.bytes);
        void saveAssetFile(key, a.bytes).catch((e) => console.warn("[mobile-quick-sync] 墓碑图片落盘失败:", e));
      }
    },
    deleteLocalQuickNote(id) {
      d.prepare("UPDATE quick_notes SET deleted_at=?, restore_pending_at=NULL, sync_state='local', ready_to_sync=1 WHERE id=?").run(new Date().toISOString(), id);
    },
    archiveLocalQuickNoteToTrash(id) {
      const tx = d.transaction(() => {
        const row = d.prepare("SELECT created_at, preview_text, image_count, content_hash, content FROM quick_notes WHERE id=?").get(id) as { created_at: string; preview_text: string; image_count: number; content_hash: string; content: string } | undefined;
        if (!row) return;
        const newId = crypto.randomUUID();
        const now = new Date().toISOString();
        // ready_to_sync=0：纯本地归档，不向云端发布删除记录（其他端从未持有该 id，防幽灵墓碑，对齐桌面 archiveLocalToTrash）
        d.prepare("INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict, restore_pending_at, deleted_at, ready_to_sync) VALUES (?,?,?,?,?,?,?, 'local', 0, NULL, ?, 0)").run(newId, row.created_at, now, row.preview_text, row.image_count, row.content_hash, row.content, now);
        // 图片文件随归档迁移到新 id（内存层 + 落盘新键 + 清理旧键；无 BLOB）
        try {
          const parsed = JSON.parse(row.content) as StoredQuickNoteContent;
          for (const img of parsed.images) {
            const oldKey = quickNoteAssetKey(id, img.filename);
            const newKey = quickNoteAssetKey(newId, img.filename);
            const bytes = assetBytes.get(oldKey);
            if (bytes) {
              assetBytes.set(newKey, bytes);
              void saveAssetFile(newKey, bytes).catch(() => undefined);
            } else {
              void loadAssetFile(oldKey).then((b) => {
                if (!b) return;
                assetBytes.set(newKey, b);
                void saveAssetFile(newKey, b).catch(() => undefined);
              });
            }
            assetBytes.delete(oldKey);
            void removeAssetFile(oldKey).catch(() => undefined);
          }
        } catch { /* 内容解析失败：图片文件保持旧 id（归档回收站仍可读） */ }
      });
      tx();
    },
    listDeletedQuickNotes() {
      // ready_to_sync=1 才作为可同步墓碑；冲突归档（=0）纯本地保留不发布
      const local = d.prepare("SELECT id, created_at, updated_at, deleted_at FROM quick_notes WHERE deleted_at IS NOT NULL AND ready_to_sync=1").all() as Array<Record<string, unknown>>;
      const learned = d.prepare("SELECT id, created_at, updated_at, deleted_at FROM quick_note_deleted").all() as Array<Record<string, unknown>>;
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
    listDeferredDeletedQuickNotes() { return []; }, // 移动端无小记→笔记转换
    rememberDeletedQuickNote(item) {
      d.prepare("INSERT OR REPLACE INTO quick_note_deleted (id, created_at, updated_at, deleted_at) VALUES (?,?,?,?)").run(item.id, item.createdAt, item.updatedAt, item.deletedAt);
    },
    revokeLocalDeletion(id) {
      const tx = d.transaction(() => {
        d.prepare("UPDATE quick_notes SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL").run(id);
        d.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(id);
      });
      tx();
    },
    isRestorePending(id) {
      const row = d.prepare("SELECT restore_pending_at FROM quick_notes WHERE id=?").get(id) as { restore_pending_at: string | null } | undefined;
      return row ? row.restore_pending_at !== null : false;
    },
    baseHash(id) {
      const row = d.prepare("SELECT base_hash FROM quick_notes WHERE id=?").get(id) as { base_hash: string | null } | undefined;
      return row ? row.base_hash : null;
    },
    setBaseHash(id, contentHash) {
      d.prepare("UPDATE quick_notes SET base_hash=? WHERE id=?").run(contentHash, id);
    },
    markSynced(id) {
      // restore_pending_at 一并清除：恢复已生效后残留标记会让本设备永远 local-wins（墓碑永胜被破坏）。
      d.prepare("UPDATE quick_notes SET sync_state='synced', restore_pending_at=NULL WHERE id=?").run(id);
    },
    log(msg) {
      console.log("[mobile-quick-sync]", msg);
    },
  };
}
