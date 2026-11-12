/** C3-5 第③步：notes 域（从 bridge.ts 抽取，行为保持）。 */
import { assertS3Credentials, assets, dbPort, ensureDb, readSyncSettings, runMaintenance, runPriority, runWrite } from "./context";
import { reconcileIndex } from "../data/searchIndex.js";
import { backfillTextCache } from "../data/textCacheBackfill.js";

import { scanAssetCards, fileKindOf } from "../../core/fileCard.js";
import { lakeHtmlToPlain } from "../../core/lakeCaches.js";
import { searchTextForKind } from "../../core/noteSearchText.js";
import { countTextStats } from "../../core/textStats.js";
import { emptyLakeBody } from "../../core/lakeDocForm.js";
import { emptyMobileUsheetBody } from "../usheet/mobileSheetGrid.js";
import { emptyBoardBody } from "../../core/boardDoc.js";
import { emptyBitableBody } from "../../core/bitableDoc.js";
import { emptyInkBody } from "../../core/inkDoc.js";
import { normalizeNoteKind, type NoteKind } from "../../core/noteKind.js";
import { canTouchNetwork } from "../../core/cloudState.js";
import { sha256Hex } from "../../core/syncUtils.js";
import type { MobileSearchResult } from "../search/searchTypes.js";
import { normalizeSearchScope, type SearchScope } from "../search/searchScope.js";

import * as noteRepository from "../data/noteRepository.js";
import * as noteTagLinksRepository from "../data/noteTagLinksRepository.js";
import { assertQuickNoteTagsExist } from "../data/quickNoteTagsRepository.js";
import { noteBodyPath } from "../data/noteBodies.js";
import { applyRestoredNoteBody, scanMissingBodies, type MissingBodiesSnapshot } from "../data/missingBodies.js";
import { mobileReadonlyReason } from "../lib/readonlyText.js";
import type { LocalNote } from "../data/noteRepository.js";
import type { MobileDb } from "../data/sqliteDb.js";
import * as trashRepository from "../data/trashRepository.js";
import * as historyRepository from "../data/historyRepository.js";
import type { HistoryMobileSettings } from "../data/historyRepository.js";
import * as syncConflictRepository from "../data/syncConflictRepository.js";
import { downloadDeclaredAssetsFor, ensureAssetsNative, mobileCloudState, syncDomain } from "./sync";


/**
 * 恢复历史版本专用写路径（history / sync-conflict 恢复共用；261112 task-53 修正口径）：
 * **「恢复历史版本」只写回内容，不改变生命周期**（用户裁决：只有回收站里显式「恢复」才改生命周期）。
 * 对齐桌面 `NoteContentRepository.restoreHistory`（直接写正文、行仍留在回收站）。
 *  - 目标已被彻底删除（墓碑 / is_purged）⇒ 明确拒绝「不可恢复」；
 *  - 目标在回收站 ⇒ 走允许写回收站行的恢复专用写（等价桌面 saveSynced/allowTrashed）：
 *    只写正文/标题/派生缓存，**不动 trashed_at / parent_id / restore_pending_at**；
 *  - 其余按普通保存正文（不创建新行；不吞错 —— 失败由调用方转成结构化失败文案）。
 * 写域：与用户保存同一队列（runWrite("saveNote")），但不经过用户保存守卫。
 */
async function saveRestoredSnapshot(d: MobileDb, noteId: string, title: string, content: string): Promise<void> {
  const purgedMessage = "笔记已被彻底删除（不可恢复），无法恢复历史版本";
  if (await noteRepository.isTombstoned(d, noteId)) throw new Error(purgedMessage);
  await runWrite("saveNote", async () => {
    await noteRepository.saveRestoredNoteContent(d, noteId, title, content);
  });
}

