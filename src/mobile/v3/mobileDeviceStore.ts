import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "../../core/s3v3DeviceStore.js";
import type { LakeFolderEntry, LakeNoteEntry, QuickNoteEntry, QuickNoteTagEntry, QuickNotesIndex } from "../../core/s3v3Index.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import type { MobileDb } from "../data/sqliteDb.js";
import { deleteNoteBodies, deleteQuickNoteBody, readNoteBody, readQuickNoteBody, writeNoteBody, writeQuickNoteBody } from "../data/noteBodies.js";
import { ensureV3StateTable, loadV3State, saveV3State, type MobileV3Baseline } from "../data/v3StateRepository.js";
import { listNoteAssetKeysFs, listQuickNoteAssetKeysFs, loadAssetBytesFs, removeAssetBytesFs, saveAssetBytesFs } from "../native/assetFs.js";
import { createNote, saveNote } from "../data/noteRepository.js";

/**
 * 移动端 S3v3DeviceStore v1（Lake 文档；无附件/小记/目录写入）。
 * - 元数据/正文：notes 表 + BodyStore（与旧移动同步同源）；
 * - 同步账本：sync_v3_state（baseline/intents/pending/remotePurged/restorePending/assetsHash）。
 * - 目录：只读映射；写入目录变更会抛错（v1 明确不支持，不静默）。
 * - 附件/小记：写入抛错/读出空；接入前不得把真实带资产/小记的库切到 v3。
 */

interface NoteRow {
  id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string;
  content_hash: string | null; is_conflict: number; is_locked: number; icon: string | null; doc_kind: string | null;
  trashed_at: string | null; deleted_from_parent_id: string | null; restore_pending_at: string | null;
}
interface FolderRow {
  id: string; title: string; parent_id: string | null; sort_order: number; node_type: string;
  icon: string | null; updated_at: string; trashed_at: string | null; deleted_from_parent_id: string | null;
}

export class MobileDeviceStore implements S3v3DeviceStore {
  private readonly db: MobileDb;
  private stagedBodies = new Map<string, Uint8Array>();
  private stagedDeletes = new Set<string>();
  private stagedQuickBodies = new Map<string, Uint8Array>();
  private stagedQuickDeletes = new Set<string>();

  constructor(db: MobileDb) { this.db = db; }

  async init(): Promise<void> { await ensureV3StateTable(this.db); }

  private async kindOf(id: string): Promise<NoteKind> {
    const row = await this.db.prepare("SELECT doc_kind FROM notes WHERE id=?").get(id) as { doc_kind?: string | null } | undefined;
    return normalizeNoteKind(row?.doc_kind);
  }

