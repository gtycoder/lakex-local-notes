import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import { previewQuickNote, validateQuickNoteContent } from "../../core/quickNoteModel.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import type { FileDriver } from "../../core/s3v3/state/ports.js";
import type { DeviceBaseline } from "../../core/s3v3DeviceStore.js";
import type {
  NoteSearchCaches, PlatformDataPort, PurgedTombstoneRow, QuickAssetWrite, QuickDeletedRow, QuickNoteSyncRow,
  QuickNoteWrite, QuickPurgeRow, QuickTagRow, SyncFolderRow, SyncNoteMetaRow, SyncNoteWrite,
} from "../../core/s3v3/state/platformPort.js";
import { executeBatch, type MobileDb } from "../data/sqliteDb.js";
import {
  deleteNoteBodies, deleteQuickNoteBody, moveStagedBodyFiles as moveStagedBodyFilesFs, readNoteBody, readQuickNoteBody,
  writeNoteBodiesBatch, writeNoteBody, writeQuickNoteBody,
} from "../data/noteBodies.js";
import { loadV3State } from "../data/v3StateRepository.js";
import { persistedStateProjection } from "./v3StateSnapshot.js";
import { MAX_QUICK_NOTE_TAGS } from "../../core/quickNoteTags.js";
import { TRASH_NOTEBOOK_ID } from "../../core/syncDecisions.js";
import {
  addPendingTagDeletes as appendPendingTagDeletes,
  applyQuickTagDirectory,
  listPendingTagDeletes as readPendingTagDeletes,
  settlePendingTagDeletes as removePendingTagDeletes,
} from "../data/quickNoteTagsRepository.js";
import { reindexQuickNotesByIds, reindexQuickNotesForTags } from "../data/quickNoteTagService.js";
import { applyRemoteNoteTags, cleanupOrphanNoteTagLinks, listAllNoteTagIds, listAllNoteTagsUpdatedAt } from "../data/noteTagLinksRepository.js";
import { listQuickNoteAssetKeysFs, removeAssetBytesFs } from "../native/assetFs.js";
import { DIARY_FOLDER_SPACE, mergeFolderSpace, normalizeFolderSpace } from "../../core/diary.js";

/**
 * 移动端 PlatformDataPort（E2-4 phase C）：把移动仓库/DB 的既有读取/写入语义映射成窄端口。
 *
 * phase C-1：读方法全实现（loadState 已上收 core 单一编排）。
 * phase C-3b-2：写方法 + 3 钩子 + saveState 切换。所有写路径逐字段对齐迁移前的
 * mobileDeviceStore.saveState（同一批 SQL / 同一批条件判断 / 同一 staging 顺序），对拍见
 * docs/SYNC-STATE-CONVERGENCE.md 与 src/mobile/v3 的对拍用例。
 *
 * 与桌面的差异（由端口行字段/钩子承载，core 不 if(platform)）：
 * - cloud_deleted DB 投影（「云端已删除·仅本地」）：作为行上的 cloudDeleted 交给 core 并入 remotePurged；
 * - 资产 hash 兜底：移动旧数据可能只有 baseline 里带 assetsHash ⇒ 行上带 assetsHash 兜底；
 * - 正文 staging 在文件（不是 JS 内存）⇒ 批量窗口钩子（begin/flush）+ moveStagedBodyFiles 钩子。
 */

/** 移动端端口写批上下文：由 MobileDeviceStore 持有并在每轮 saveState 入口重置本轮标记。 */
export interface MobilePlatformPortContext {
  /** 引擎 writeBody 落的 staging 正文 id（saveState 的 moveStagedBodyFiles 钩子搬运后清空）。 */
  stagedBodyIds: Set<string>;
  /** 旧路径内存 staging（移动端正常为空；保留兼容 readBody 语义）。 */
  stagedBodies: Map<string, Uint8Array>;
  /** 本轮 state.remotePurged（小记/文档「云端已删除·仅本地」副本按此分派）。 */
  remotePurged: Set<string>;
  /** 本轮 state 里文档的远端 trashedAt（回收站时间戳落远端值，而不是本地 now）。 */
  remoteTrashedAt: Map<string, string>;
  /** 本轮新打标的小记副本（投影时并入 = 旧实现 purgedFinal 同一口径）。 */
  newlyCloudDeletedQuick: Set<string>;
  /**
   * 单条快路径合并读的 raw 快照（261112 task-83）：返回 null = 没有快照（走自己的 SELECT）。
   * 由 MobileDeviceStore.loadQuickPushSnapshot 在读取 baseline/轻量状态期间临时提供，
   * 目的只是让 assetsHashOf 复用同一份「已读出的 sync_v3_state 行 + 已读出的 baseline 文件值」，语义不变。
   */
  readStateSnapshot?: () => { raw: unknown; baseline: DeviceBaseline | null } | null;
}

/** 文档行快照（saveState 内的「当前行」视图；与旧实现内存 map 同口径，避免逐条回查 SQL）。 */
interface NoteRowSnap {
  title: string;
  parent_id: string | null;
  sort_order: number;
  trashed_at: string | null;
  icon: string | null;
  is_locked: number;
  /** 编辑锁时间戳（E2-4 收口：移动端口与桌面同口径读写，字段级 LWW 生效）。 */
  locked_at: string | null;
  content_hash: string | null;
  updated_at: string;
}