export const notesDomain = {
  async readNote(id: string): Promise<LocalNote | null> {
    const d = await ensureDb();
    const note = await noteRepository.readNote(d, id);
    // 按需资产（P0-4，261026）：打开文档时补齐该篇声明里缺失的媒体，保证首屏图片可见。
    // 只有「按需下载附件」打开时才走网络；失败静默（下次打开/同步再补）。
    if (note && readSyncSettings().deferAssets === true) {
      try {
        // 复用维护域「保证某篇资产」这个操作（语义一致；避免为一个内部调用新增桥操作/类别）。
        // 261027：走原生 getToFile 快速路径（字节不过桥），比通用 backfill 快。
        await runMaintenance("ensureTrashNoteAssets", () => ensureAssetsNative([id]));

      } catch (error) {
        console.warn("[asset] 打开文档时补拉失败（下次再试）", error);
      }
    }
    return note;
  },

  async noteGoneState(id: string): Promise<{ parentId: string | null; syncState: string } | null> {
    const d = await ensureDb();
    return await noteRepository.noteGoneState(d, id);
  },

  /**
   * 全文搜索。scope = 设备本地视图的范围筛选（全部/标题/正文/标签，定义见 search/searchScope.ts）；
   * 入口（UI/旧调用）传任意值时回落「全部」，不让参数错误把搜索打空。
   */
  async searchNotes(query: string, scope: SearchScope = "all"): Promise<MobileSearchResult[]> {
    const d = await ensureDb();
    return await noteRepository.searchNotes(d, query, normalizeSearchScope(scope));
  },

  /**
   * 派生搜索索引的后台自愈（261026）：同步批量导入不再逐篇建 FTS（正文阶段快 ~60s），
   * 改由冷启动/回前台时按需补齐。已补完时只是两次 COUNT，几乎零成本；中途被杀下次接着来（幂等）。
   */
  async ensureSearchIndex(): Promise<{ notes: number; indexed: number; rebuilt: boolean; textFilled: number }> {
    const d = await ensureDb();
    const count = async (sql: string): Promise<number> => {
      try { return Number(((await d.prepare(sql).get()) as { c?: number } | undefined)?.c ?? 0); } catch { return 0; }
    };
    const notes = await count("SELECT count(*) AS c FROM notes WHERE trashed_at IS NULL");
    const before = await count("SELECT count(*) AS c FROM search_index");
    if (before >= notes) return { notes, indexed: before, rebuilt: false, textFilled: 0 };
    let textFilled = 0;
    await runMaintenance("ensureSearchIndex", async () => {
      // 261027：导入只写 NULL text_cache；这里先补纯文本，再建 FTS（都幂等可续跑）。
      textFilled = (await backfillTextCache(d)).filled;
      await reconcileIndex(d);
    });
    const after = await count("SELECT count(*) AS c FROM search_index");
    return { notes, indexed: after, rebuilt: true, textFilled };
  },

  async saveNote(id: string, title: string, content: string, parentId: string | null = null, plain?: string, kind: NoteKind = "doc"): Promise<void> {
    return runWrite("saveNote", async () => {
      const d = await ensureDb();
      const state = await noteRepository.noteWriteState(d, id);
      if (state === "gone") throw new Error("笔记已在回收站或已被删除，保存被拒绝；请先显式恢复");
      if (state === "missing") {
        // 261112 task-56（N5）：与桌面 `electron/noteContentRepository` 的 purged 文案逐字对齐（含「不可恢复」）。
        if (await noteRepository.isTombstoned(d, id)) throw new Error("笔记已被彻底删除（不可恢复），保存被拒绝；已删除条目不可复原");
        await noteRepository.createNote(d, id, title, content, parentId, assets, plain, kind);
        return;
      }
      // 261112 task-56（N4）：编辑锁 = 只读。用户保存入口必须明确拒绝（同步专用写/显式恢复不经此守卫）。
      const lock = await d.prepare("SELECT is_locked FROM notes WHERE id=?").get(id) as { is_locked: number } | undefined;
      if (lock?.is_locked === 1) {
        // task-67：原因文案单一来源 = core/capabilities/readonlyReason（移动端只覆盖解除动作措辞）。
        const readonly = mobileReadonlyReason({ locked: true });
        throw new Error(`${readonly?.title ?? "文档已锁定（只读）"}，保存被拒绝；${readonly?.releaseHint ?? "请先在桌面端解锁后再编辑"}`);
      }
      await noteRepository.saveNote(d, id, title, content, parentId, assets, plain);
    });
  },

  async listNoteHistory(noteId: string): Promise<Array<{ id: number; title: string; createdAt: string }>> {
    const d = await ensureDb();
    return await historyRepository.listNoteHistory(d, noteId);
  },


  async getNoteInfo(id: string) {
    const d = await ensureDb();
    const note = await noteRepository.readNote(d, id);
    if (!note) throw new Error("笔记不存在");
    const row = await d.prepare("SELECT is_dirty, is_purged, is_conflict, updated_at, is_locked, locked_at FROM notes WHERE id=?").get(id) as
      { is_dirty: number; is_purged: number; is_conflict: number; updated_at: string; is_locked: number; locked_at: string | null } | undefined;
    // 与搜索索引共用同一条按 kind 分派的派生口径；表格/多维表/画板正文是 JSON，不能喂 Lake HTML 解析器。
    const plain = searchTextForKind(note.kind, note.content).plain ?? "";
    // 字数/字符数 = 与内核 wordCount 同语义的单一来源（261016，B1；此前这里另写了一套正则）。
    const { charCount, wordCount } = countTextStats(plain);
    const seen = new Set<string>();
    const assets: Array<{ filename: string; size: number; kind: string }> = [];
    for (const card of scanAssetCards(note.content)) {
      if (!card.filename || seen.has(card.filename)) continue;
      seen.add(card.filename);
      assets.push({ filename: card.filename, size: card.size, kind: fileKindOf(card.filename) });
    }
    const cardCounts = new Map<string, number>();
    for (const m of note.content.matchAll(/<card\b[^>]*\bname="([^"]+)"/g)) cardCounts.set(m[1], (cardCounts.get(m[1]) ?? 0) + 1);
    const tableCount = (note.content.match(/<table\b/g) ?? []).length;
    if (tableCount > 0) cardCounts.set("table", (cardCounts.get("table") ?? 0) + tableCount);
    const labels: Record<string, string> = { image: "图片", video: "视频", audio: "音频", file: "附件", codeblock: "代码块", table: "表格", board: "画板", mindmap: "思维导图", bookmark: "书签", database: "数据库", hr: "分隔线", math: "公式" };
    const cardStats = [...cardCounts.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: labels[key] ?? key, count }));
    const parents: Array<{ id: string; title: string }> = [];
    let pid = note.parentId;
    let guard = 0;
    while (pid && guard++ < 64) {
      const parent = (await d.prepare("SELECT id,title,parent_id FROM folders WHERE id=?").get(pid)
        ?? await d.prepare("SELECT id,title,parent_id FROM notes WHERE id=?").get(pid)) as
        { id: string; title: string; parent_id: string | null } | undefined;
      if (!parent) break;
      parents.unshift({ id: parent.id, title: parent.title });
      pid = parent.parent_id;
    }
    const history = (await historyRepository.listNoteHistory(d, id)).map((h) => ({ id: h.id, createdAt: h.createdAt, size: 0 }));
    return {
      id,
      title: note.title,
      parentPath: parents.map((p) => p.title).join(" / "),
      parents,
      cardStats,
      createdAt: null,
      updatedAt: row?.updated_at ?? note.updatedAt,
      isDirty: row ? row.is_dirty === 1 : true,
      isPurged: row?.is_purged === 1,
      isConflict: Boolean(row?.is_conflict),
      // 261112 task-56（N4）：锁字段必须透出（此前硬编码 false ⇒ 移动端完全不知道文档被锁）。
      isEditLocked: row?.is_locked === 1,
      editLockedAt: row?.locked_at ?? null,
      lakePath: noteBodyPath(note.kind, note.id),
      assetsDir: `note-assets/${id}`,
      sizeBytes: new TextEncoder().encode(note.content).length,
      charCount,
      wordCount,
      assets,
      assetTotalBytes: assets.reduce((sum, a) => sum + a.size, 0),
      history,
    };
  },

  async previewHistorySnapshot(historyId: number) {
    const d = await ensureDb();
    const h = await historyRepository.readHistory(d, historyId);
    if (!h) return null;
    return { plain: lakeHtmlToPlain(h.content), html: h.content, createdAt: "", contentHash: "" };
  },

  async restoreHistory(historyId: number): Promise<void> {
    const d = await ensureDb();
    const mobileDb = d;
    const snapshot = await historyRepository.readHistory(mobileDb, historyId);
    // 不得静默失败（task-53）：快照已被清理/文件缺失时与桌面一样明确报错，而不是无声返回。
    if (!snapshot) throw new Error("历史快照已过期或被清理，无法恢复");
    await historyRepository.backupCurrentNote(mobileDb, snapshot.noteId);
    // task-53：恢复专用写（回收站中的目标先出回收站再写正文；不复用用户保存守卫）。
    await saveRestoredSnapshot(mobileDb, snapshot.noteId, snapshot.title, snapshot.content);
  },

  async deleteHistory(historyId: number): Promise<void> {
    await runWrite("deleteHistory", async () => {
      const d = await ensureDb();
      await historyRepository.deleteHistory(d, historyId);
    });
  },

  async getHistorySettings(): Promise<HistoryMobileSettings> {
    const d = await ensureDb();
    return await historyRepository.getHistorySettings(d);
  },

  async saveHistorySettings(settings: HistoryMobileSettings): Promise<void> {
    await runWrite("saveHistorySettings", async () => {
      const d = await ensureDb();
      await historyRepository.saveHistorySettings(d, settings);
    });
  },

  async snapshotNote(noteId: string): Promise<void> {
    await runWrite("snapshotNote", async () => {
      const d = await ensureDb();
      await historyRepository.snapshotNote(d, noteId);
    });
  },

  async cleanupHistory(): Promise<{ deleted: number }> {
    return runWrite("cleanupHistory", async () => {
      const d = await ensureDb();
      const mobileDb = d;
      return await historyRepository.cleanupHistory(mobileDb, await historyRepository.getHistorySettings(mobileDb));
    });
  },

  // ---- 261105 文档标签（与桌面同名通道）：单库直接写 tag_links(kind='note') + bump 关系版本 ----
  /**
   * 全部文档 ↔ 标签关系（noteId → tagIds，本机 position 顺序）。
   * 用途：目录行菜单「标签…」时预选、以及移动端展示（只读）。
   */
  async listNoteTagLinks(): Promise<Record<string, string[]>> {
    const d = await ensureDb();
    const map = await noteTagLinksRepository.listAllNoteTagIds(d);
    return Object.fromEntries(map);
  },

  /**
   * 整组替换某篇文档的标签（桌面 set_note_tags 同语义）：
   * 目录存在性校验 → 写 tag_links(kind='note') → bump tag_link_versions（关系 LWW 才能传播）。
   * 移动端是单库写；**不写正文**（关系独立于正文 hash）。
   */
  async setNoteTags(noteId: string, tagIds: string[]): Promise<{ tagIds: string[] }> {
    return runWrite("setNoteTags", async () => {
      const d = await ensureDb();
      const note = await d.prepare("SELECT 1 AS one FROM notes WHERE id=?").get(noteId) as unknown;
      if (!note) throw new Error("笔记不存在");
      // 目录是唯一来源：不存在/已删的标签一律拒绝（展示层也会过滤远端遗留 id）。
      await assertQuickNoteTagsExist(d, tagIds);
      const next = await noteTagLinksRepository.setNoteTags(d, noteId, tagIds);
      return { tagIds: next };
    });
  },

  // ---- 261105 P1 第 4 项：同步记录账本（设备本地；UI 另任务） ----
  async listSyncConflicts(): Promise<{ items: syncConflictRepository.MobileSyncConflictRow[]; unacked: number }> {
    const d = await ensureDb();
    return await syncConflictRepository.listSyncConflicts(d);
  },

  async ackSyncConflicts(ids?: string[]): Promise<{ acked: number; unacked: number }> {
    return runWrite("ackSyncConflicts", async () => {
      const d = await ensureDb();
      return await syncConflictRepository.ackSyncConflicts(d, ids);
    });
  },

  /**
   * 恢复动作（可挽回）：remote_wins 用历史快照恢复本地版（bump dirty ⇒ 下次同步 local-wins）；
   * 失败**不抛**：返回 { ok:false, reason, message } 供 UI 给明确文案。
   */
  async restoreSyncConflict(id: string): Promise<{ ok: true; noteId: string; restoredFromHistory: boolean } | { ok: false; reason: string; message: string }> {
    const d = await ensureDb();
    const row = await syncConflictRepository.getSyncConflict(d, id);
    if (!row) return { ok: false, reason: "not-found", message: "同步记录不存在" };
    // P2-D：已处理过的记录**不再返回 ok:true**（否则 UI 会提示"已恢复"但实际什么都没做）。
    // 语义显式化为 already-resolved：UI 给中性提示并刷新列表。
    if (row.resolvedAt) {
      return { ok: false, reason: "already-resolved", message: "这条同步记录已经处理过（无需重复恢复）" };
    }
    if (row.kind === "save_external_changed") return { ok: false, reason: "unsupported", message: "外部改动是审计记录，没有可恢复的目标版本" };
    if (row.kind !== "remote_wins" || row.space !== "lake") {
      return { ok: false, reason: "unsupported", message: "该记录不支持在移动端恢复（请在对应回收站/历史入口处理）" };
    }
    if (!row.historyRef) return { ok: false, reason: "history-missing", message: "该记录没有可用的历史快照" };
    const historyId = Number(row.historyRef);
    if (!Number.isFinite(historyId)) return { ok: false, reason: "history-missing", message: "历史快照引用无效" };
    // 契约要求「失败不抛」：读历史/备份/写回/标记任一步都可能抛（回收站、已删、IO），统一收成结构化失败。
    try {
      const snapshot = await historyRepository.readHistory(d, historyId);
      if (!snapshot) return { ok: false, reason: "history-expired", message: "历史快照已过期或被清理，无法恢复" };
      await historyRepository.backupCurrentNote(d, snapshot.noteId);
      // task-53：同上 —— 恢复是显式例外；目标在回收站时先恢复行（离开回收站）再写正文。
      await saveRestoredSnapshot(d, snapshot.noteId, snapshot.title, snapshot.content);
      await syncConflictRepository.markSyncConflictResolved(d, id, "restored");
      return { ok: true, noteId: row.noteId, restoredFromHistory: true };
    } catch (error) {
      return { ok: false, reason: "internal", message: "恢复失败：" + (error instanceof Error ? error.message : String(error)) };
    }
  },

  async createNote(title: string, parentId: string | null = null): Promise<LocalNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // 无父新建 → 兜底父笔记本（存在的笔记本；无则自动创建"未分类"）
    const pid = parentId?.trim() ? parentId : await dbPort.defaultNotebookId();
    const content = emptyLakeBody(id);
    await notesDomain.saveNote(id, title, content, pid);
    return { id, title, content, updatedAt: now, parentId: pid, kind: "doc" };
  },
  async createInk(title: string, parentId: string | null = null): Promise<LocalNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const pid = parentId ?? await dbPort.defaultNotebookId();
    const content = emptyInkBody();
    await runWrite("createInk", async () => {
      const d = await ensureDb();
      await noteRepository.createNote(d, id, title, content, pid, new Map(), undefined, "ink");
    });
    return { id, title, content, updatedAt: now, parentId: pid, kind: "ink" };
  },


  /** 新建表格（kind=usheet）：正文 = 空表快照（35×16）+ **移动端网格**（24/120/40/24，单一来源 mobileSheetGrid），
   *  随后进入移动表格编辑器。桌面新建表仍走 core 的 88 口径（用户 261020 定：桌面保持原样）。 */
  async createUsheet(title: string, parentId: string | null = null): Promise<LocalNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const pid = parentId?.trim() ? parentId : await dbPort.defaultNotebookId();
    const content = emptyMobileUsheetBody();
    await notesDomain.saveNote(id, title, content, pid, undefined, "usheet");
    return { id, title, content, updatedAt: now, parentId: pid, kind: "usheet" };
  },

  /** 新建画板（kind=board）：正文 = 空 Drawnix 场景，随后进入移动画板编辑器。 */
  async createBoard(title: string, parentId: string | null = null): Promise<LocalNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const pid = parentId?.trim() ? parentId : await dbPort.defaultNotebookId();
    const content = emptyBoardBody();
    await notesDomain.saveNote(id, title, content, pid, undefined, "board");
    return { id, title, content, updatedAt: now, parentId: pid, kind: "board" };
  },

  /** 新建数据表（kind=bitable）：正文 = core 的产品默认（1 文本列 + 3 条空记录），随后进入移动多维表编辑器。 */
  async createBitable(title: string, parentId: string | null = null): Promise<LocalNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const pid = parentId?.trim() ? parentId : await dbPort.defaultNotebookId();
    const content = emptyBitableBody();
    await notesDomain.saveNote(id, title, content, pid, undefined, "bitable");
    return { id, title, content, updatedAt: now, parentId: pid, kind: "bitable" };
  },

  async trashNote(id: string): Promise<void> {
    return runWrite("trashNote", async () => {
      const d = await ensureDb();
      await noteRepository.trashNote(d, id);
    });
  },

  async ensureTrashNoteAssets(id: string): Promise<void> {
    return runMaintenance("ensureTrashNoteAssets", async () => {
      await downloadDeclaredAssetsFor([id], true);
    });
  },

  /**
   * 按需资产占位点击补拉（261027）：只补这几篇缺失的媒体（原生 getToFile 快速路径）。
   * 返回计数：0/0 通常表示离线、未配置云同步或本来就没有声明（调用方据此提示）。
   */
  async ensureNoteAssets(ids: string[]): Promise<{ downloaded: number; failed: number }> {
    // 高优先域（261027）：用户点占位图是当场动作，不能排在整轮同步后面；彼此串行即可。
    return runPriority("ensureNoteAssets", () => ensureAssetsNative(ids));
  },

  /** 小记图片按需补拉（261027 Phase2）：与文档同一条原生路径（getToFile 直写，空间换成 quickNotes）。 */
  async ensureQuickNoteAssets(ids: string[]): Promise<{ downloaded: number; failed: number }> {
    return runPriority("ensureQuickNoteAssets", async () => {
      const r = await ensureAssetsNative(ids, { space: "quickNotes" });
      return { downloaded: r.downloaded, failed: r.failed };
    });
  },

  async restoreNote(id: string): Promise<void> {
    return notesDomain.restoreTreeItem(id, "note");
  },

  async listTrashed(): Promise<LocalNote[]> {
    const d = await ensureDb();
    return await noteRepository.listTrashed(d);
  },

  async trashTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return runWrite("trashTreeItem", async () => {
      const d = await ensureDb();
      await trashRepository.trashTreeItem(d, id, kind);
      await reconcileIndex(d);
    });
  },

  async listTrashTree(): Promise<trashRepository.MobileTrashTreeItem[]> {
    const d = await ensureDb();
    return await trashRepository.listTrashTree(d);
  },

  async restoreTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return runWrite("restoreTreeItem", async () => {
      const d = await ensureDb();
      // 261006 B 方案（与桌面一致）：恢复**不等网络**。puller 立刻返回，缺失资源排到本次任务之后
      // 在后台按需补拉（onlyMissing，走**维护域**）：与当前写域不同域、且不 await ⇒ 不会自锁（I3）；失败只告警，下次同步补拉。
      await trashRepository.restoreTreeItem(d, id, kind, (noteIds) => {
        void runMaintenance("ensureTrashNoteAssets", () => downloadDeclaredAssetsFor(noteIds, true)).catch((error) => {
          console.warn("[trash] 恢复后的资源补拉失败（下次同步补拉）", error);
        });
        return Promise.resolve();
      });
      await reconcileIndex(d);
    });
  },

  /**
   * 彻底删除。返回是否真的删了（false = 自动过期守卫判定「已恢复/未到期」，一行未动）。
   * options 只由回收站自动清理（sync/trashAutoPurge）传入；手动删除不传，行为不变。
   */
  async purgeTreeItem(
    id: string,
    kind: "folder" | "note",
    options?: { expiredBefore?: string },
  ): Promise<boolean> {
    return runWrite("purgeTreeItem", async () => {
      const d = await ensureDb();
      const purged = await trashRepository.purgeTreeItem(d, id, kind, options);
      // 守卫跳过时没有行变化，不必重算派生索引（省一次全库 diff）。
      if (purged) await reconcileIndex(d);
      return purged;
    });
  },

  // ---- 缺正文（元数据在、正文文件缺失）· 资源管理入口（261104 B-lite）----

  /**
   * 缺正文清单（文档 + 小记）。只 stat 正文文件，**不读正文、不出网、不写库**。
   * 判据由 core/missingBody 的 missingBodyRecovery / missingQuickNoteRecovery 决定（两端同一套）。
   * cloudConfigured = 允许出网（已配置 S3 且未关闭云同步）：关闭云同步时「从云端拉回」一律不可用，
   * 不诱导用户点了才报错（AGENTS §3#20「关闭云同步 = 完全没配置」）。
   */
  async listMissingBodies(): Promise<MissingBodiesSnapshot> {
    const d = await ensureDb();
    return await scanMissingBodies(d, { cloudConfigured: canTouchNetwork(await mobileCloudState()) });
  },

  /**
   * 「从云端拉回」这一篇正文（用户显式发起，高优先域 = 不等整轮同步）。
   *
   * 链路与桌面 restoreMissingBodyFromCloud 同源（v3）：pointer → lake 索引 → 该篇 contentHash →
   * 内容寻址正文对象 objects/{id}-{hash}.lake → **校验 sha256** → 落盘并标 synced。
   * 失败一律明确回报 reason（不静默、不写空正文）；资产（图片/附件）走按需补拉 best-effort。
   *
   * **不得**改成整库 restoreFromCloud：那会清本机同步基线并按云端重建整库，语义过重。
   */
  async restoreMissingNoteBody(
    id: string,
  ): Promise<{ ok: true; title: string } | { ok: false; reason: "cloud-off" | "no-cloud-config" | "not-found" | "not-in-cloud" | "object-missing" | "hash-mismatch" }> {
    return runPriority("restoreMissingNoteBody", async () => {
      if (!canTouchNetwork(await mobileCloudState())) return { ok: false as const, reason: "cloud-off" as const };
      const cfg = await syncDomain.getS3Settings();
      if (!cfg) return { ok: false as const, reason: "no-cloud-config" as const };
      try { assertS3Credentials(cfg); } catch { return { ok: false as const, reason: "no-cloud-config" as const }; }
      const d = await ensureDb();
      const row = await d.prepare("SELECT title, doc_kind FROM notes WHERE id=? AND trashed_at IS NULL").get(id) as
        | { title: string; doc_kind?: string | null }
        | undefined;
      if (!row) return { ok: false as const, reason: "not-found" as const };
      const kind = normalizeNoteKind(row.doc_kind);
      // P9：v3 远端/协议常量按需加载（缺正文恢复是低频动作，不进首屏静态图）。
      const [{ createMobileS3v3Remote }, keys, indexMod, types] = await Promise.all([
        import("../v3/s3v3Remote.js"),
        import("../../core/s3v3/protocol/s3v3Keys.js"),
        import("../../core/s3v3/protocol/s3v3Index.js"),
        import("../../core/s3v3/protocol/s3v3Types.js"),
      ]);
      const remote = createMobileS3v3Remote(cfg);
      const pointerBytes = await remote.get(keys.S3V3_POINTER_KEY);
      if (!pointerBytes) return { ok: false as const, reason: "not-in-cloud" as const };
      let pointer: { lake: { commit: string } };
      try {
        const parsed = types.validatePointer(JSON.parse(new TextDecoder().decode(pointerBytes)));
        if (!parsed.ok) return { ok: false as const, reason: "not-in-cloud" as const };
        pointer = parsed.pointer;
      } catch { return { ok: false as const, reason: "not-in-cloud" as const }; }
      const indexBytes = await remote.get(keys.indexKey("lake", pointer.lake.commit));
      if (!indexBytes) return { ok: false as const, reason: "not-in-cloud" as const };
      let entry: { title: string; contentHash: string } | undefined;
      try { entry = indexMod.parseLakeIndexBytes(indexBytes).index.notes.find((note) => note.id === id); }
      catch { return { ok: false as const, reason: "not-in-cloud" as const }; }
      if (!entry) return { ok: false as const, reason: "not-in-cloud" as const };
      const bytes = await remote.get(keys.lakeBodyKey(id, entry.contentHash));
      if (!bytes) return { ok: false as const, reason: "object-missing" as const };
      if (sha256Hex(bytes) !== entry.contentHash) return { ok: false as const, reason: "hash-mismatch" as const };
      await applyRestoredNoteBody(d, id, kind, new TextDecoder().decode(bytes), { synced: true });
      // 正文已回来；资产缺失由按需补拉兜底（失败不撤销正文恢复，打开文档时还会再补）。
      try { await ensureAssetsNative([id]); } catch (error) { console.warn("[missing-body] 正文已恢复，资产补拉失败（打开文档时会再补）", error); }
      return { ok: true as const, title: entry.title || row.title };
    });
  },
};