  async loadState(): Promise<DeviceState | null> {
    const side = await loadV3State(this.db);
    const rows = await this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,content_hash,is_conflict,is_locked,icon,doc_kind,trashed_at,deleted_from_parent_id,restore_pending_at FROM notes ORDER BY id"
    ).all() as unknown as NoteRow[];
    const notes: LakeNoteEntry[] = [];
    const restorePending = new Set(side.restorePending);
    for (const r of rows) {
      const kind = normalizeNoteKind(r.doc_kind);
      let contentHash = r.content_hash ?? "";
      if (!contentHash) {
        const content = await readNoteBody(kind, r.id);
        if (content != null) contentHash = sha256Sync(new TextEncoder().encode(content));
      }
      if (!contentHash) continue;
      if (r.restore_pending_at) restorePending.add(r.id);
      notes.push({
        id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order, updatedAt: r.updated_at, contentHash,
        ...(kind !== "doc" ? { kind } : {}), ...(r.icon !== null ? { icon: r.icon } : {}),
        isLocked: !!r.is_locked, lockedAt: null, isConflict: !!r.is_conflict,
        ...(r.trashed_at ? { trashedAt: r.trashed_at } : {}),
        ...(r.deleted_from_parent_id !== null ? { deletedFromParentId: r.deleted_from_parent_id } : {}),
        ...(side.assetsHash[r.id] ? { assetsHash: side.assetsHash[r.id] } : {}),
      });
    }
    const folderRows = await this.db.prepare(
      "SELECT id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id FROM folders ORDER BY id"
    ).all() as unknown as FolderRow[];
    const folders: LakeFolderEntry[] = folderRows.map((f) => ({
      id: f.id, title: f.title, parentId: f.parent_id, sortOrder: f.sort_order,
      nodeType: f.node_type === "group" ? "group" : "notebook", icon: f.icon, updatedAt: f.updated_at,
      ...(f.trashed_at ? { trashedAt: f.trashed_at } : {}),
      ...(f.deleted_from_parent_id !== null ? { deletedFromParentId: f.deleted_from_parent_id } : {}),
    }));
    const qRows = await this.db.prepare(
      "SELECT q.id,q.created_at,q.updated_at,q.content_hash,q.is_conflict,COALESCE(v.links_updated_at,'') AS tags_updated_at FROM quick_notes q LEFT JOIN tag_link_versions v ON v.target_kind='quickNote' AND v.target_id=q.id WHERE q.deleted_at IS NULL ORDER BY q.id"
    ).all() as unknown as Array<{ id: string; created_at: string; updated_at: string; content_hash: string; is_conflict: number; tags_updated_at: string }>;
    const tagRows = await this.db.prepare(
      "SELECT id,name,sort_order,created_at,updated_at FROM tags WHERE deleted_at IS NULL ORDER BY sort_order,id"
    ).all() as unknown as Array<{ id: string; name: string; sort_order: number; created_at: string; updated_at: string }>;
    const linkRows = await this.db.prepare("SELECT target_id,tag_id,position FROM tag_links WHERE target_kind='quickNote' ORDER BY target_id,position").all() as unknown as Array<{ target_id: string; tag_id: string; position: number }>;
    const links = new Map<string, string[]>();
    for (const l of linkRows) { const arr = links.get(l.target_id) ?? []; arr.push(l.tag_id); links.set(l.target_id, arr); }
    const tags: QuickNoteTagEntry[] = tagRows.map((t) => ({ id: t.id, name: t.name, order: t.sort_order, createdAt: t.created_at, updatedAt: t.updated_at }));
    const quickItems: QuickNoteEntry[] = qRows.map((q) => ({
      id: q.id, createdAt: q.created_at, updatedAt: q.updated_at, contentHash: q.content_hash,
      isConflict: !!q.is_conflict,
      ...(side.assetsHash[q.id] ? { assetsHash: side.assetsHash[q.id] } : {}),
      ...(links.has(q.id) ? { tagIds: links.get(q.id) } : {}),
      ...(q.tags_updated_at ? { tagsUpdatedAt: q.tags_updated_at } : {}),
    }));
    const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items: quickItems, tags };
    return {
      lake: { v: 3, space: "lake", notes, folders }, quickNotes, folders,
      intents: side.intents, pending: side.pending,
      remotePurged: side.remotePurged, restorePending: [...restorePending], archived: [],
    };
  }

  async saveState(state: DeviceState): Promise<void> {
    const currentRows = await this.db.prepare("SELECT id,title,parent_id,sort_order,trashed_at FROM notes").all() as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; trashed_at: string | null }>;
    const current = new Map(currentRows.map((r) => [r.id, r]));
    const wanted = new Map(state.lake.notes.map((n) => [n.id, n]));
    for (const n of wanted.values()) {
      const cur = current.get(n.id);
      const kind = normalizeNoteKind(n.kind);
      let content: string | null = null;
      if (this.stagedBodies.has(n.id)) content = new TextDecoder().decode(this.stagedBodies.get(n.id));
      if (!cur) {
        await createNote(this.db, n.id, n.title, content ?? "", n.parentId, new Map(), undefined, kind);
        current.set(n.id, { id: n.id, title: n.title, parent_id: n.parentId, sort_order: n.sortOrder, trashed_at: n.trashedAt ?? null });
      } else {
        const targetTrashed = !!n.trashedAt;
        const curTrashed = !!cur.trashed_at;
        if (targetTrashed && !curTrashed) {
          await this.db.prepare("UPDATE notes SET trashed_at=?, is_dirty=1, restore_pending_at=NULL WHERE id=?").run(n.trashedAt, n.id);
        } else if (!targetTrashed && curTrashed) {
          await this.db.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, is_dirty=1, parent_id=COALESCE(?, parent_id) WHERE id=?").run(new Date().toISOString(), n.parentId, n.id);
        } else if (!targetTrashed) {
          if (content !== null) {
            await saveNote(this.db, n.id, n.title, content, n.parentId, new Map());
            // 远端正文落地必须保留远端 updatedAt（saveNote 会写 now，导致下一轮误判本地更新）
            await this.db.prepare("UPDATE notes SET updated_at=?, is_dirty=0 WHERE id=?").run(n.updatedAt, n.id);
          } else if (n.title !== cur.title || (n.parentId ?? null) !== (cur.parent_id ?? null)) {
            await this.db.prepare("UPDATE notes SET title=?, parent_id=COALESCE(?, parent_id), sort_order=?, updated_at=? WHERE id=?").run(n.title, n.parentId, n.sortOrder, n.updatedAt, n.id);
          }
        }
      }
      // 图标/锁/排序等元数据（不与正文写冲突）
      await this.db.prepare("UPDATE notes SET icon=?, is_locked=?, sort_order=? WHERE id=?").run(n.icon ?? null, n.isLocked ? 1 : 0, n.sortOrder, n.id);
    }
    for (const [id, cur] of current) {
      if (wanted.has(id)) continue;
      // 本地彻底删除：写 deleted_notes 墓碑 + 删行 + 删正文（与旧移动 purge 语义一致）
      await this.db.prepare(
        "INSERT INTO deleted_notes (id,title,parent_id,sort_order,updated_at,deleted_at,node_type,purged_at) VALUES (?,?,?,?,?,?,'note',?) ON CONFLICT(id) DO UPDATE SET purged_at=excluded.purged_at"
      ).run(id, cur.title, cur.parent_id, cur.sort_order, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
      await this.db.prepare("DELETE FROM notes WHERE id=?").run(id);
      await deleteNoteBodies(id);
    }
    // 小记：按 state upsert/删除 + 标签关系 + 标签目录
    const curQRows = await this.db.prepare("SELECT id FROM quick_notes WHERE deleted_at IS NULL").all() as unknown as Array<{ id: string }>;
    const curQ = new Set(curQRows.map((r) => r.id));
    const wantedQ = new Map(state.quickNotes.items.map((q) => [q.id, q]));
    for (const q of wantedQ.values()) {
      const bodyBytes = this.stagedQuickBodies.get(q.id);
      const body = bodyBytes ? new TextDecoder().decode(bodyBytes) : null;
      if (!curQ.has(q.id)) {
        if (body !== null) await writeQuickNoteBody(q.id, body);
        await this.db.prepare(
          "INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,restore_pending_at) VALUES (?,?,?,'',0,?,1,?,NULL)"
        ).run(q.id, q.createdAt, q.updatedAt, q.contentHash, q.isConflict ? 1 : 0);
      } else if (body !== null) {
        await writeQuickNoteBody(q.id, body);
        await this.db.prepare("UPDATE quick_notes SET updated_at=?, content_hash=?, is_dirty=1 WHERE id=?").run(q.updatedAt, q.contentHash, q.id);
      }
      await this.db.prepare("DELETE FROM tag_links WHERE target_kind='quickNote' AND target_id=?").run(q.id);
      const tagIds = q.tagIds ?? [];
      for (let i = 0; i < tagIds.length; i++) {
        await this.db.prepare("INSERT INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote',?,?,?) ON CONFLICT(target_kind,target_id,tag_id) DO UPDATE SET position=excluded.position").run(q.id, tagIds[i], i);
      }
      if (q.tagsUpdatedAt || tagIds.length > 0) {
        await this.db.prepare("INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES ('quickNote',?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at").run(q.id, q.tagsUpdatedAt ?? q.updatedAt);
      }
    }
    for (const id of curQ) {
      if (wantedQ.has(id)) continue;
      await this.db.prepare("DELETE FROM tag_links WHERE target_kind='quickNote' AND target_id=?").run(id);
      await this.db.prepare("DELETE FROM tag_link_versions WHERE target_kind='quickNote' AND target_id=?").run(id);
      await this.db.prepare("DELETE FROM quick_notes WHERE id=?").run(id);
      await deleteQuickNoteBody(id);
      for (const key of await listQuickNoteAssetKeysFs(id)) await removeAssetBytesFs(key);
    }
    for (const tag of state.quickNotes.tags ?? []) {
      await this.db.prepare(
        "INSERT INTO tags (id,name,sort_order,pinned,created_at,updated_at,deleted_at) VALUES (?,?,?,0,?,?,NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, updated_at=excluded.updated_at, deleted_at=NULL"
      ).run(tag.id, tag.name, tag.order ?? 0, tag.createdAt, tag.updatedAt);
    }
    // 目录：按 state 做 upsert/删除（v1 直接写 folders 表；树索引由旧移动通道/启动对账维护）
    const folderRows = await this.db.prepare("SELECT id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id FROM folders").all() as unknown as FolderRow[];
    const curFolders = new Map(folderRows.map((f) => [f.id, f]));
    const wantedFolders = new Map(state.folders.map((f) => [f.id, f]));
    for (const f of wantedFolders.values()) {
      if (curFolders.has(f.id)) {
        await this.db.prepare("UPDATE folders SET title=?,parent_id=?,sort_order=?,node_type=?,icon=?,updated_at=?,trashed_at=?,deleted_from_parent_id=?,is_dirty=1 WHERE id=?").run(
          f.title, f.parentId, f.sortOrder, f.nodeType, f.icon ?? null, f.updatedAt, f.trashedAt ?? null, f.deletedFromParentId ?? null, f.id,
        );
      } else {
        await this.db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty) VALUES (?,?,?,?,?,?,?,?,?,1)").run(
          f.id, f.title, f.parentId, f.sortOrder, f.nodeType, f.icon ?? null, f.updatedAt, f.trashedAt ?? null, f.deletedFromParentId ?? null,
        );
      }
    }
    for (const id of curFolders.keys()) if (!wantedFolders.has(id)) await this.db.prepare("DELETE FROM folders WHERE id=?").run(id);
    const side = await loadV3State(this.db);
    await saveV3State(this.db, {
      ...side,
      intents: state.intents, pending: state.pending,
      remotePurged: state.remotePurged ?? [], restorePending: state.restorePending ?? [],
      assetsHash: Object.fromEntries([...state.lake.notes, ...state.quickNotes.items].filter((n) => n.assetsHash).map((n) => [n.id, n.assetsHash!])),
    });
    this.stagedBodies.clear();
    this.stagedDeletes.clear();
    this.stagedQuickBodies.clear();
    this.stagedQuickDeletes.clear();
  }

  async loadBaseline(): Promise<DeviceBaseline | null> {
    const s = await loadV3State(this.db);
    return (s.baseline as DeviceBaseline | null) ?? null;
  }
  async saveBaseline(baseline: DeviceBaseline): Promise<void> {
    const s = await loadV3State(this.db);
    // 发布成功后才写 baseline：此时这些条目已与云端一致，必须清 UI 待同步标记；
    // 否则 is_dirty 永远停在 1（同步候选虽由三方比对得出，UI 会一直显示“待同步”）。
    const sets: Array<{ sql: string; ids: string[] }> = [
      { sql: "UPDATE notes SET is_dirty=0, restore_pending_at=NULL WHERE is_purged=0 AND id IN (", ids: baseline.lake.notes.map((n) => n.id) },
      { sql: "UPDATE folders SET is_dirty=0 WHERE is_purged=0 AND id IN (", ids: baseline.lake.folders.map((f) => f.id) },
      { sql: "UPDATE quick_notes SET is_dirty=0 WHERE id IN (", ids: baseline.quickNotes.items.map((q) => q.id) },
    ];
    await this.db.transaction(async () => {
      for (const { sql, ids } of sets) {
        for (let i = 0; i < ids.length; i += 400) {
          const part = ids.slice(i, i + 400);
          if (part.length === 0) continue;
          const ph = part.map(() => "?").join(",");
          await this.db.prepare(sql + ph + ")").run(...part);
        }
      }
    });
    await saveV3State(this.db, { ...s, baseline: baseline as MobileV3Baseline });
  }

  async readBody(id: string): Promise<Uint8Array | null> {
    const staged = this.stagedBodies.get(id);
    if (staged) return staged;
    if (this.stagedDeletes.has(id)) return null;
    const content = await readNoteBody(await this.kindOf(id), id);
    return content == null ? null : new TextEncoder().encode(content);
  }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> {
    if (this.stagedDeletes.has(id)) {
      // 正文写入即取消待删：先落盘再清标记，避免 saveState 误清空
      await writeNoteBody(await this.kindOf(id), id, new TextDecoder().decode(bytes));
    }
    this.stagedBodies.set(id, bytes);
  }
  async deleteBody(id: string): Promise<void> { this.stagedBodies.delete(id); this.stagedDeletes.add(id); }
  async writeHistory(): Promise<string> { return "mobile-v3-history-skip"; }
  async archiveBody(): Promise<void> { /* v1：历史归档由旧通道负责 */ }

  async listAssets(id: string): Promise<string[]> {
    const keys = await listNoteAssetKeysFs(id);
    return keys.map((k) => k.slice(id.length + 1)).sort();
  }
  async readAsset(id: string, filename: string): Promise<Uint8Array | null> {
    return await loadAssetBytesFs(id + "/" + filename);
  }
  async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    await saveAssetBytesFs(id + "/" + filename, bytes);
  }
  async deleteAssetsDir(id: string): Promise<void> {
    for (const key of await listNoteAssetKeysFs(id)) await removeAssetBytesFs(key);
  }

  async readQuickBody(id: string): Promise<Uint8Array | null> {
    const staged = this.stagedQuickBodies.get(id);
    if (staged) return staged;
    if (this.stagedQuickDeletes.has(id)) return null;
    const content = await readQuickNoteBody(id);
    return content == null ? null : new TextEncoder().encode(content);
  }
  async writeQuickBody(id: string, bytes: Uint8Array): Promise<void> {
    this.stagedQuickBodies.set(id, bytes);
    this.stagedQuickDeletes.delete(id);
  }
  async deleteQuickBody(id: string): Promise<void> {
    this.stagedQuickBodies.delete(id);
    this.stagedQuickDeletes.add(id);
  }
  async listQuickAssets(id: string): Promise<string[]> {
    const keys = await listQuickNoteAssetKeysFs(id);
    const prefix = "quick-notes/" + id + "/";
    return keys.map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k)).sort();
  }
  async readQuickAsset(id: string, filename: string): Promise<Uint8Array | null> {
    return await loadAssetBytesFs("quick-notes/" + id + "/" + filename);
  }
  async writeQuickAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    await saveAssetBytesFs("quick-notes/" + id + "/" + filename, bytes);
  }
  async deleteQuickAssetsDir(id: string): Promise<void> {
    for (const key of await listQuickNoteAssetKeysFs(id)) await removeAssetBytesFs(key);
  }
}
