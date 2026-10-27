import type { DeviceBaseline, DeviceState, S3v3DeviceStore } from "../../core/s3v3DeviceStore.js";
import type { LakeFolderEntry, LakeNoteEntry, QuickNoteEntry, QuickNoteTagEntry, QuickNotesIndex } from "../../core/s3v3Index.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import { executeBatch, type MobileDb } from "../data/sqliteDb.js";
import { deleteNoteBodies, deleteQuickNoteBody, readNoteBody, readNoteBodiesBatch, readQuickNoteBody, statNoteBodiesBatch, statQuickNoteBodiesBatch, writeNoteBody, writeNoteBodiesBatch, writeQuickNoteBody } from "../data/noteBodies.js";
import { ensureV3StateTable, loadV3State, saveV3State, type MobileV3Baseline } from "../data/v3StateRepository.js";
import { listNoteAssetKeysFs, listQuickNoteAssetKeysFs, loadAssetBytesFs, removeAssetBytesFs, saveAssetBytesFs } from "../native/assetFs.js";
import { NativeAssetSync, nativeAssetSyncSupported } from "../native/nativeAssetSync.js";
import { saveNote, type NoteWriteOptions } from "../data/noteRepository.js";
import * as historyRepository from "../data/historyRepository.js";
import { HISTORY_SNAPSHOT_PROTECT_DAYS } from "../../core/syncEngineTypes.js";

/**
 * 移动端 S3v3DeviceStore v1（Lake 文档；无附件/小记/目录写入）。
 * - 元数据/正文：notes 表 + BodyStore（与旧移动同步同源）；
 * - 同步账本：sync_v3_state（baseline/intents/pending/remotePurged/restorePending/assetsHash）。
 * - 「云端已删除·仅本地」：state.remotePurged ↔ notes/folders/quick_notes.cloud_deleted（DB 投影，UI 徽标读它）；
 *   小记副本保留在 quick 回收站（deleted_at 非空、正文/图片/标签不删），恢复并上传成功后清空标记。
 * - 目录：只读映射；写入目录变更会抛错（v1 明确不支持，不静默）。
 * - 附件/小记：写入抛错/读出空；接入前不得把真实带资产/小记的库切到 v3。
 */

interface NoteRow {
  id: string; title: string; parent_id: string | null; sort_order: number; updated_at: string;
  content_hash: string | null; is_conflict: number; is_locked: number; icon: string | null; doc_kind: string | null;
  trashed_at: string | null; deleted_from_parent_id: string | null; restore_pending_at: string | null;
  cloud_deleted: number;
}
interface FolderRow {
  id: string; title: string; parent_id: string | null; sort_order: number; node_type: string;
  icon: string | null; updated_at: string; trashed_at: string | null; deleted_from_parent_id: string | null;
  cloud_deleted: number;
}

/** 桥层量化开关（诊断用）：localStorage["lake.bridgePerf"]="1" 时把批量桥耗时打到 console。 */
function bridgePerfEnabled(): boolean {
  try { return globalThis.localStorage?.getItem("lake.bridgePerf") === "1"; } catch { return false; }
}
function bridgePerfLog(parts: Record<string, unknown>): void {
  if (bridgePerfEnabled()) console.info("[bridge-perf] " + JSON.stringify(parts));
}

export class MobileDeviceStore implements S3v3DeviceStore {
  private readonly db: MobileDb;
  private stagedBodies = new Map<string, Uint8Array>();
  private stagedDeletes = new Set<string>();
  private stagedQuickBodies = new Map<string, Uint8Array>();
  private stagedQuickDeletes = new Set<string>();
  /** 同步期兜底创建/复用的目录（未进远端索引）：同轮 deleteMissing 不得删，否则文档父级悬空。 */
  private readonly protectedFolderIds = new Set<string>();
  /**
   * 本地资产名缓存（261026）：一次原生 listAllAssets 替代「每篇一次 readdir 桥」。
   * 同步期间资产目录只增不减（下载走原生直写，不走 writeAsset），缓存足够用来算差集；
   * 本地新增/删除资产（writeAsset/deleteAssetsDir）会让缓存失效。
   */
  private assetNames: Promise<{ notes: Map<string, string[]>; quick: Map<string, string[]> }> | null = null;

  /**
   * 同步批量导入的写路径：派生索引（FTS）交给同步结束后的 reconcileIndex、孤儿扫描交给资产流水线、
   * 正文直接来自云端权威数据不做读盘比对。首拉 2k 篇时这三项是每篇都要做的重活。
   */
  // 同步导入不逐篇建 FTS（正文阶段省 ~60s）：派生索引由「同步结束后台补 + 冷启动/回前台自愈」
  // 两条路径保证（bridge.ensureSearchIndex，幂等可续跑；进程被杀下次进入继续）。
  // 另两项对远端导入无意义：读旧正文比较、孤儿扫描。
  private static readonly SYNC_IMPORT_WRITE: NoteWriteOptions = { skipSearchIndex: true, skipOrphanScan: true, skipChangeCheck: true };

  constructor(db: MobileDb) { this.db = db; }

  async init(): Promise<void> { await ensureV3StateTable(this.db); }

  private async kindOf(id: string): Promise<NoteKind> {
    const row = await this.db.prepare("SELECT doc_kind FROM notes WHERE id=?").get(id) as { doc_kind?: string | null } | undefined;
    return normalizeNoteKind(row?.doc_kind);
  }

