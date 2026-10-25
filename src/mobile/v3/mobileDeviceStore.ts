import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "../../core/s3v3DeviceStore.js";
import type { LakeFolderEntry, LakeNoteEntry, QuickNotesIndex } from "../../core/s3v3Index.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import type { MobileDb } from "../data/sqliteDb.js";
import { deleteNoteBodies, readNoteBody, writeNoteBody } from "../data/noteBodies.js";
import { ensureV3StateTable, loadV3State, saveV3State, type MobileV3Baseline } from "../data/v3StateRepository.js";
import { listNoteAssetKeysFs, loadAssetBytesFs, removeAssetBytesFs, saveAssetBytesFs } from "../native/assetFs.js";
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
    const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items: [], tags: [] };
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
          await this.db.prepare("UPDATE notes SET trashed_at=?, sync_state='local', restore_pending_at=NULL WHERE id=?").run(n.trashedAt, n.id);
        } else if (!targetTrashed && curTrashed) {
          await this.db.prepare("UPDATE notes SET trashed_at=NULL, restore_pending_at=?, sync_state='local', parent_id=COALESCE(?, parent_id) WHERE id=?").run(new Date().toISOString(), n.parentId, n.id);
        } else if (!targetTrashed) {
          if (content !== null) await saveNote(this.db, n.id, n.title, content, n.parentId, new Map());
          else if (n.title !== cur.title || (n.parentId ?? null) !== (cur.parent_id ?? null)) {
            await this.db.prepare("UPDATE notes SET title=?, parent_id=COALESCE(?, parent_id), sort_order=? WHERE id=?").run(n.title, n.parentId, n.sortOrder, n.id);
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
    // 目录写入 v1 不支持：若与当前不一致，明确抛错
    const folderRows = await this.db.prepare("SELECT id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id FROM folders").all() as unknown as FolderRow[];
    const sameFolders = folderRows.length === state.folders.length && folderRows.every((f) => {
      const w = state.folders.find((x) => x.id === f.id);
      return w && w.title === f.title && (w.parentId ?? null) === (f.parent_id ?? null) && w.sortOrder === f.sort_order && w.nodeType === f.node_type && (w.icon ?? null) === (f.icon ?? null) && (w.updatedAt === f.updated_at);
    });
    if (!sameFolders) throw new Error("MobileDeviceStore v1: 目录写入尚未实现（拒绝静默）");
    const side = await loadV3State(this.db);
    await saveV3State(this.db, {
      ...side,
      intents: state.intents, pending: state.pending,
      remotePurged: state.remotePurged ?? [], restorePending: state.restorePending ?? [],
      assetsHash: Object.fromEntries(state.lake.notes.filter((n) => n.assetsHash).map((n) => [n.id, n.assetsHash!])),
    });
    this.stagedBodies.clear();
    this.stagedDeletes.clear();
  }

  async loadBaseline(): Promise<DeviceBaseline | null> {
    const s = await loadV3State(this.db);
    return (s.baseline as DeviceBaseline | null) ?? null;
  }
  async saveBaseline(baseline: DeviceBaseline): Promise<void> {
    const s = await loadV3State(this.db);
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

  async readQuickBody(): Promise<Uint8Array | null> { throw new Error("MobileDeviceStore v1: 小记尚未接入 v3"); }
  async writeQuickBody(): Promise<void> { throw new Error("MobileDeviceStore v1: 小记尚未接入 v3"); }
  async deleteQuickBody(): Promise<void> { throw new Error("MobileDeviceStore v1: 小记尚未接入 v3"); }
  async listQuickAssets(): Promise<string[]> { throw new Error("MobileDeviceStore v1: 小记尚未接入 v3"); }
  async readQuickAsset(): Promise<Uint8Array | null> { throw new Error("MobileDeviceStore v1: 小记尚未接入 v3"); }
  async writeQuickAsset(): Promise<void> { throw new Error("MobileDeviceStore v1: 小记尚未接入 v3"); }
  async deleteQuickAssetsDir(): Promise<void> { throw new Error("MobileDeviceStore v1: 小记尚未接入 v3"); }
}