interface WriteBatch {
  statements: Array<{ statement: string; values: unknown[] }>;
  /** legacy 内存正文（桌面路径；移动端正常为空）。批量先写正文、后提交行。 */
  legacyBodies: Array<{ kind: NoteKind; id: string; content: string }>;
  /** 本轮已被 importRemoteNote 建行的 id（setNodeIcon 不得再补一条重复 UPDATE）。 */
  importedIds: Set<string>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createMobilePlatformPort(db: MobileDb, ctxIn?: Partial<MobilePlatformPortContext>): PlatformDataPort {
  const ctx: MobilePlatformPortContext = {
    stagedBodyIds: ctxIn?.stagedBodyIds ?? new Set<string>(),
    stagedBodies: ctxIn?.stagedBodies ?? new Map<string, Uint8Array>(),
    remotePurged: ctxIn?.remotePurged ?? new Set<string>(),
    remoteTrashedAt: ctxIn?.remoteTrashedAt ?? new Map<string, string>(),
    newlyCloudDeletedQuick: ctxIn?.newlyCloudDeletedQuick ?? new Set<string>(),
    ...(ctxIn?.readStateSnapshot ? { readStateSnapshot: ctxIn.readStateSnapshot } : {}),
  };
  /** 资产 hash 兜底（信封 assets + baseline 里的声明版本），一次调用内缓存。 */
  let assetsHashMap: Promise<Map<string, string>> | null = null;
  const assetsHashOf = (): Promise<Map<string, string>> => {
    if (!assetsHashMap) {
      assetsHashMap = (async () => {
        // task-83：合并读快照存在时复用同一份 raw（省掉第三次 SELECT 整行 JSON）。
        const snapshot = ctx.readStateSnapshot?.() ?? null;
        const side = snapshot
          ? (persistedStateProjection(snapshot.raw, snapshot.baseline) ?? { baseline: null, assetsHash: {} })
          : await loadV3State(db);
        const map = new Map<string, string>();
        for (const n of side.baseline?.lake.notes ?? []) if (n.assetsHash) map.set(n.id, n.assetsHash);
        for (const q of side.baseline?.quickNotes.items ?? []) if (q.assetsHash) map.set(q.id, q.assetsHash);
        for (const [id, hash] of Object.entries(side.assetsHash)) map.set(id, hash);
        return map;
      })();
    }
    return assetsHashMap;
  };
  /** 当前文档行快照（listNotesSyncMeta 时重建；写方法同步维护，等价旧实现的 current map）。 */
  const snapshot = new Map<string, NoteRowSnap>();
  let batch: WriteBatch | null = null;

  /** 批量窗口内入队，窗口外立即执行（目录/小记/投影都在窗口外，与旧实现单条 SQL 同口径）。 */
  async function write(statement: string, values: unknown[]): Promise<{ changes: number }> {
    if (batch) { batch.statements.push({ statement, values }); return { changes: 1 }; }
    const result = await db.prepare(statement).run(...values);
    return { changes: Number(result.changes ?? 0) };
  }

  function titleOf(note: SyncNoteWrite): string {
    return note.title.trim() ? note.title.trim() : (note.kind === "usheet" ? "无标题表格" : "无标题文档");
  }

  /**
   * legacy 正文写路径（同步 apply 用；桌面 legacy 同口径）。**不改生命周期列**
   * （trashed_at/parent_id 由 applyRemoteNoteMeta / 生命周期分支负责），因此回收站行也能安全接收正文。
   * 261112 P0：saveNote 与 saveSyncedNote 共用这一份，避免两条写路径语义漂移。
   */
  async function applySyncedBody(noteId: string, title: string, content: string, caches: NoteSearchCaches | null): Promise<void> {
    const row = await db.prepare("SELECT doc_kind FROM notes WHERE id=?").get(noteId) as { doc_kind?: string | null } | undefined;
    const kind = normalizeNoteKind(row?.doc_kind);
    const bodyHash = sha256Sync(new TextEncoder().encode(content));
    const at = nowIso();
    if (batch) batch.legacyBodies.push({ kind, id: noteId, content });
    else await writeNoteBody(kind, noteId, content);
    await write(
      "UPDATE notes SET title=?, updated_at=?, content_hash=?, is_dirty=0, text_cache=? WHERE id=?",
      [title.trim() ? title.trim() : "无标题文档", at, bodyHash, caches?.plain ?? null, noteId],
    );
    const snap = snapshot.get(noteId);
    if (snap) { snap.title = title; snap.updated_at = at; snap.content_hash = bodyHash; }
  }

  return {
    async listFoldersForSync(): Promise<SyncFolderRow[]> {
      // 与桌面 listFoldersForSync 同口径：固定「回收站」笔记本是本机容器，绝不进云端 folders
      // （否则移动端一发布就把 notebook-trash 写进索引，首轮同步平白多出一代）。
      const rows = await db.prepare(
        "SELECT id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,cloud_deleted,space FROM folders WHERE id != ? ORDER BY id"
      ).all(TRASH_NOTEBOOK_ID) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: String(r.id), title: String(r.title), parentId: r.parent_id ? String(r.parent_id) : null,
        sortOrder: Number(r.sort_order), nodeType: r.node_type === "group" ? "group" : "notebook",
        icon: r.icon ? String(r.icon) : null, updatedAt: String(r.updated_at),
        trashedAt: r.trashed_at ? String(r.trashed_at) : null,
        deletedFromParentId: r.deleted_from_parent_id ? String(r.deleted_from_parent_id) : null,
        ...(Number(r.cloud_deleted) === 1 ? { cloudDeleted: true } : {}),
        // 日记本标记：**显式写 null**（非日记也写），否则「space 置 null」在 wire 上不可见（docs/DIARY.md 硬规则 1）。
        space: normalizeFolderSpace(r.space),
      }));
    },
    async listNotesSyncMeta(): Promise<SyncNoteMetaRow[]> {
      const assets = await assetsHashOf();
      // 261105 P1（关键，防清空）：文档标签关系必须随同步清单搬运；否则移动端发布 lake 索引会清空文档标签。
      const noteTagLinks = await listAllNoteTagIds(db);
      const noteTagVersions = await listAllNoteTagsUpdatedAt(db);
      const rows = await db.prepare(
        "SELECT id,title,parent_id,sort_order,updated_at,content_hash,is_conflict,is_locked,locked_at,icon,doc_kind,trashed_at,deleted_from_parent_id,cloud_deleted FROM notes ORDER BY id"
      ).all() as Array<Record<string, unknown>>;
      snapshot.clear();
      return rows.map((r) => {
        const snap: NoteRowSnap = {
          title: String(r.title), parent_id: r.parent_id ? String(r.parent_id) : null,
          sort_order: Number(r.sort_order), trashed_at: r.trashed_at ? String(r.trashed_at) : null,
          icon: r.icon ? String(r.icon) : null, is_locked: Number(r.is_locked),
          locked_at: r.locked_at ? String(r.locked_at) : null,
          content_hash: r.content_hash ? String(r.content_hash) : null, updated_at: String(r.updated_at),
        };
        snapshot.set(String(r.id), snap);
        return {
          id: String(r.id), title: snap.title, parentId: snap.parent_id,
          sortOrder: snap.sort_order, updatedAt: snap.updated_at,
          contentHash: snap.content_hash ?? "",
          kind: normalizeNoteKind(r.doc_kind), icon: snap.icon,
          isEditLocked: snap.is_locked === 1, editLockedAt: snap.locked_at, isConflict: Number(r.is_conflict) === 1,
          trashedAt: snap.trashed_at,
          deletedFromParentId: r.deleted_from_parent_id ? String(r.deleted_from_parent_id) : null,
          ...(Number(r.cloud_deleted) === 1 ? { cloudDeleted: true } : {}),
          ...(assets.has(String(r.id)) ? { assetsHash: assets.get(String(r.id))! } : {}),
          // 文档标签关系（本机顺序；发布时由 plan 排序成集合）。
          // P0：有版本时必须显式带 tagIds（空集合也带），否则对端分不清「删光」与「旧索引没字段」。
          ...(() => {
            const links = noteTagLinks.get(String(r.id)) ?? [];
            const version = noteTagVersions.get(String(r.id));
            return version || links.length > 0 ? { tagIds: [...links], ...(version ? { tagsUpdatedAt: version } : {}) } : {};
          })(),
        };
      });
    },
    async listQuickNotesForSync(): Promise<QuickNoteSyncRow[]> {
      const assets = await assetsHashOf();
      const rows = await db.prepare(
        "SELECT q.id,q.created_at,q.updated_at,q.content_hash,q.is_conflict,q.restore_pending_at,q.cloud_deleted,q.deleted_at,COALESCE(v.links_updated_at,'') AS tags_updated_at FROM quick_notes q LEFT JOIN tag_link_versions v ON v.target_kind='quickNote' AND v.target_id=q.id WHERE q.deleted_at IS NULL OR q.cloud_deleted=1 ORDER BY q.id"
      ).all() as Array<Record<string, unknown>>;
      const linkRows = await db.prepare("SELECT target_id,tag_id,position FROM tag_links WHERE target_kind='quickNote' ORDER BY target_id,position").all() as Array<{ target_id: string; tag_id: string }>;
      const links = new Map<string, string[]>();
      for (const l of linkRows) {
        const arr = links.get(l.target_id) ?? [];
        arr.push(l.tag_id);
        links.set(l.target_id, arr);
      }
      return rows.map((r) => ({
        id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), contentHash: String(r.content_hash),
        isConflict: Number(r.is_conflict) === 1,
        // 关系按集合同步：排序后的 ID 列表（顺序是设备本地视图，不传播）。
        tagIds: [...(links.get(String(r.id)) ?? [])].sort(),
        tagsUpdatedAt: r.tags_updated_at ? String(r.tags_updated_at) : null,
        ...(Number(r.cloud_deleted) === 1 ? { cloudDeleted: true } : {}),
        ...(r.deleted_at ? { deletedAt: String(r.deleted_at) } : {}),
        ...(assets.has(String(r.id)) ? { assetsHash: assets.get(String(r.id))! } : {}),
      }));
    },
    /** 单条推送提速（261110）：只读这一条小记行（含标签关系/资产 hash），不读其它小记正文。 */
    async getQuickNoteSyncRow(id: string): Promise<QuickNoteSyncRow | null> {
      const assets = await assetsHashOf();
      const r = await db.prepare(
        "SELECT q.id,q.created_at,q.updated_at,q.content_hash,q.is_conflict,q.restore_pending_at,q.cloud_deleted,q.deleted_at,COALESCE(v.links_updated_at,'') AS tags_updated_at FROM quick_notes q LEFT JOIN tag_link_versions v ON v.target_kind='quickNote' AND v.target_id=q.id WHERE q.id=? AND (q.deleted_at IS NULL OR q.cloud_deleted=1)"
      ).get(id) as Record<string, unknown> | undefined;
      if (!r) return null;
      const linkRows = await db.prepare("SELECT tag_id FROM tag_links WHERE target_kind='quickNote' AND target_id=? ORDER BY position").all(id) as Array<{ tag_id: string }>;
      return {
        id: String(r.id), createdAt: String(r.created_at), updatedAt: String(r.updated_at), contentHash: String(r.content_hash),
        isConflict: Number(r.is_conflict) === 1,
        tagIds: linkRows.map((x) => x.tag_id).sort(),
        tagsUpdatedAt: r.tags_updated_at ? String(r.tags_updated_at) : null,
        ...(Number(r.cloud_deleted) === 1 ? { cloudDeleted: true } : {}),
        ...(r.deleted_at ? { deletedAt: String(r.deleted_at) } : {}),
        ...(assets.has(String(r.id)) ? { assetsHash: assets.get(String(r.id))! } : {}),
      };
    },
    async listQuickTags(): Promise<QuickTagRow[]> {
      // 只同步名称/时间：**顺序是设备本地视图**、**删除 = 缺席**（云端 tags[] 不放墓碑）。
      // 仍保留 deleted_at IS NULL：迁移未跑完的旧库不能把墓碑带上云端。
      const rows = await db.prepare("SELECT id,name,created_at,updated_at FROM tags WHERE deleted_at IS NULL ORDER BY id").all() as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: String(r.id), name: String(r.name),
        createdAt: String(r.created_at), updatedAt: String(r.updated_at),
      }));
    },
    async listPendingTagDeletes(): Promise<string[]> {
      return await readPendingTagDeletes(db);
    },
    /** 追加待删（幂等）：同步轮进行中用户新删的标签不会被本轮落库抹掉（覆盖写会丢）。 */
    async addPendingTagDeletes(ids: readonly string[]): Promise<void> {
      await appendPendingTagDeletes(db, ids);
    },
    /** 结算：远端已确认缺席的 id 从待删集合移除（其余保留）。 */
    async settlePendingTagDeletes(ids: readonly string[]): Promise<void> {
      await removePendingTagDeletes(db, ids);
    },
    /** 移动旧口径：quickDeletes 只收「可恢复」行（软删行 + purged_at 为空的墓碑），purged 行走 listQuickPurges。 */
    async listQuickDeleted(): Promise<QuickDeletedRow[]> {
      const softRows = await db.prepare("SELECT id, deleted_at FROM quick_notes WHERE deleted_at IS NOT NULL AND cloud_deleted=0").all() as Array<{ id: string; deleted_at: string | null }>;
      const softTombRows = await db.prepare("SELECT id, deleted_at FROM quick_note_deleted WHERE purged_at IS NULL").all() as Array<{ id: string; deleted_at: string | null }>;
      return [...softRows.map((r) => ({ id: r.id, purgedAt: null, deletedAt: r.deleted_at ?? "" })), ...softTombRows.map((r) => ({ id: r.id, purgedAt: null, deletedAt: r.deleted_at ?? "" }))]
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async listQuickPurges(): Promise<QuickPurgeRow[]> {
      const rows = await db.prepare("SELECT id,purged_at FROM quick_note_deleted WHERE purged_at IS NOT NULL").all() as Array<{ id: string; purged_at: string }>;
      return rows.map((r) => ({ id: r.id, purgedAt: r.purged_at }));
    },
    async listPurgedTombstones(): Promise<PurgedTombstoneRow[]> {
      const rows = await db.prepare("SELECT id,purged_at FROM deleted_notes WHERE purged_at IS NOT NULL").all() as Array<{ id: string; purged_at: string | null }>;
      return rows.map((r) => ({ id: r.id, purgedAt: r.purged_at ?? null }));
    },
    async listRestorePendingNoteIds(): Promise<string[]> {
      const rows = await db.prepare("SELECT id FROM notes WHERE restore_pending_at IS NOT NULL ORDER BY id").all() as Array<{ id: string }>;
      return rows.map((r) => r.id);
    },
    async listRestorePendingQuickNoteIds(): Promise<string[]> {
      const rows = await db.prepare("SELECT id FROM quick_notes WHERE restore_pending_at IS NOT NULL ORDER BY id").all() as Array<{ id: string }>;
      return rows.map((r) => r.id);
    },
    async listBodyRecoveryPending(): Promise<string[]> {
      return []; // 移动端不做缺正文恢复队列（桌面 device_state 专有）
    },
    /** 单条推送轻量投影（261110）：三条只读标记 SQL，不拼全库世界。 */
    async listCloudDeletedIds() {
      const folders = await db.prepare("SELECT id FROM folders WHERE cloud_deleted=1 ORDER BY id").all() as Array<{ id: string }>;
      const notes = await db.prepare("SELECT id FROM notes WHERE cloud_deleted=1 ORDER BY id").all() as Array<{ id: string }>;
      const quickNotes = await db.prepare("SELECT id FROM quick_notes WHERE cloud_deleted=1 ORDER BY id").all() as Array<{ id: string }>;
      return {
        folders: folders.map((r) => r.id),
        notes: notes.map((r) => r.id),
        quickNotes: quickNotes.map((r) => r.id),
      };
    },
    noteBodyPath(noteId: string): string {
      // 路径需要 kind（正文目录按类型分）；这里用延迟解析的伪路径，由 FileDriver 反向查库。
      return "note:" + noteId;
    },
    quickNoteBodyPath(quickNoteId: string): string {
      return "qnote:" + quickNoteId;
    },
    async hasNote(noteId: string): Promise<boolean> {
      // 移动端文档/小记同库：remotePurged 过滤必须把「小记回收站副本」也算作本地仍有行，
      // 否则「云端已删除·仅本地」的小记标记会在投影时被清掉（旧实现 purgedFinal 含小记）。
      return Boolean(await db.prepare("SELECT 1 FROM notes WHERE id=? UNION SELECT 1 FROM quick_notes WHERE id=?").get(noteId, noteId));
    },
    async hasTreeNode(nodeId: string): Promise<boolean> {
      return Boolean(await db.prepare("SELECT 1 FROM folders WHERE id=?").get(nodeId));
    },
    async defaultNotebookId(): Promise<string> {
      const row = await db.prepare("SELECT id FROM folders WHERE node_type='notebook' AND trashed_at IS NULL ORDER BY sort_order LIMIT 1").get() as { id?: string } | undefined;
      if (row?.id) return row.id;
      const id = "notebook-" + globalThis.crypto.randomUUID();
      await db.prepare("INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,is_dirty) VALUES (?,?,NULL,0,'notebook',NULL,?,1)").run(id, "未分类", nowIso());
      return id;
    },

    // ===== 批量/生命周期钩子（C-3b-2）=====
    async beginWriteBatch(): Promise<void> {
      batch = { statements: [], legacyBodies: [], importedIds: new Set() };
    },
    async flushWriteBatch(): Promise<void> {
      const b = batch;
      batch = null;
      if (!b) return;
      // 与旧实现同序：先批量写正文（桌面 legacy 路径），再一次 executeSet 提交行。
      if (b.legacyBodies.length > 0) await writeNoteBodiesBatch(b.legacyBodies, { durable: false });
      if (b.statements.length > 0) await executeBatch(db, b.statements);
    },
    async moveStagedBodyFiles(items: ReadonlyArray<{ id: string; kind: NoteKind }>): Promise<void> {
      const list = items.map((i) => ({ kind: i.kind, id: i.id }));
      if (list.length === 0) return;
      await moveStagedBodyFilesFs(list);
      for (const i of list) ctx.stagedBodyIds.delete(i.id);
    },
    async applyCloudDeletedProjection(noteIds: readonly string[]): Promise<void> {
      // 与旧实现同一口径：本轮集合 = 引擎 remotePurged ∪ 适配器本轮新打标的小记副本。
      const all = [...new Set([...noteIds, ...ctx.newlyCloudDeletedQuick])].sort();
      await db.transaction(async () => {
        await db.prepare("UPDATE notes SET cloud_deleted=0 WHERE cloud_deleted=1").run();
        await db.prepare("UPDATE folders SET cloud_deleted=0 WHERE cloud_deleted=1").run();
        await db.prepare("UPDATE quick_notes SET cloud_deleted=0 WHERE cloud_deleted=1").run();
        for (const part of chunk(all, 400)) {
          const ph = part.map(() => "?").join(",");
          await db.prepare("UPDATE notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
          await db.prepare("UPDATE folders SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
          await db.prepare("UPDATE quick_notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
        }
      });
      ctx.newlyCloudDeletedQuick.clear();
    },

    // ===== 文档写（逐条对齐旧 saveState）=====
    async importRemoteNote(note: SyncNoteWrite, content: Uint8Array | null, opts?: { staged?: boolean }): Promise<void> {
      const staged = opts?.staged === true;
      const title = titleOf(note);
      // 旧实现：回收站条目用 deletedFromParentId 作行 parent（移动端回收站不是 notebook-trash 那个目录）。
      const parentId = note.trashedAt ? (note.deletedFromParentId ?? null) : note.parentId;
      const contentHash = staged ? note.contentHash : (content !== null ? sha256Sync(content) : note.contentHash);
      if (content !== null) batch?.legacyBodies.push({ kind: note.kind, id: note.id, content: new TextDecoder().decode(content) });
      await write(
        // created_at：wire 不带文档创建时间（LakeNoteEntry 只有 updatedAt）⇒ 首次落地按 updatedAt 记一次，
        // 之后编辑不再改动它（同端内排序稳定；跨端以"首次同步看到的时间"为创建时间近似）。
        "INSERT INTO notes (id,title,parent_id,updated_at,created_at,content_hash,is_dirty,text_cache,doc_kind,trashed_at,deleted_from_parent_id) VALUES (?,?,?,?,?,?,1,NULL,?,?,?)",
        [note.id, title, parentId, note.updatedAt, note.updatedAt, contentHash, note.kind, note.trashedAt ?? null, note.deletedFromParentId ?? null],
      );
      snapshot.set(note.id, {
        title, parent_id: parentId, sort_order: note.sortOrder, trashed_at: note.trashedAt ?? null,
        icon: note.icon ?? null, is_locked: note.isEditLocked ? 1 : 0, locked_at: note.editLockedAt ?? null,
        content_hash: contentHash, updated_at: note.updatedAt,
      });
      // 默认值行不必再 UPDATE（大多数文档 icon=null/locked=0/sort=0）——与旧实现同一条件。
      if ((note.icon ?? null) !== null || note.isEditLocked || note.sortOrder !== 0) {
        await write("UPDATE notes SET icon=?, is_locked=?, locked_at=?, sort_order=? WHERE id=?", [note.icon ?? null, note.isEditLocked ? 1 : 0, note.editLockedAt ?? null, note.sortOrder, note.id]);
      }
      batch?.importedIds.add(note.id);
    },
    async saveNote(noteId: string, title: string, content: string, caches: NoteSearchCaches | null): Promise<void> {
      // 桌面 legacy 路径：正文随调用落盘（移动端正常走 staged 路径，这里保持等价实现）。
      await applySyncedBody(noteId, title, content, caches);
    },
    async saveSyncedNote(noteId: string, title: string, content: string, caches: NoteSearchCaches | null): Promise<void> {
      // P0（261112）：同步专用写路径。移动端这条 SQL 本就不带 trashed 守卫（生命周期由元数据/分支负责），
      // 与桌面 store.saveSyncedNote 同语义：允许回收站行接收远端正文，不改 trashed_at/parent_id。
      await applySyncedBody(noteId, title, content, caches);
    },
    async applyStagedBodyNote(note: SyncNoteWrite): Promise<void> {
      // 移动端：正文已由引擎写到 staging 文件，这里只更新行（正文由 moveStagedBodyFiles 钩子搬）。
      const title = titleOf(note);
      // 261112 task-55（N1）：core 对「远端 trashed / 本地 keepLocalTrash」条目一律传 parentId=回收站容器
      // （notebook-trash —— 那是**桌面侧**的物理父）。移动端回收站 = 「trashed_at + 原父」模型，容器 id 在本机
      // folders 里不存在 ⇒ 绝不能把它写进普通父列（恢复会找不到原父；后续发布还可能把容器当普通 parent 带出去）。
      // 归一：原父取 deletedFromParentId；缺失时传 null 让 COALESCE 保留现有父（不覆盖）。
      const parentId = (note.trashedAt || note.parentId === TRASH_NOTEBOOK_ID)
        ? (note.deletedFromParentId ?? null)
        : note.parentId;
      await write(
        "UPDATE notes SET title=?, parent_id=COALESCE(?, parent_id), updated_at=?, content_hash=?, is_dirty=0, text_cache=NULL WHERE id=?",
        [title, parentId, note.updatedAt, note.contentHash, note.id],
      );
      const snap = snapshot.get(note.id);
      if (snap) { snap.title = title; if (parentId !== null) snap.parent_id = parentId; snap.updated_at = note.updatedAt; snap.content_hash = note.contentHash; }
    },
    async applyRemoteNoteMeta(note: SyncNoteWrite, expectedLocalUpdatedAt?: string): Promise<void> {
      const snap = snapshot.get(note.id);
      // 261107（数据安全）：窗口内用户改名/移动会把 updated_at 改掉；平台内部恢复/软删只改 is_dirty
      // （updated_at 仍等于快照）。因此 `expectedLocalUpdatedAt` 优先：当前行仍等于它才允许覆盖。
      const current = await db.prepare("SELECT updated_at,is_dirty FROM notes WHERE id=?").get(note.id) as { updated_at?: string; is_dirty?: number } | undefined;
      const locallyEdited = expectedLocalUpdatedAt !== undefined && current?.updated_at !== expectedLocalUpdatedAt;
      if (!locallyEdited) {
        if (note.trashedAt) {
          // 261112 task-56（N3）：回收站行的**内容级元数据**与桌面全写口径对齐（标题/排序/更新时间/图标/锁）。
          // 但位置三件套不动：trashed_at/deleted_from_parent_id 是本地生命周期（位置合并已决定应用与否），
          // parent_id 在移动端模型里是「原父」——回收站容器 id 永不落库（与 applyStagedBodyNote 同口径）。
          await write(
            "UPDATE notes SET title=?, sort_order=?, updated_at=?, icon=?, is_locked=?, locked_at=? WHERE id=?",
            [note.title, note.sortOrder, note.updatedAt, note.icon ?? null, note.isEditLocked ? 1 : 0, note.editLockedAt ?? null, note.id],
          );
        } else {
          // 活跃行：标题/父级/排序/更新时间（parent 缺省保留）+ 图标/锁两组（与旧实现同序，减少无谓 UPDATE）。
          const titleChanged = !snap || snap.title !== note.title || (snap.parent_id ?? null) !== (note.parentId ?? null);
          if (titleChanged) {
            await write(
              "UPDATE notes SET title=?, parent_id=COALESCE(?, parent_id), sort_order=?, updated_at=? WHERE id=?",
              [note.title, note.parentId, note.sortOrder, note.updatedAt, note.id],
            );
          }
          const metaChanged = !snap
            || (snap.icon ?? null) !== (note.icon ?? null)
            || snap.is_locked !== (note.isEditLocked ? 1 : 0)
            || snap.sort_order !== note.sortOrder;
          if (metaChanged) {
            await write("UPDATE notes SET icon=?, is_locked=?, locked_at=?, sort_order=? WHERE id=?", [note.icon ?? null, note.isEditLocked ? 1 : 0, note.editLockedAt ?? null, note.sortOrder, note.id]);
          }
        }
      }
      if (snap) {
        // 位置字段只对活跃行做快照同步（回收站行的父/生命周期由专门的写路径维护）。
        if (!note.trashedAt) { snap.title = note.title; if (note.parentId !== null) snap.parent_id = note.parentId; snap.updated_at = note.updatedAt; }
        else { snap.title = note.title; snap.updated_at = note.updatedAt; }
        snap.sort_order = note.sortOrder;
        snap.icon = note.icon ?? null; snap.is_locked = note.isEditLocked ? 1 : 0;
      }
    },
    async applyRemoteEditLock(noteId: string, locked: boolean, editLockedAt: string | null): Promise<void> {
      // E2-4 收口：与桌面同口径写 is_locked + locked_at（字段级 LWW 需要时间戳；DB 列本就存在）。
      await write("UPDATE notes SET is_locked=?, locked_at=? WHERE id=?", [locked ? 1 : 0, editLockedAt, noteId]);
      const snap = snapshot.get(noteId);
      if (snap) { snap.is_locked = locked ? 1 : 0; snap.locked_at = editLockedAt; }
    },
    async setNodeIcon(noteId: string, icon: string): Promise<void> {
      // 261112 G3（与桌面 applyRemoteNodeIcon 同口径）：**同步镜像写**，只写 notes.icon，
      // 不经用户入口（bridge.saveNote/桌面 setNodeIcon 的回收站守卫）⇒ 回收站行可正常接收远端图标，
      // 不会让整轮 syncNow 失败；purged 行在移动端已被物理删除（行不存在 ⇒ UPDATE 影响 0 行，不抛错）。
      // importRemoteNote 已把 icon 写在同一批里 ⇒ 不再补一条重复 UPDATE（与旧实现同一批语句数）。
      if (batch?.importedIds.has(noteId)) return;
      await write("UPDATE notes SET icon=? WHERE id=?", [icon, noteId]);
      const snap = snapshot.get(noteId);
      if (snap) snap.icon = icon;
    },
    async deleteNote(noteId: string): Promise<void> {
      // 远端墓碑 → 进回收站（软删）：时间戳优先用本轮 state 的远端 trashedAt（旧实现同口径）。
      const trashedAt = ctx.remoteTrashedAt.get(noteId) ?? nowIso();
      await write("UPDATE notes SET trashed_at=?, is_dirty=1, restore_pending_at=NULL WHERE id=?", [trashedAt, noteId]);
      const snap = snapshot.get(noteId);
      if (snap) snap.trashed_at = trashedAt;
    },
    /**
     * 收敛删除（端口可选能力；core 只在「本机有、本轮状态没有」时调用 = **远端驱动删除**；
     * 本机用户显式 purge 在 UI 层已删行 + 写墓碑，不会走到这里）。
     * 261112 task-74：**软删保副本** —— 进回收站并打「云端已删除（仅本地）」投影
     * （保留正文/父级、可恢复、不参与 S3）；不再写 deleted_notes 墓碑、不再物理删行/正文。
     * 对齐桌面端口：桌面不实现本方法 ⇒ core 回落 deleteNote（软删）；本实现额外补 cloud_deleted 标记。
     */
    async purgeLocalNote(noteId: string): Promise<void> {
      const now = nowIso();
      await write(
        "UPDATE notes SET trashed_at=COALESCE(trashed_at, ?), deleted_from_parent_id=COALESCE(deleted_from_parent_id, parent_id), cloud_deleted=1, is_dirty=0, restore_pending_at=NULL WHERE id=?",
        [now, noteId],
      );
      const snap = snapshot.get(noteId);
      if (snap) snap.trashed_at = snap.trashed_at ?? now;
    },
    async restoreTrashItem(noteId: string): Promise<void> {
      await write("UPDATE notes SET trashed_at=NULL, is_dirty=1 WHERE id=?", [noteId]);
      const snap = snapshot.get(noteId);
      if (snap) snap.trashed_at = null;
    },
    async applyNotesCloudDeleted(noteIds: string[]): Promise<void> {
      // 仅置位（core 在移动端走 applyCloudDeletedProjection；此方法只作接口兜底，不清无关标记）。
      for (const part of chunk(noteIds, 400)) {
        const ph = part.map(() => "?").join(",");
        await db.prepare("UPDATE notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
      }
    },
    async markBodyRecoveryPending(): Promise<void> { /* 移动端无正文恢复队列 */ },
    async clearBodyRecoveryPending(): Promise<void> { /* 同上 */ },

    // ===== 目录写 =====
    async importRemoteFolder(folder: SyncFolderRow): Promise<void> {
      // 日记本标记随目录行落地（未知值/缺字段 = 非日记，见 core/diary.normalizeFolderSpace）。
      await db.prepare(
        "INSERT INTO folders (id,title,parent_id,sort_order,node_type,icon,updated_at,trashed_at,deleted_from_parent_id,is_dirty,space) VALUES (?,?,?,?,?,?,?,?,?,1,?)"
      ).run(folder.id, folder.title, folder.parentId, folder.sortOrder, folder.nodeType, folder.icon ?? null, folder.updatedAt, folder.trashedAt ?? null, folder.deletedFromParentId ?? null, normalizeFolderSpace(folder.space));
    },
    async applyRemoteFolderMeta(folder: SyncFolderRow): Promise<void> {
      // 落库侧 space 单调闸（261113；与桌面 noteMetadataRepository.diarySafeFolderSpace 同口径）：
      // 本地已是 diary ⇒ 远端写 null 也绝不降级（space 只允许 null → diary，AGENTS §3#25①）。
      // 合并层（core s3v3Merge.enforceDiarySpaceMonotone）已首选重发布；这里兜脏计划/旧包/直接恢复。
      const existing = await db.prepare("SELECT space FROM folders WHERE id=?").get(folder.id) as { space: string | null } | undefined;
      const space = mergeFolderSpace(existing?.space ?? null, folder.space);
      if (normalizeFolderSpace(existing?.space) === DIARY_FOLDER_SPACE && normalizeFolderSpace(folder.space) !== DIARY_FOLDER_SPACE) {
        console.warn("[sync] 拒绝把日记本降级为普通笔记本（space 只允许 null→diary）:", folder.id);
      }
      await db.prepare(
        "UPDATE folders SET title=?,parent_id=?,sort_order=?,node_type=?,icon=?,updated_at=?,trashed_at=?,deleted_from_parent_id=?,is_dirty=1,space=? WHERE id=?"
      ).run(folder.title, folder.parentId, folder.sortOrder, folder.nodeType, folder.icon ?? null, folder.updatedAt, folder.trashedAt ?? null, folder.deletedFromParentId ?? null, space, folder.id);
    },
    async deleteTreeNode(nodeId: string): Promise<void> {
      await db.prepare("DELETE FROM folders WHERE id=?").run(nodeId);
    },

    // ===== 小记写 =====
    async listMissingQuickNoteIds(): Promise<string[]> {
      return []; // 移动端不做「行在、正文没了」的收尸扫描（旧实现也没有；缺失由资源页/缺正文判据处理）
    },
    async purgeOrphanQuickNote(): Promise<void> {
      throw new Error("移动端不做小记收尸（listMissingQuickNoteIds 恒空）");
    },
    async importRemoteQuickNote(item: QuickNoteWrite, body: Uint8Array, _assets: QuickAssetWrite[]): Promise<void> {
      const text = new TextDecoder().decode(body);
      const row = await db.prepare("SELECT deleted_at, content_hash FROM quick_notes WHERE id=?").get(item.id) as
        { deleted_at: string | null; content_hash: string } | undefined;
      const purged = ctx.remotePurged.has(item.id);
      if (purged) {
        // 「云端已删除·仅本地」副本：只读保留（旧实现 purged 分支：不写正文/标签，仅落行/标记）。
        if (!row) {
          await db.prepare(
            "INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,restore_pending_at,deleted_at,cloud_deleted) VALUES (?,?,?,'',0,?,0,?,NULL,?,1)"
          ).run(item.id, item.createdAt, item.updatedAt, item.contentHash, item.isConflict ? 1 : 0, nowIso());
        } else if (row.deleted_at === null) {
          await db.prepare("UPDATE quick_notes SET deleted_at=?, is_dirty=0, cloud_deleted=1 WHERE id=?").run(nowIso(), item.id);
        }
        return;
      }
      // 远端 active 条目回来 = 他端恢复/显式恢复：清本地 purged 墓碑。
      await db.prepare("DELETE FROM quick_note_deleted WHERE id=?").run(item.id);
      // 与旧实现一致：同步导入当场回填列表元数据（预览/图片数/首图），否则首页卡片空白、imageCount=0。
      const parsed = (() => {
        try { return validateQuickNoteContent(JSON.parse(text)); } catch { return null; }
      })();
      const preview = parsed ? previewQuickNote(parsed.text, parsed.images.length) : "";
      const imageCount = parsed?.images.length ?? 0;
      const firstImage = parsed?.images?.[0]?.filename ?? null;
      await writeQuickNoteBody(item.id, text);
      if (!row) {
        await db.prepare(
          "INSERT INTO quick_notes (id,created_at,updated_at,preview_text,image_count,content_hash,is_dirty,is_conflict,restore_pending_at,first_image,list_metadata_version) VALUES (?,?,?,?,?,?,1,?,NULL,?,1)"
        ).run(item.id, item.createdAt, item.updatedAt, preview, imageCount, item.contentHash, item.isConflict ? 1 : 0, firstImage);
      } else if (row.deleted_at !== null) {
        // 回收站副本被显式恢复 / 远端重新出现：激活（正文/预览/标签原样保留）。
        await db.prepare(
          "UPDATE quick_notes SET updated_at=?, content_hash=?, is_dirty=1, is_conflict=?, deleted_at=NULL, cloud_deleted=0, restore_pending_at=NULL, preview_text=?, image_count=?, first_image=?, list_metadata_version=1 WHERE id=?"
        ).run(item.updatedAt, item.contentHash, item.isConflict ? 1 : 0, preview, imageCount, firstImage, item.id);
      } else {
        await db.prepare(
          "UPDATE quick_notes SET updated_at=?, content_hash=?, is_dirty=1, preview_text=?, image_count=?, first_image=?, list_metadata_version=1 WHERE id=?"
        ).run(item.updatedAt, item.contentHash, preview, imageCount, firstImage, item.id);
      }
    },
    async markQuickNoteSyncedIfUnchanged(quickNoteId: string, expectedContentHash: string): Promise<void> {
      await db.prepare("UPDATE quick_notes SET is_dirty=0, restore_pending_at=NULL WHERE id=? AND content_hash=?").run(quickNoteId, expectedContentHash);
    },
    async applyNoteTagLinks(noteId: string, tagIds: string[], tagsUpdatedAt: string): Promise<void> {
      // 261105 P1：文档关系 LWW；先按远端 id 落关系（目录可能同一轮才到达），目录收敛统一在 pruneNoteTagLinks。
      await applyRemoteNoteTags(db, noteId, tagIds, tagsUpdatedAt);
    },
    async pruneNoteTagLinks(validTagIds: readonly string[]): Promise<void> {
      await cleanupOrphanNoteTagLinks(db, new Set(validTagIds));
    },
    // P2-E：文档标签关系版本批量读（主库 tag_link_versions 一次查询；只报有版本的行）。
    async listNoteTagVersions(): Promise<Map<string, string>> {
      return listAllNoteTagsUpdatedAt(db);
    },
    async applyQuickNoteTagLinks(quickNoteId: string, tagIds: string[], tagsUpdatedAt: string): Promise<void> {
      // 与桌面同一套关系 LWW：远端更新才覆盖；过滤墓碑标签（删除的关系不复活）、去重、超上限截断。
      // **不按 ID 形态过滤**：旧版本/旧索引里可能已有非 `t_` 形态的标签 ID，按正则过滤会静默丢关联（迁移风险）。
      const version = tagsUpdatedAt || ((await db.prepare("SELECT updated_at FROM quick_notes WHERE id=?").get(quickNoteId) as { updated_at?: string } | undefined)?.updated_at ?? nowIso());
      const currentVersion = (await db.prepare("SELECT links_updated_at FROM tag_link_versions WHERE target_kind='quickNote' AND target_id=?").get(quickNoteId) as { links_updated_at?: string } | undefined)?.links_updated_at ?? "";
      if (!version || version <= currentVersion) return;
      const deletedRows = await db.prepare("SELECT id FROM tags WHERE deleted_at IS NOT NULL").all() as Array<{ id: string }>;
      const deleted = new Set(deletedRows.map((row) => String(row.id)));
      const seen = new Set<string>();
      const remoteIds: string[] = [];
      for (const id of tagIds) {
        if (typeof id !== "string" || !id.trim() || deleted.has(id) || seen.has(id)) continue;
        seen.add(id);
        remoteIds.push(id);
        if (remoteIds.length >= MAX_QUICK_NOTE_TAGS) break;
      }
      // 顺序是设备本地视图：保留本机已有标签的顺序，远端新增标签插到最前（与本地新加一致）。
      const localRows = await db.prepare("SELECT tag_id FROM tag_links WHERE target_kind='quickNote' AND target_id=? ORDER BY position, tag_id").all(quickNoteId) as Array<{ tag_id: string }>;
      const localIds = localRows.map((row) => String(row.tag_id));
      const remoteSet = new Set(remoteIds);
      const localKept = localIds.filter((id) => remoteSet.has(id));
      const localSet = new Set(localIds);
      const added = remoteIds.filter((id) => !localSet.has(id));
      const next = [...added, ...localKept].slice(0, MAX_QUICK_NOTE_TAGS);
      await db.transaction(async () => {
        await db.prepare("DELETE FROM tag_links WHERE target_kind='quickNote' AND target_id=?").run(quickNoteId);
        for (let index = 0; index < next.length; index += 1) {
          await db.prepare("INSERT OR IGNORE INTO tag_links (target_kind,target_id,tag_id,position) VALUES ('quickNote',?,?,?)").run(quickNoteId, next[index], index);
        }
        await db.prepare("INSERT INTO tag_link_versions(target_kind,target_id,links_updated_at) VALUES ('quickNote',?,?) ON CONFLICT(target_kind,target_id) DO UPDATE SET links_updated_at=excluded.links_updated_at").run(quickNoteId, version);
      });
    },
    /**
     * 目录落库（删除 = 缺席）：upsert active 行 + 对 removedIds **物理删行并清关联/版本**（单事务）。
     * 顺序是设备本地视图，这里不碰已有行的 sort_order（新行追加末尾）。
     */
    async mergeQuickTags(tags: QuickTagRow[], removedIds: readonly string[] = []): Promise<void> {
      const beforeRows = await db.prepare("SELECT id,name FROM tags").all() as Array<{ id: string; name: string }>;
      const before = new Map(beforeRows.map((row) => [String(row.id), String(row.name)] as const));
      const { removedNoteIds } = await applyQuickTagDirectory(db, tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt,
      })), removedIds);
      // 改名会改变搜索索引里缓存的标签名 ⇒ 只重刷「关联到这些标签的小记」（不全量重建）。
      const renamed = tags.filter((tag) => before.get(tag.id) !== tag.name).map((tag) => tag.id);
      if (renamed.length > 0) await reindexQuickNotesForTags(db, renamed);
      // 删标签会清掉关联 ⇒ 受影响小记的标签列要重刷（id 在落库前已收集）。
      if (removedNoteIds.length > 0) await reindexQuickNotesByIds(db, removedNoteIds);
    },
    /**
     * 移动端旧语义（端口各自表达平台差异，core 不 if(platform)）：
     * 能走到这里的 purge = 他端 purged 墓碑带下来的（本地用户彻底删除会先把行删掉，同步时这行根本不存在）；
     * ⇒ 保留 quick 回收站副本 +「云端已删除·仅本地」标，正文/图片/标签不删
     *（用户 261026 定稿：被他端判定缺失的本地副本保留在回收站、可恢复）。
     */
    async purgeQuickNote(quickNoteId: string): Promise<void> {
      const row = await db.prepare("SELECT deleted_at FROM quick_notes WHERE id=?").get(quickNoteId) as { deleted_at: string | null } | undefined;
      if (!row) return;
      await db.prepare("UPDATE quick_notes SET deleted_at=?, is_dirty=0, ready_to_sync=0, restore_pending_at=NULL WHERE id=?").run(row.deleted_at ?? nowIso(), quickNoteId);
      ctx.newlyCloudDeletedQuick.add(quickNoteId);
    },
    async deleteQuickNote(quickNoteId: string): Promise<void> {
      // 软删进小记回收站（cloud_deleted 由随后的 markQuickNotesCloudDeleted 置位）。
      await db.prepare("UPDATE quick_notes SET deleted_at=?, is_dirty=0, ready_to_sync=0, restore_pending_at=NULL WHERE id=?").run(nowIso(), quickNoteId);
    },
    async markQuickNotesCloudDeleted(quickNoteIds: string[]): Promise<void> {
      for (const part of chunk(quickNoteIds, 400)) {
        const ph = part.map(() => "?").join(",");
        await db.prepare("UPDATE quick_notes SET cloud_deleted=1 WHERE id IN (" + ph + ")").run(...part);
      }
      for (const id of quickNoteIds) ctx.newlyCloudDeletedQuick.add(id);
    },
    async discardQuickNote(quickNoteId: string): Promise<void> {
      // 从未同步过的小记从 state 消失 = 物理删除（行 + 正文 + 图片 + 关系），不留墓碑/不传删除。
      await db.transaction(async () => {
        await db.prepare("DELETE FROM tag_links WHERE target_kind='quickNote' AND target_id=?").run(quickNoteId);
        await db.prepare("DELETE FROM tag_link_versions WHERE target_kind='quickNote' AND target_id=?").run(quickNoteId);
        await db.prepare("DELETE FROM quick_notes WHERE id=?").run(quickNoteId);
      });
      await deleteQuickNoteBody(quickNoteId).catch(() => undefined);
      for (const key of await listQuickNoteAssetKeysFs(quickNoteId)) await removeAssetBytesFs(key);
    },
  };
}

