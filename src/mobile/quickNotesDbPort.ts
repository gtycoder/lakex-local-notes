/**
 * 移动端 Quick Notes 同步端口（quickNotesSyncEngine 的本地存储实现）。
 *
 * 独立于 bridge.ts 以便单测（注入 DbLike，不依赖 Capacitor/sql.js WASM 装载）：
 * - sql.js 单库方案：quick_notes 行 + content 列（序列化正文）+ quick_note_assets BLOB 图片；
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
  // P2-9（GPT 审计）：外键 + 级联清理（新建库生效；存量库无 FK 由应用层清理策略兜底：
  // applyRemoteQuickNote 覆盖时先 DELETE 旧资产；归档迁移资产；无硬删除路径）
  d.exec(`CREATE TABLE IF NOT EXISTS quick_note_assets (
    quick_note_id TEXT NOT NULL REFERENCES quick_notes(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    size INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    bytes BLOB NOT NULL,
    PRIMARY KEY (quick_note_id, id)
  )`);
  // 存量库可能是在外键约束加入前创建的，应用层清理孤儿资源，避免这些资源
  // 永远无法随小记删除而回收（新库仍由 ON DELETE CASCADE 负责）。
  d.exec("DELETE FROM quick_note_assets WHERE NOT EXISTS (SELECT 1 FROM quick_notes WHERE quick_notes.id = quick_note_assets.quick_note_id)");
}

/** 端口实现：注入已打开的小记库（sql.js DbLike），供 syncQuickNotesViaEngine 使用。 */
export function createQuickNotesSyncDbPort(d: DbLike): QuickNotesSyncDbPort {
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
      const row = d.prepare("SELECT bytes FROM quick_note_assets WHERE quick_note_id=? AND filename=?").get(id, filename) as { bytes: Uint8Array } | undefined;
      return row ? row.bytes : null;
    },
    applyRemoteQuickNote(item, content, assets) {
      const text = new TextDecoder().decode(content);
      let parsed: StoredQuickNoteContent;
      try { parsed = validateQuickNoteContent(JSON.parse(text)); }
      catch (reason) { throw new Error(`远端小记内容无效: ${item.id}: ${(reason as Error).message}`); }
      const contentHash = sha256Sync(content);
      if (contentHash !== item.contentHash) throw new Error(`小记内容哈希不符: ${item.id}`);
      // 对齐桌面 importRemoteQuickNote：保留清单时间戳（LWW 依据）、冲突标记、直接置 synced（引擎收尾再记账）
      const tx = d.transaction(() => {
        d.prepare(
          `INSERT INTO quick_notes (id, created_at, updated_at, preview_text, image_count, content_hash, content, sync_state, is_conflict, restore_pending_at, ready_to_sync)
           VALUES (?,?,?,?,?,?,?, 'synced', ?, NULL, 1)
           ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, updated_at=excluded.updated_at, preview_text=excluded.preview_text, image_count=excluded.image_count, content_hash=excluded.content_hash, content=excluded.content, sync_state=excluded.sync_state, is_conflict=excluded.is_conflict, restore_pending_at=NULL, deleted_at=NULL, ready_to_sync=1`
        ).run(item.id, item.createdAt, item.updatedAt, previewQuickNote(parsed.text, parsed.images.length), parsed.images.length, contentHash, text, item.isConflict ? 1 : 0);
        d.prepare("DELETE FROM quick_note_assets WHERE quick_note_id=?").run(item.id);
        const byId = new Map(assets.map((a) => [a.filename, a]));
        const insert = d.prepare("INSERT INTO quick_note_assets (quick_note_id, id, filename, mime_type, width, height, size, content_hash, bytes) VALUES (?,?,?,?,?,?,?,?,?)");
        for (const image of parsed.images) {
          const bytes = byId.get(image.filename)?.bytes;
          if (!bytes) throw new Error(`小记图片缺失: ${item.id}/${image.filename}`);
          insert.run(item.id, image.id, image.filename, image.mimeType, image.width, image.height, image.size, image.hash, bytes);
        }
      });
      tx();
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
      // 墓碑携带图片（A）：删除前图片字节写 BLOB（软删行保留，恢复时图片完整）。
      // INSERT OR REPLACE：本机可能已有同 id 图片（此前同步过），墓碑携带的删除前最新字节应覆盖。
      const tx = d.transaction(() => {
        const insert = d.prepare("INSERT OR REPLACE INTO quick_note_assets (quick_note_id, id, filename, mime_type, width, height, size, content_hash, bytes) VALUES (?,?,?,?,?,?,?,?,?)");
        for (const a of assets) {
          insert.run(id, a.metadata.id, a.metadata.filename, a.metadata.mimeType, a.metadata.width, a.metadata.height, a.metadata.size, a.metadata.hash, a.bytes);
        }
      });
      tx();
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
        d.prepare("UPDATE quick_note_assets SET quick_note_id=? WHERE quick_note_id=?").run(newId, id);
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
