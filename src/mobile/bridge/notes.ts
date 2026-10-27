/** C3-5 第③步：notes 域（从 bridge.ts 抽取，行为保持）。 */
import { assets, dbPort, ensureDb, readSyncSettings, runMaintenance, runPriority, runWrite } from "./context";
import { reconcileIndex } from "../data/searchIndex.js";
import { backfillTextCache } from "../data/textCacheBackfill.js";

import { scanAssetCards, fileKindOf } from "../../core/fileCard.js";
import { lakeHtmlToPlain } from "../../core/lakeCaches.js";
import { searchTextForKind } from "../../core/noteSearchText.js";
import { countChars, countWords } from "../../core/textStats.js";
import { emptyLakeBody } from "../../core/lakeDocForm.js";
import { emptyMobileUsheetBody } from "../usheet/mobileSheetGrid.js";
import { emptyBoardBody } from "../../core/boardDoc.js";
import { emptyBitableBody } from "../../core/bitableDoc.js";
import { emptyInkBody } from "../../core/inkDoc.js";
import type { NoteKind } from "../../core/noteKind.js";
import type { SearchResult } from "../../core/searchTypes.js";

import * as noteRepository from "../data/noteRepository.js";
import { noteBodyPath } from "../data/noteBodies.js";
import type { LocalNote } from "../data/noteRepository.js";
import * as trashRepository from "../data/trashRepository.js";
import * as historyRepository from "../data/historyRepository.js";
import type { HistoryMobileSettings } from "../data/historyRepository.js";
import { downloadDeclaredAssetsFor, ensureAssetsNative } from "./sync";


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

  async searchNotes(query: string): Promise<SearchResult[]> {
    const d = await ensureDb();
    return await noteRepository.searchNotes(d, query);
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
        if (await noteRepository.isTombstoned(d, id)) throw new Error("笔记已被彻底删除，保存被拒绝");
        await noteRepository.createNote(d, id, title, content, parentId, assets, plain, kind);
        return;
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
    const row = await d.prepare("SELECT is_dirty, is_purged, is_conflict, updated_at FROM notes WHERE id=?").get(id) as
      { is_dirty: number; is_purged: number; is_conflict: number; updated_at: string } | undefined;
    // 与搜索索引共用同一条按 kind 分派的派生口径；表格/多维表/画板正文是 JSON，不能喂 Lake HTML 解析器。
    const plain = searchTextForKind(note.kind, note.content).plain ?? "";
    // 字数/字符数 = 与内核 wordCount 同语义的单一来源（261016，B1；此前这里另写了一套正则）。
    const charCount = countChars(plain);
    const wordCount = countWords(plain);
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
      isEditLocked: false,
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
    if (!snapshot) return;
    await historyRepository.backupCurrentNote(mobileDb, snapshot.noteId);
    await notesDomain.saveNote(snapshot.noteId, snapshot.title, snapshot.content);
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


  /** 新建表格（kind=usheet）：正文 = 空表快照（50×16）+ **移动端网格**（24/120/40/24，单一来源 mobileSheetGrid），
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

  /** 小记图片按需补拉（261027）：与文档同一条 v3 补拉逻辑，空间换成 quickNotes。 */
  async ensureQuickNoteAssets(ids: string[]): Promise<{ downloaded: number; failed: number }> {
    return runPriority("ensureQuickNoteAssets", () => downloadDeclaredAssetsFor(ids, true, "quickNotes"));
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

  async purgeTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return runWrite("purgeTreeItem", async () => {
      const d = await ensureDb();
      await trashRepository.purgeTreeItem(d, id, kind);
      await reconcileIndex(d);
    });
  },
};