/**
 * 移动端正文 FileDriver（共享 loadState/saveState 的「content_hash 为空时读盘补算」+ 小记正文读取）。
 * 路径约定：note:{id}（kind 由 DB 现查）/ qnote:{id}；stat 读一次并缓存字节，避免共享层 stat→read 双读。
 *
 * stagedQuickBodies：引擎本轮通过 writeQuickBody 暂存的小记正文（在 JS 内存，未落盘）。
 * saveState 的共享编排通过本驱动读小记正文 ⇒ 必须先看 staging，否则会把「本轮刚写入的小记」当成缺正文跳过。
 * staging 是瞬态的，不参与缓存。
 */
export function createMobileBodyFileDriver(
  db: MobileDb,
  opts: { stagedQuickBodies?: () => ReadonlyMap<string, Uint8Array> } = {},
): FileDriver {
  const cache = new Map<string, Uint8Array | null>();
  const kindOf = async (id: string): Promise<NoteKind> => {
    const row = await db.prepare("SELECT doc_kind FROM notes WHERE id=?").get(id) as { doc_kind?: string | null } | undefined;
    return normalizeNoteKind(row?.doc_kind);
  };
  const readPath = async (path: string): Promise<Uint8Array | null> => {
    if (path.startsWith("qnote:")) {
      const staged = opts.stagedQuickBodies?.().get(path.slice(6));
      if (staged) return new Uint8Array(staged);
    }
    if (cache.has(path)) return cache.get(path)!;
    let bytes: Uint8Array | null = null;
    try {
      if (path.startsWith("note:")) {
        const content = await readNoteBody(await kindOf(path.slice(5)), path.slice(5));
        bytes = content == null ? null : new TextEncoder().encode(content);
      } else if (path.startsWith("qnote:")) {
        const content = await readQuickNoteBody(path.slice(6));
        bytes = content == null ? null : new TextEncoder().encode(content);
      }
    } catch { bytes = null; }
    cache.set(path, bytes);
    return bytes;
  };
  return {
    async read(path) {
      const bytes = await readPath(path);
      return bytes ? new Uint8Array(bytes) : null;
    },
    async stat(path) {
      const bytes = await readPath(path);
      return bytes ? { size: bytes.length, mtimeMs: 0 } : null;
    },
    async writeAtomic(path, bytes) {
      if (path.startsWith("note:")) {
        const id = path.slice(5);
        await writeNoteBody(await kindOf(id), id, new TextDecoder().decode(bytes));
      } else if (path.startsWith("qnote:")) {
        await writeQuickNoteBody(path.slice(6), new TextDecoder().decode(bytes));
      } else throw new Error("非法正文路径: " + path);
      cache.set(path, new Uint8Array(bytes));
    },
    async remove(path) {
      if (path.startsWith("note:")) await deleteNoteBodies(path.slice(5));
      else if (path.startsWith("qnote:")) await deleteQuickNoteBody(path.slice(6));
      cache.delete(path);
    },
    async removeDir() { /* 正文目录按类型组织，不支持整目录删（共享层当前不使用） */ },
    async list() { return []; },
    async mkdir() { /* no-op */ },
  };
}