  async loadState(): Promise<DeviceState | null> {
    const side = await loadV3State(this.db);
    // 升级/历史数据兜底（261026 真机数据事故）：assetsHash 是后加的账本字段，旧版本或未落盘的轮次里可能为空，
    // 而 baseline 里的索引必然带着它。只看 side 会把「本地附件还没下下来」误判成「用户删光了附件」，
    // 上传时清空声明 → 旧附件被当孤儿物理删除。这里以 side 为准、baseline 兜底。
    const baselineAssets = new Map<string, string>();
    for (const n of side.baseline?.lake.notes ?? []) if (n.assetsHash) baselineAssets.set(n.id, n.assetsHash);
    for (const q of side.baseline?.quickNotes.items ?? []) if (q.assetsHash) baselineAssets.set(q.id, q.assetsHash);
    const assetsHashOf = (id: string): string | undefined => side.assetsHash[id] ?? baselineAssets.get(id);
    const rows = await this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,content_hash,is_conflict,is_locked,icon,doc_kind,trashed_at,deleted_from_parent_id,restore_pending_at,cloud_deleted FROM notes ORDER BY id"
    ).all() as unknown as NoteRow[];
    const notes: LakeNoteEntry[] = [];
    const restorePending = new Set(side.restorePending);
    const purged = new Set(side.remotePurged);
    for (const r of rows) {
      const kind = normalizeNoteKind(r.doc_kind);
      let contentHash = r.content_hash ?? "";
      if (!contentHash) {
        const content = await readNoteBody(kind, r.id);
        if (content != null) contentHash = sha256Sync(new TextEncoder().encode(content));
      }
      if (!contentHash) continue;
      if (r.restore_pending_at) restorePending.add(r.id);
      if (r.cloud_deleted === 1) purged.add(r.id);
      notes.push({
        id: r.id, title: r.title, parentId: r.parent_id, sortOrder: r.sort_order, updatedAt: r.updated_at, contentHash,
        ...(kind !== "doc" ? { kind } : {}), ...(r.icon !== null ? { icon: r.icon } : {}),
        isLocked: !!r.is_locked, lockedAt: null, isConflict: !!r.is_conflict,
        ...(r.trashed_at ? { trashedAt: r.trashed_at } : {}),
        ...(r.deleted_from_parent_id !== null ? { deletedFromParentId: r.deleted_from_parent_id } : {}),
        ...(assetsHashOf(r.id) ? { assetsHash: assetsHashOf(r.id) } : {}),
      });
    }
    const folderRows = await this.db.prepare(
      "SELECT id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,cloud_deleted FROM folders ORDER BY id"
    ).all() as unknown as FolderRow[];
    const folders: LakeFolderEntry[] = folderRows.map((f) => {
      if (f.cloud_deleted === 1) purged.add(f.id);
      return {
        id: f.id, title: f.title, parentId: f.parent_id, sortOrder: f.sort_order,
        nodeType: f.node_type === "group" ? "group" : "notebook", icon: f.icon, updatedAt: f.updated_at,
        ...(f.trashed_at ? { trashedAt: f.trashed_at } : {}),
        ...(f.deleted_from_parent_id !== null ? { deletedFromParentId: f.deleted_from_parent_id } : {}),
      };
    });
    // 小记：活跃行 + 「云端已删除·仅本地」的回收站副本。副本必须作为 state 条目存在（引擎按
    // remotePurged 过滤：不进同步索引、不上传，但保留在 state.quickNotes.items 里才能跨轮存活）。
    const qRows = await this.db.prepare(
      "SELECT q.id,q.created_at,q.updated_at,q.content_hash,q.is_conflict,q.restore_pending_at,q.cloud_deleted,COALESCE(v.links_updated_at,'') AS tags_updated_at FROM quick_notes q LEFT JOIN tag_link_versions v ON v.target_kind='quickNote' AND v.target_id=q.id WHERE q.deleted_at IS NULL OR q.cloud_deleted=1 ORDER BY q.id"
    ).all() as unknown as Array<{ id: string; created_at: string; updated_at: string; content_hash: string; is_conflict: number; restore_pending_at: string | null; cloud_deleted: number; tags_updated_at: string }>;
    const tagRows = await this.db.prepare(
      "SELECT id,name,sort_order,created_at,updated_at FROM tags WHERE deleted_at IS NULL ORDER BY sort_order,id"
    ).all() as unknown as Array<{ id: string; name: string; sort_order: number; created_at: string; updated_at: string }>;
    const linkRows = await this.db.prepare("SELECT target_id,tag_id,position FROM tag_links WHERE target_kind='quickNote' ORDER BY target_id,position").all() as unknown as Array<{ target_id: string; tag_id: string; position: number }>;
    const links = new Map<string, string[]>();
    for (const l of linkRows) { const arr = links.get(l.target_id) ?? []; arr.push(l.tag_id); links.set(l.target_id, arr); }
    const tags: QuickNoteTagEntry[] = tagRows.map((t) => ({ id: t.id, name: t.name, order: t.sort_order, createdAt: t.created_at, updatedAt: t.updated_at }));
    const quickItems: QuickNoteEntry[] = qRows.map((q) => {
      if (q.restore_pending_at) restorePending.add(q.id);
      if (q.cloud_deleted === 1) purged.add(q.id);
      return {
        id: q.id, createdAt: q.created_at, updatedAt: q.updated_at, contentHash: q.content_hash,
        isConflict: !!q.is_conflict,
        ...(assetsHashOf(q.id) ? { assetsHash: assetsHashOf(q.id) } : {}),
        ...(links.has(q.id) ? { tagIds: links.get(q.id) } : {}),
        ...(q.tags_updated_at ? { tagsUpdatedAt: q.tags_updated_at } : {}),
      };
    });
    // 本地进入回收站（未打云端删除标）的小记 → 引擎用它区分「本地删除」与「远端新增」，避免误判后者。
    const quickDeleteRows = await this.db.prepare("SELECT id FROM quick_notes WHERE deleted_at IS NOT NULL AND cloud_deleted=0").all() as Array<{ id: string }>;
    // quick_note_deleted 同时装「软删/远端学习墓碑」（purged_at 为空）与「本地彻底删除墓碑」（purged_at 非空）：
    // 前者属于 quickDeletes（可恢复语义），只有后者才是 v3 quickPurges（不可恢复删除、不复活）。
    const quickSoftTombstones = await this.db.prepare("SELECT id FROM quick_note_deleted WHERE purged_at IS NULL").all() as Array<{ id: string }>;
    const quickPurgeRows = await this.db.prepare("SELECT id,purged_at FROM quick_note_deleted WHERE purged_at IS NOT NULL").all() as Array<{ id: string; purged_at: string | null }>;
    // 本地 purge 墓碑（文档/目录）→ v3 删除意图：否则云端条目会被当成本地缺失重新拉回。
    const purgedTombstones = await this.db.prepare("SELECT id,purged_at FROM deleted_notes WHERE purged_at IS NOT NULL").all() as Array<{ id: string; purged_at: string | null }>;
    const intents: DeviceState["intents"] = [...side.intents];
    const knownIntents = new Set(intents.map((it) => it.noteId));
    for (const t of purgedTombstones) {
      if (knownIntents.has(t.id)) continue;
      knownIntents.add(t.id);
      intents.push({
        noteId: t.id, targetEpoch: side.baseline?.epoch ?? "", targetGeneration: side.baseline?.generation ?? 0,
        ...(t.purged_at ? { purgedAt: t.purged_at } : {}),
      });
    }
    // 标记失效的三种情形（与引擎 resolveRemotePurged 同口径，适配器侧再兜一次）：
    // 本地已彻底删除（副本不存在）、显式恢复（让位给正常上传）、远端已重新出现（引擎负责）。
    const quickPurges = quickPurgeRows.map((r) => r.id);
    const quickPurgeTimes = Object.fromEntries(quickPurgeRows.filter((r) => r.purged_at).map((r) => [r.id, r.purged_at!]));
    for (const id of quickPurges) purged.delete(id);
    for (const t of purgedTombstones) purged.delete(t.id);
    for (const id of restorePending) purged.delete(id);
    const quickNotes: QuickNotesIndex = { v: 3, space: "quickNotes", items: quickItems, tags };
    return {
      lake: { v: 3, space: "lake", notes, folders }, quickNotes, folders,
      intents, pending: side.pending,
      remotePurged: [...purged].sort(), restorePending: [...restorePending].sort(),
      quickDeletes: [...quickDeleteRows.map((r) => r.id), ...quickSoftTombstones.map((r) => r.id)].sort(),
      quickPurges, quickPurgeTimes, archived: [],
    };
  }

  async saveState(state: DeviceState): Promise<void> {
    const side = await loadV3State(this.db);
    // 本轮「云端已彻底删除·仅本地」集合：引擎（state.remotePurged）是权威，适配器只把它投影到 DB 列。
    const purged = new Set(state.remotePurged ?? []);
    // 目录必须先于文档落库：他端新建的笔记本/分组 id 在本机还不存在时，
    // 文档 parent 兜底（C5）才有目录可用；删除目录放最后（避免先删父导致子文档悬空）。
    await this.upsertSyncFolders(state.folders);
    const currentRows = await this.db.prepare(
      "SELECT id,title,parent_id,sort_order,trashed_at,icon,is_locked,content_hash,updated_at FROM notes"
    ).all() as Array<{ id: string; title: string; parent_id: string | null; sort_order: number; trashed_at: string | null; icon: string | null; is_locked: number; content_hash: string | null; updated_at: string }>;
    const current = new Map(currentRows.map((r) => [r.id, r]));
    const wanted = new Map(state.lake.notes.map((n) => [n.id, n]));
    // 首拉分块每落一次库都会遍历全表：父目录解析按 id 缓存，无变化的行一条 SQL 都不发。
    // （否则 2k 篇 × 21 块 ≈ 8.6 万条 UPDATE + 同样多的 folders 查询 —— 真机上正文阶段几分钟的纯开销。）
    const parentCache = new Map<string, string | null>();
    const resolveParentCached = async (pid: string | null): Promise<string | null> => {
      if (pid === null) return null;
      const hit = parentCache.get(pid);
      if (hit !== undefined) return hit;
      const v = await this.resolveSyncNoteParent(pid);
      parentCache.set(pid, v);
      return v;
    };
    // 首拉新建行的批量通道（261026）：正文一次批量落盘 + 一批 INSERT/UPDATE 一次 executeSet
    // 下发，替代「每篇 1 次 BodyStore 桥 + 1 次 CapacitorSQLite 桥」。
    const createBatch: Array<{ n: LakeNoteEntry; kind: NoteKind; resolvedParentId: string | null; content: string }> = [];
    for (const n of wanted.values()) {
      const cur = current.get(n.id);
      const kind = normalizeNoteKind(n.kind);
      let content: string | null = null;
      if (this.stagedBodies.has(n.id)) content = new TextDecoder().decode(this.stagedBodies.get(n.id));
      const targetTrashed = !!n.trashedAt;
      // C5：远端 parent 可能是本机还没有/已删的目录（首拉父未落库）——不得直接落库；
      // 非法父回落兜底笔记本（懒建「未分类」）。回收站条目不解析（移动端用 trashed_at 表示）。
      const resolvedParentId = targetTrashed ? (n.deletedFromParentId ?? null) : await resolveParentCached(n.parentId);
      if (!cur) {
        // P0-2 分块应用：正文还没下到的条目先不建行（否则先落一个空正文），等它的分块/下一轮。
        if (content === null) continue;
        createBatch.push({ n, kind, resolvedParentId, content });
        continue;
      } else {
        const curTrashed = !!cur.trashed_at;
        if (targetTrashed && !curTrashed) {
          await this.db.prepare("UPDATE notes SET trashed_at=?, is_dirty=1, restore_pending_at=NULL WHERE id=?").run(n.trashedAt, n.id);
          cur.trashed_at = n.trashedAt ?? null;
        } else if (!targetTrashed && curTrashed) {
          // 远端恢复/复活 → 移出回收站。restore_pending_at 保持原值：用户显式恢复在 DB 里已经写过这个标记，
          // 而「远端把条目恢复回来」不是本地显式恢复 —— 不能给它补标记，否则会误把自己的旧副本上传覆盖远端。
          await this.db.prepare("UPDATE notes SET trashed_at=NULL, is_dirty=1, parent_id=COALESCE(?, parent_id) WHERE id=?").run(resolvedParentId, n.id);
          cur.trashed_at = null;
        } else if (!targetTrashed) {
          if (content !== null) {
            await saveNote(this.db, n.id, n.title, content, resolvedParentId, new Map(), undefined, MobileDeviceStore.SYNC_IMPORT_WRITE);
            // 远端正文落地必须保留远端 updatedAt（saveNote 会写 now，导致下一轮误判本地更新）
            await this.db.prepare("UPDATE notes SET updated_at=?, is_dirty=0 WHERE id=?").run(n.updatedAt, n.id);
            cur.content_hash = n.contentHash;
            cur.updated_at = n.updatedAt;
            cur.title = n.title;
            if (resolvedParentId !== null) cur.parent_id = resolvedParentId;
          } else if (n.title !== cur.title || resolvedParentId !== (cur.parent_id ?? null)) {
            await this.db.prepare("UPDATE notes SET title=?, parent_id=COALESCE(?, parent_id), sort_order=?, updated_at=? WHERE id=?").run(n.title, resolvedParentId, n.sortOrder, n.updatedAt, n.id);
            cur.title = n.title;
            if (resolvedParentId !== null) cur.parent_id = resolvedParentId;
            cur.sort_order = n.sortOrder;
            cur.updated_at = n.updatedAt;
          }
        }
      }
      const rowNow = current.get(n.id);
      const metadataChanged = !cur || (rowNow !== undefined && (
        (rowNow.icon ?? null) !== (n.icon ?? null)
        || (rowNow.is_locked ? 1 : 0) !== (n.isLocked ? 1 : 0)
        || rowNow.sort_order !== n.sortOrder
      ));
      // 图标/锁/排序等元数据（不与正文写冲突）：无变化的行不再发 SQL。
      if (metadataChanged && rowNow !== undefined) {
        await this.db.prepare("UPDATE notes SET icon=?, is_locked=?, sort_order=? WHERE id=?").run(n.icon ?? null, n.isLocked ? 1 : 0, n.sortOrder, n.id);
        rowNow.icon = n.icon ?? null;
        rowNow.is_locked = n.isLocked ? 1 : 0;
        rowNow.sort_order = n.sortOrder;
      }
    }
    // 新建行批量落库：先批量写正文（一次原生调用），再一批 SQL（一次 executeSet）建行 + 元数据。
    if (createBatch.length > 0) {
      const bodiesStartedAt = Date.now();
      // 同步导入：durable=false（原子 rename 保留、跳过逐文件 fsync）。真机实测 100 篇批量写 ~800ms，
      // 主要是 100 次 fsync；进程被杀不丢（页缓存），断电可由云端同内容自愈。
      await writeNoteBodiesBatch(createBatch.map((c) => ({ kind: c.kind, id: c.n.id, content: c.content })), { durable: false });
      const bodiesMs = Date.now() - bodiesStartedAt;
      const statements: Array<{ statement: string; values: unknown[] }> = [];
      for (const c of createBatch) {
        const n = c.n;
        const title = n.title.trim() ? n.title.trim() : (c.kind === "usheet" ? "无标题表格" : "无标题文档");
        const contentHash = sha256Sync(new TextEncoder().encode(c.content));
        // 261027：text_cache 不再随导入过桥（真机 ~4.8MB/100 篇），同步结束后台补（backfillTextCache）。
        statements.push({
          statement: "INSERT INTO notes (id,title,parent_id,updated_at,content_hash,is_dirty,text_cache,doc_kind,trashed_at,deleted_from_parent_id) VALUES (?,?,?,?,?,1,NULL,?,?,?)",
          values: [n.id, title, c.resolvedParentId, n.updatedAt, contentHash, c.kind, n.trashedAt ?? null, n.deletedFromParentId ?? null],
        });
        // 默认值行不必再 UPDATE（大多数文档 icon=null/locked=0/sort=0）。
        if ((n.icon ?? null) !== null || n.isLocked || n.sortOrder !== 0) {
          statements.push({ statement: "UPDATE notes SET icon=?, is_locked=?, sort_order=? WHERE id=?", values: [n.icon ?? null, n.isLocked ? 1 : 0, n.sortOrder, n.id] });
        }
        current.set(n.id, {
          id: n.id, title, parent_id: c.resolvedParentId, sort_order: n.sortOrder,
          trashed_at: n.trashedAt ?? null, icon: n.icon ?? null, is_locked: n.isLocked ? 1 : 0,
          content_hash: contentHash, updated_at: n.updatedAt,
        });
      }
      const sqlStartedAt = Date.now();
      await executeBatch(this.db, statements);
      bridgePerfLog({
        where: "importBatch", notes: createBatch.length, statements: statements.length,
        bodiesMs, sqlMs: Date.now() - sqlStartedAt,
      });
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
    const allQRows = await this.db.prepare("SELECT id,deleted_at,cloud_deleted FROM quick_notes").all() as unknown as Array<{ id: string; deleted_at: string | null; cloud_deleted: number }>;
    const curQ = new Map(allQRows.map((r) => [r.id, r]));
    const wantedQ = new Map(state.quickNotes.items.map((q) => [q.id, q]));
    // 只有「曾经同步过」的条目才算远端删除；全量重拉/同步窗口内本地新建的条目维持旧语义（物理删除）。
    const baselineQuickIds = new Set((side.baseline?.quickNotes.items ?? []).map((q) => q.id));
    // 本轮新打标的 quick 副本（引擎 state.remotePurged 之外的第一次识别；下面并回 state.remotePurged 持久化）。
    const cloudDeletedQuick = new Set<string>();
    for (const q of wantedQ.values()) {
      const bodyBytes = this.stagedQuickBodies.get(q.id);
      const body = bodyBytes ? new TextDecoder().decode(bodyBytes) : null;
      const cur = curQ.get(q.id);
      if (purged.has(q.id)) {
        // 「云端已删除·仅本地」的 quick 回收站副本：只读保留，不写正文/不改标签/不参与上传。
        if (cur === undefined) {
          await this.db.prepare(
            "INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,restore_pending_at,deleted_at,cloud_deleted) VALUES (?,?,?,'',0,?,0,?,NULL,?,1)"
          ).run(q.id, q.createdAt, q.updatedAt, q.contentHash, q.isConflict ? 1 : 0, new Date().toISOString());
        } else if (cur.deleted_at === null) {
          await this.db.prepare("UPDATE quick_notes SET deleted_at=?, is_dirty=0, cloud_deleted=1 WHERE id=?").run(new Date().toISOString(), q.id);
        }
        continue;
      }
      // 远端 active 条目回来 = 他端恢复/显式恢复：清本地 purged 墓碑；回收站副本行同步清 cloud_deleted。
      await this.db.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(q.id);
      if (cur === undefined) {
        if (body !== null) await writeQuickNoteBody(q.id, body);
        await this.db.prepare(
          "INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,restore_pending_at) VALUES (?,?,?,'',0,?,1,?,NULL)"
        ).run(q.id, q.createdAt, q.updatedAt, q.contentHash, q.isConflict ? 1 : 0);
      } else if (cur.deleted_at !== null) {
        // 回收站副本被显式恢复 / 远端重新出现：激活（正文/预览/标签原样保留）。
        if (body !== null) await writeQuickNoteBody(q.id, body);
        await this.db.prepare("UPDATE quick_notes SET updated_at=?, content_hash=?, is_dirty=1, is_conflict=?, deleted_at=NULL, cloud_deleted=0, restore_pending_at=NULL WHERE id=?").run(q.updatedAt, q.contentHash, q.isConflict ? 1 : 0, q.id);
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
    for (const [id, cur] of curQ) {
      if (wantedQ.has(id)) continue;
      if (cur.deleted_at !== null) continue; // 已在 quick 回收站：保留（本地删除或已打标副本）
      // 活跃行从 state 消失，三种来源必须区分：
      // ① 本行本来就是「云端已删除·仅本地」副本（恢复后又被引擎判定为 purge 拦截）⇒ 回到回收站并保留标记，
      //    绝不物理删除（用户仍可在 core 修好后恢复）；
      // ② 曾同步过（在 baseline 里）⇒ 远端删除/远端彻底删除：保留 quick 回收站只读副本，仅打标；
      // ③ 从未同步（全量重拉 / 同步窗口内本地新建）⇒ 维持旧语义物理删除（不产生墓碑、不外传）。
      if (cur.cloud_deleted === 1 || baselineQuickIds.has(id)) {
        // 清 restore_pending_at：恢复意图已被云端 purge 墓碑挡下（core 修好前重试也不会成功），
        // 不清就会每轮同步都重放一次「恢复 → 判 purge」循环。用户可再次点恢复。
        await this.db.prepare("UPDATE quick_notes SET deleted_at=?, cloud_deleted=1, is_dirty=0, ready_to_sync=0, restore_pending_at=NULL WHERE id=?").run(new Date().toISOString(), id);
        cloudDeletedQuick.add(id);
        continue;
      }
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
    // 目录删除：upsert 已在开头完成；这里只清「不在本轮 state.folders」的陈旧目录。
    // 兜底笔记本（本轮为非法远端父新建/复用）不在 state.folders 里，但文档父级引用它 ⇒ 不得删。
    const wantedFolders = new Set(state.folders.map((f) => f.id));
    const folderRows = await this.db.prepare("SELECT id FROM folders").all() as Array<{ id: string }>;
    for (const { id } of folderRows) {
      if (wantedFolders.has(id) || this.protectedFolderIds.has(id)) continue;
      await this.db.prepare("DELETE FROM folders WHERE id=?").run(id);
    }
    // 本轮「云端已删除·仅本地」集合 = 引擎 state.remotePurged ∪ 适配器本轮新打标的小记副本。
    const purgedFinal = [...new Set([...purged, ...cloudDeletedQuick])].sort();
    // 标记投影：先全清再按本轮集合置位 —— 恢复上传成功、远端复活、本地 purge 后标记都会自然消失。
    await this.db.transaction(async () => {
      await this.db.prepare("UPDATE notes SET cloud_deleted=0 WHERE cloud_deleted=1").run();
      await this.db.prepare("UPDATE folders SET cloud_deleted=0 WHERE cloud_deleted=1").run();
      await this.db.prepare("UPDATE quick_notes SET cloud_deleted=0 WHERE cloud_deleted=1").run();
      for (let i = 0; i < purgedFinal.length; i += 400) {
        const part = purgedFinal.slice(i, i + 400);
        const ph = part.map(() => "?").join(",");
        await this.db.prepare("UPDATE notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
        await this.db.prepare("UPDATE folders SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
        await this.db.prepare("UPDATE quick_notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
      }
    });
    await saveV3State(this.db, {
      ...side,
      intents: state.intents, pending: state.pending,
      remotePurged: purgedFinal, restorePending: state.restorePending ?? [],
      quickPurgeTimes: state.quickPurgeTimes ?? {},
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
      { sql: "UPDATE quick_notes SET is_dirty=0, restore_pending_at=NULL WHERE id IN (", ids: baseline.quickNotes.items.map((q) => q.id) },
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
  /**
   * 批量读正文（261026 续传提速）：doc_kind 用**一条 SQL** 查齐，正文用**一次 BodyStore.readMany**；
   * 替代「每篇一次 SQL + 一次桥读」。staged 状态优先（与 readBody 同语义）。
   */
  async readBodies(ids: string[]): Promise<Array<Uint8Array | null>> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = await this.db.prepare("SELECT id,doc_kind FROM notes WHERE id IN (" + placeholders + ")").all(...ids) as Array<{ id: string; doc_kind: string | null }>;
    const kindById = new Map(rows.map((row) => [row.id, normalizeNoteKind(row.doc_kind)] as const));
    const texts = await readNoteBodiesBatch(ids.map((id) => ({ kind: kindById.get(id) ?? "doc", id })));
    return texts.map((text, index) => {
      const id = ids[index];
      const staged = this.stagedBodies.get(id);
      if (staged) return staged;
      if (this.stagedDeletes.has(id)) return null;
      return text == null ? null : new TextEncoder().encode(text);
    });
  }
  async readQuickBodies(ids: string[]): Promise<Array<Uint8Array | null>> {
    const out: Array<Uint8Array | null> = [];
    for (const id of ids) out.push(await this.readQuickBody(id));
    return out;
  }
  /** 批量 stat 正文（261026 续传提速）：与 readBodies 同样一条 SQL 查 kind + 一次原生 stat。 */
  async statBodies(ids: string[]): Promise<Array<{ exists: boolean; size: number }>> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = await this.db.prepare("SELECT id,doc_kind FROM notes WHERE id IN (" + placeholders + ")").all(...ids) as Array<{ id: string; doc_kind: string | null }>;
    const kindById = new Map(rows.map((row) => [row.id, normalizeNoteKind(row.doc_kind)] as const));
    const stats = await statNoteBodiesBatch(ids.map((id) => ({ kind: kindById.get(id) ?? "doc", id })));
    // staged 状态优先（与 readBody 同语义）：本轮刚写入的正文按内存态回答。
    return stats.map((st, index) => {
      const id = ids[index];
      if (this.stagedBodies.has(id)) return { exists: true, size: this.stagedBodies.get(id)!.length };
      if (this.stagedDeletes.has(id)) return { exists: false, size: 0 };
      return st;
    });
  }
  async statQuickBodies(ids: string[]): Promise<Array<{ exists: boolean; size: number }>> {
    const stats = await statQuickNoteBodiesBatch(ids);
    return stats.map((st, index) => {
      const id = ids[index];
      if (this.stagedQuickBodies.has(id)) return { exists: true, size: this.stagedQuickBodies.get(id)!.length };
      if (this.stagedQuickDeletes.has(id)) return { exists: false, size: 0 };
      return st;
    });
  }
  async writeBody(id: string, bytes: Uint8Array): Promise<void> {
    if (this.stagedDeletes.has(id)) {
      // 正文写入即取消待删：先落盘再清标记，避免 saveState 误清空
      await writeNoteBody(await this.kindOf(id), id, new TextDecoder().decode(bytes));
    }
    this.stagedBodies.set(id, bytes);
  }
  async deleteBody(id: string): Promise<void> { this.stagedBodies.delete(id); this.stagedDeletes.add(id); }
  /**
   * v3 覆盖留档（parity F1）：被远端覆盖/远端彻底删除前把本地版本写进移动端历史库。
   * - Lake 文档：走 historyRepository.createHistorySnapshot（受保护 30 天，清理不会先清它）；
   * - 小记：产品定稿「小记没有历史快照」（随手记语义），返回占位值，调用方不视为失败。
   * best-effort：写历史失败不得中断同步（宁可少一份快照，不可让同步失败）。
   */
  async writeHistory(id: string, bytes: Uint8Array): Promise<string> {
    if (id.startsWith("quick-")) return "quick-note-history-skip";
    try {
      const row = await this.db.prepare("SELECT title,parent_id,sort_order FROM notes WHERE id=?").get(id) as
        { title?: string; parent_id?: string | null; sort_order?: number } | undefined;
      if (!row) return "mobile-v3-history-skip";
      await historyRepository.createHistorySnapshot(this.db, id, new TextDecoder().decode(bytes), {
        title: row.title ?? id,
        parentId: row.parent_id ?? null,
        sortOrder: row.sort_order ?? 0,
        protectedDays: HISTORY_SNAPSHOT_PROTECT_DAYS,
      });
      return id;
    } catch (e) {
      console.warn("[v3][history] 写历史快照失败（跳过，不影响同步）:", (e as Error).message);
      return "mobile-v3-history-skip";
    }
  }
  async archiveBody(id: string, bytes: Uint8Array | null): Promise<void> {
    if (bytes) await this.writeHistory(id, bytes);
  }

  private async loadAssetNames(): Promise<{ notes: Map<string, string[]>; quick: Map<string, string[]> }> {
    if (!this.assetNames) {
      this.assetNames = (async () => {
        const out = { notes: new Map<string, string[]>(), quick: new Map<string, string[]>() };
        if (!nativeAssetSyncSupported()) return out;
        try {
          const res = await NativeAssetSync.listAllAssets();
          for (const [id, names] of Object.entries(res.notes ?? {})) out.notes.set(id, [...names].sort());
          for (const [id, names] of Object.entries(res.quickNotes ?? {})) out.quick.set(id, [...names].sort());
        } catch { /* 原生不可用/旧 APK：回退逐篇扫描 */ }
        return out;
      })();
    }
    return this.assetNames;
  }

  private invalidateAssetNames(): void { this.assetNames = null; }

  async listAssets(id: string): Promise<string[]> {
    if (nativeAssetSyncSupported()) {
      const cache = await this.loadAssetNames();
      return cache.notes.get(id) ?? [];
    }
    const keys = await listNoteAssetKeysFs(id);
    return keys.map((k) => k.slice(id.length + 1)).sort();
  }
  /** 原生「文件名→size/sha256」清单：附件差集不必把字节读回 JS（原 P0 大热点）。 */
  async listAssetStats(id: string): Promise<Array<{ filename: string; size: number; hash: string }>> {
    if (!nativeAssetSyncSupported()) throw new Error("native asset stats unsupported");
    const res = await NativeAssetSync.listAssets({ noteId: id });
    return res.assets.map((a) => ({ filename: a.filename, size: Number(a.size), hash: a.hash }));
  }
  async listQuickAssetStats(id: string): Promise<Array<{ filename: string; size: number; hash: string }>> {
    if (!nativeAssetSyncSupported()) throw new Error("native asset stats unsupported");
    const res = await NativeAssetSync.listQuickAssets({ noteId: id });
    return res.assets.map((a) => ({ filename: a.filename, size: Number(a.size), hash: a.hash }));
  }
  async readAsset(id: string, filename: string): Promise<Uint8Array | null> {
    return await loadAssetBytesFs(id + "/" + filename);
  }
  async writeAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    this.invalidateAssetNames();
    await saveAssetBytesFs(id + "/" + filename, bytes);
  }
  async deleteAssetsDir(id: string): Promise<void> {
    this.invalidateAssetNames();
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
    if (nativeAssetSyncSupported()) {
      const cache = await this.loadAssetNames();
      return cache.quick.get(id) ?? [];
    }
    const keys = await listQuickNoteAssetKeysFs(id);
    const prefix = "quick-notes/" + id + "/";
    return keys.map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k)).sort();
  }
  async readQuickAsset(id: string, filename: string): Promise<Uint8Array | null> {
    return await loadAssetBytesFs("quick-notes/" + id + "/" + filename);
  }
  async writeQuickAsset(id: string, filename: string, bytes: Uint8Array): Promise<void> {
    this.invalidateAssetNames();
    await saveAssetBytesFs("quick-notes/" + id + "/" + filename, bytes);
  }
  async deleteQuickAssetsDir(id: string): Promise<void> {
    this.invalidateAssetNames();
    for (const key of await listQuickNoteAssetKeysFs(id)) await removeAssetBytesFs(key);
  }

  /** 单条推送记账（I2）：内容 hash 未变才清 dirty，同时清显式恢复标记。 */
  async markQuickNoteSynced(id: string, expectedContentHash: string): Promise<void> {
    await this.db.prepare("UPDATE quick_notes SET is_dirty=0, restore_pending_at=NULL WHERE id=? AND content_hash=?").run(id, expectedContentHash);
  }

  /** P0-4：原生流式资产的 localKey（相对 note-assets 根，如 `<id>/<file>`）；非原生平台返回 null。 */
  async assetNativePath(id: string, filename: string): Promise<string | null> {
    if (!nativeAssetSyncSupported()) return null;
    if (!/^[A-Za-z0-9._-]+$/.test(id) || !/^[A-Za-z0-9._-]+$/.test(filename)) return null;
    return id + "/" + filename;
  }

  /** 轻量落盘同步标记：不跑整轮 saveState（不碰正文/脏标记），只清 v3_state 标记 + DB cloud_deleted 投影。 */
  async persistSyncMarkers(markers: { remotePurged: string[]; restorePending: string[] }): Promise<void> {
    const side = await loadV3State(this.db);
    await this.db.transaction(async () => {
      await this.db.prepare("UPDATE notes SET cloud_deleted=0 WHERE cloud_deleted=1").run();
      await this.db.prepare("UPDATE folders SET cloud_deleted=0 WHERE cloud_deleted=1").run();
      await this.db.prepare("UPDATE quick_notes SET cloud_deleted=0 WHERE cloud_deleted=1").run();
      for (let i = 0; i < markers.remotePurged.length; i += 400) {
        const part = markers.remotePurged.slice(i, i + 400);
        if (part.length === 0) continue;
        const ph = part.map(() => "?").join(",");
        await this.db.prepare("UPDATE notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
        await this.db.prepare("UPDATE folders SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
        await this.db.prepare("UPDATE quick_notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
      }
    });
    await saveV3State(this.db, { ...side, remotePurged: markers.remotePurged, restorePending: markers.restorePending });
  }

  /**
   * 小记冲突副本（C8，移动端）：双端同改、远端胜出时把本地版本归档进小记回收站。
   * 语义对齐桌面 quickNotes.archiveLocalToTrash：新 id、纯本地（ready_to_sync=0，不向云端发布删除）、
   * 正文与图片按新 id 复制、标签关系一并复制（恢复后是一条带标签的新小记）。
   * 归档后删除旧 id 的图片目录：随后引擎会用远端正文/资源覆盖原条目，留着旧图会被下一轮误声明上传。
   */
  async archiveQuickNote(id: string): Promise<void> {
    const row = await this.db.prepare("SELECT created_at,updated_at,preview_text,image_count,content_hash FROM quick_notes WHERE id=?").get(id) as
      { created_at: string; updated_at: string; preview_text: string; image_count: number; content_hash: string } | undefined;
    if (!row) return;
    const body = await readQuickNoteBody(id);
    if (body == null) return;
    const newId = globalThis.crypto.randomUUID();
    await writeQuickNoteBody(newId, body);
    const oldPrefix = "quick-notes/" + id + "/";
    const oldKeys = await listQuickNoteAssetKeysFs(id);
    for (const key of oldKeys) {
      const bytes = await loadAssetBytesFs(key);
      if (bytes) await saveAssetBytesFs("quick-notes/" + newId + "/" + key.slice(oldPrefix.length), bytes);
    }
    const now = new Date().toISOString();
    const tagRows = await this.db.prepare("SELECT tag_id FROM tag_links WHERE target_kind='quickNote' AND target_id=? ORDER BY position").all(id) as Array<{ tag_id: string }>;
    await this.db.transaction(async () => {
      await this.db.prepare(
        "INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,restore_pending_at,deleted_at,ready_to_sync) VALUES (?,?,?,?,?,?,1,0,NULL,?,0)"
      ).run(newId, row.created_at, now, row.preview_text, row.image_count, row.content_hash, now);
      for (let i = 0; i < tagRows.length; i++) {
        await this.db.prepare("INSERT OR IGNORE INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote',?,?,?)").run(newId, tagRows[i].tag_id, i);
      }
      if (tagRows.length > 0) {
        await this.db.prepare("INSERT INTO tag_link_versions (target_kind,target_id,links_updated_at) VALUES ('quickNote',?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at").run(newId, now);
      }
    });
    for (const key of oldKeys) await removeAssetBytesFs(key);
  }

  /** 目录 upsert（先于文档；父级走 C5 兜底）。 */
  private async upsertSyncFolders(folders: readonly LakeFolderEntry[]): Promise<void> {
    const existing = new Set(((await this.db.prepare("SELECT id FROM folders").all()) as Array<{ id: string }>).map((r) => r.id));
    for (const f of folders) {
      const parentId = await this.resolveSyncFolderParent(f);
      if (existing.has(f.id)) {
        await this.db.prepare("UPDATE folders SET title=?,parent_id=?,sort_order=?,node_type=?,icon=?,updated_at=?,trashed_at=?,deleted_from_parent_id=?,is_dirty=1 WHERE id=?").run(
          f.title, parentId, f.sortOrder, f.nodeType, f.icon ?? null, f.updatedAt, f.trashedAt ?? null, f.deletedFromParentId ?? null, f.id,
        );
      } else {
        await this.db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty) VALUES (?,?,?,?,?,?,?,?,?,1)").run(
          f.id, f.title, parentId, f.sortOrder, f.nodeType, f.icon ?? null, f.updatedAt, f.trashedAt ?? null, f.deletedFromParentId ?? null,
        );
      }
    }
  }

  // ---- C5 父目录兜底（远端父可能是本机还没落库/已被删的目录） ----
  private async resolveSyncNoteParent(parentId: string | null): Promise<string | null> {
    if (parentId === null) return null;
    const exists = await this.db.prepare("SELECT 1 FROM folders WHERE id=?").get(parentId);
    if (exists) return parentId;
    return await this.defaultNotebookId();
  }

  private async resolveSyncFolderParent(f: LakeFolderEntry): Promise<string | null> {
    if (f.parentId === null) return null;
    if (f.nodeType === "notebook") return null; // 笔记本只能根层
    return await this.resolveSyncNoteParent(f.parentId);
  }

  /** 兜底父笔记本：复用任意未删除笔记本；没有才建「未分类」（与旧协议 resolveParentNotebook 同义）。 */
  private async defaultNotebookId(): Promise<string | null> {
    const row = await this.db.prepare("SELECT id FROM folders WHERE node_type='notebook' ORDER BY sort_order LIMIT 1").get() as { id?: string } | undefined;
    if (row?.id) { this.protectedFolderIds.add(row.id); return row.id; }
    const id = "notebook-" + globalThis.crypto.randomUUID();
    await this.db.prepare(
      "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty) VALUES (?,?,NULL,0,'notebook',NULL,?,1)"
    ).run(id, "未分类", new Date().toISOString());
    this.protectedFolderIds.add(id);
    return id;
  }
}