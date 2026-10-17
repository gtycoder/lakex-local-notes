/**
 * 移动端运行时桥：实现 window.lakeNative 契约（对齐桌面 preload 的 IPC 语义），
 * 数据层与同步编排都在这里接线；同步决策不在本文件，一律复用 src/core 的纯函数。
 *
 * - 数据层：Android 原生 SQLite（WAL，见 nativeSqliteDb.ts）
 * - S3：@aws-sdk/client-s3 + CapacitorHttpHandler（原生传输层，无 CORS）
 * - 同步：共享 src/core/syncEngine（**Lake Manifest V1**，260928 协议重置）
 * - 互斥域：写域 / 维护域分离，判据见 src/core/maintenancePolicy.ts（F16）
 * - 结构：docs/MOBILE-TECH-STACK.md；跨端能力矩阵见该文档
 */
import { saveAssetBytesFs, loadAssetBytesFs, removeAssetBytesFs } from "./native/assetFs";
import { scanAssetCards, fileKindOf } from "../core/fileCard.js";
import type { QuickNotePushOutcome } from "../core/quickNotePush.js";
import { lakeHtmlToPlain } from "../core/lakeCaches.js";
import { countChars, countWords } from "../core/textStats.js";
import { emptyLakeBody } from "../core/lakeDocForm.js";
import { buildAssetFilename, mimeTypeForFilename } from "../core/assetNaming.js";
import { localAssetHttpUrl } from "../core/assetUrl.js";
import type { TreeNode } from "../lib/types";
import { cloudStateHint, type CloudState } from "../core/cloudState.js";
import type { SearchResult } from "../core/searchTypes.js";
import type { StoredQuickNoteContent, StoredQuickNoteImage } from "../core/quickNoteModel.js";

import * as treeRepository from "./data/treeRepository.js";
import * as noteRepository from "./data/noteRepository.js";
import { indexNote, reconcileIndex } from "./data/searchIndex.js";
import type { LocalNote, LocalNoteSummary } from "./data/noteRepository.js";
import * as trashRepository from "./data/trashRepository.js";
import * as quickNotesRepository from "./data/quickNotesRepository.js";
import * as historyRepository from "./data/historyRepository.js";
import type { HistoryMobileSettings } from "./data/historyRepository.js";
import * as notebookTreeRepository from "./data/notebookTreeRepository.js";
import { assets, ensureDb, dbPort, runWrite, runMaintenance, runPriority } from "./bridge/context";
import { assetsDomain } from "./bridge/assets";
import { syncDomain, downloadDeclaredAssetsFor, mobileCloudState, pushSingleQuickNote, scheduleQuickNoteVerify } from "./bridge/sync";

export type { HistoryMobileSettings } from "./data/historyRepository.js";

export const bridge = {
  ...syncDomain,
  ...assetsDomain,
  async init(): Promise<void> {
    await ensureDb();
    // 资源显示走 AssetServer（Filesystem 文件直读，无需预加载/迁移）。
  },

  // ---- 目录树 CRUD（Phase 0B：对齐共享 TreeRepository 接口，§20 ports.ts） ----

  async listTreeNodes(): Promise<TreeNode[]> {
    const d = await ensureDb();
    return await treeRepository.listTreeNodes(d);
  },


  /** 笔记本详情（含文档套文档）——实现见模块级 listNotebookTreeImpl（bridge 对象与 lakeNative 契约共用）。 */

  /** 新建 notebook：根层创建，名称必填（trim 校验，共享 treeRules），默认图标不落库（icon 由 setNodeIcon 单独写入）。 */
  async createNotebook(input: { title: string; icon: string | null }): Promise<TreeNode> {
    return runWrite("createNotebook", async () => {
      const d = await ensureDb();
      const node = await treeRepository.createNotebook(d, input);
      return node;
    });
  },

  /** 新建 group：父节点必须存在（且非回收站），名称校验共享 treeRules。 */
  async createGroup(parentId: string, title: string): Promise<TreeNode> {
    return runWrite("createGroup", async () => {
      const d = await ensureDb();
      const node = await treeRepository.createGroup(d, parentId, title);
      return node;
    });
  },

  async renameTreeNode(id: string, title: string): Promise<TreeNode> {
    return runWrite("renameTreeNode", async () => {
      const d = await ensureDb();
      const node = await treeRepository.renameTreeNode(d, id, title);
      // 重命名即时更新搜索索引（folder 重命名时 indexNote 找不到 notes 行，自动 no-op）。
      await indexNote(d, id);
      return node;
    });
  },

  async setNodeIcon(id: string, icon: string | null): Promise<TreeNode> {
    return runWrite("setNodeIcon", async () => {
      const d = await ensureDb();
      const node = await treeRepository.setNodeIcon(d, id, icon);
      return node;
    });
  },

  async moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): Promise<TreeNode> {
    return runWrite("moveTreeNodeOrdered", async () => {
      const d = await ensureDb();
      const node = await treeRepository.moveTreeNodeOrdered(d, id, parentId, orderedIds);
      return node;
    });
  },

  /** 同级重排（自定义排序）：单事务更新 sort_order，不改父节点。对齐桌面 reorderTreeNodes。 */
  async reorderSiblings(parentId: string | null, orderedIds: string[]): Promise<void> {
    return runWrite("reorderSiblings", async () => {
      const d = await ensureDb();
      await treeRepository.reorderSiblings(d, parentId, orderedIds);
    });
  },

  async listNotes(): Promise<LocalNoteSummary[]> {
    const d = await ensureDb();
    return await noteRepository.listNotes(d);
  },

  async readNote(id: string): Promise<LocalNote | null> {
    const d = await ensureDb();
    return await noteRepository.readNote(d, id);
  },

  /** 打开文档前的"是否已消失"判定原料（AGENTS §3 #16：所有打开入口都要判，判定逻辑用共享纯函数 isGoneNote）。 */
  async noteGoneState(id: string): Promise<{ parentId: string | null; syncState: string } | null> {
    const d = await ensureDb();
    return await noteRepository.noteGoneState(d, id);
  },

  /** Phase 0B-5：搜索 fallback（LIKE；标题+正文，参数化 + ESCAPE，不依赖 FTS5）。 */
  async searchNotes(query: string): Promise<SearchResult[]> {
    const d = await ensureDb();
    return await noteRepository.searchNotes(d, query);
  },

  // ---- 小记（Phase B3：本地 CRUD + 列表；同步后置，依赖 quick-notes/ 子空间端口化） ----

  async listQuickNotes(): Promise<Array<{ id: string; createdAt: string; previewText: string; imageCount: number; updatedAt: string; firstImage: string | null }>> {
    const d = await ensureDb();
    return await quickNotesRepository.listQuickNotes(d);
  },

  async readQuickNote(id: string): Promise<{ id: string; content: StoredQuickNoteContent; previewText: string; updatedAt: string } | null> {
    const d = await ensureDb();
    return await quickNotesRepository.readQuickNote(d, id);
  },

  async saveQuickNote(id: string, text: string, images: StoredQuickNoteImage[] = []): Promise<string> {
    return runWrite("saveQuickNote", async () => {
      const d = await ensureDb();
      const result = await quickNotesRepository.saveQuickNote(d, id, text, images);
      return result;
    });
  },

  /** 带图片字节保存小记（composer 用）：图片字节落盘为文件（canonical URL 由本地 AssetServer 服务），
   * 与桌面端小记完全一致——纯文件存储，完全不用 BLOB。文件名用 buildAssetFilename 唯一化（同文件多次添加不覆盖）。
   * 全量替换本小记图片（编辑时传已有图片字节 + 新增字节；简单一致，不引入 staged/retained 两段式）。 */
  async saveQuickNoteWithImages(id: string, text: string, imageFiles: Array<{ filename: string; mimeType: string; width: number | null; height: number | null; bytes: Uint8Array }> = []): Promise<string> {
    return runWrite("saveQuickNoteWithImages", async () => {
      const d = await ensureDb();
      const result = await quickNotesRepository.saveQuickNoteWithImages(d, id, text, imageFiles, {
        assets,
        saveAssetFile: saveAssetBytesFs,
      });
      return result;
    });
  },

  /** 闪念速记未提交草稿（纯本地 device_state，不进 S3）：进程被杀后能恢复。 */
  async getQuickNoteDraft(): Promise<{ id: string; text: string; body?: string; images: StoredQuickNoteImage[]; updatedAt: string } | null> {
    const d = await ensureDb();
    return await quickNotesRepository.readQuickNoteDraft(d);
  },

  /** 写草稿（写作者已在输入侧做防抖，这里只落库；图片一加入就已落盘，这里只记引用）。 */
  async saveQuickNoteDraft(draft: { id: string; text: string; body?: string; images?: StoredQuickNoteImage[] }): Promise<void> {
    return runWrite("saveQuickNoteDraft", async () => {
      const d = await ensureDb();
      await quickNotesRepository.writeQuickNoteDraft(d, { id: draft.id, text: draft.text, body: draft.body, images: draft.images ?? [], updatedAt: new Date().toISOString() });
    });
  },

  /** 清除草稿（保存成功 / 用户主动取消后）。 */
  async clearQuickNoteDraft(): Promise<void> {
    return runWrite("clearQuickNoteDraft", async () => {
      const d = await ensureDb();
      await quickNotesRepository.clearQuickNoteDraft(d);
    });
  },

  /**
   * 小记资源落盘（内核编辑器插入图片/附件时调用）：直接写**正式目录** `quick-notes/{id}/{资产名}`，
   * 返回 canonical URL（局域网外的可达性由本机 AssetServer 负责）。
   *
   * 与桌面的差异：桌面走「staging → 保存时 promote」（有草稿日志/崩溃恢复那套基建），移动端没有这套基建，
   * 编辑目标 id 一开始就已知 ⇒ 直接写正式目录；用户中途取消留下的文件由既有孤儿/GC 清理回收（与文档资源同口径）。
   */
  async stageQuickNoteAsset(id: string, input: { filename: string; bytes: Uint8Array }): Promise<{ filename: string; mimeType: string; size: number; url: string }> {
    if (!input || !(input.bytes instanceof Uint8Array) || input.bytes.length === 0) throw new Error("资源数据无效");
    const stored = buildAssetFilename(input.filename);
    const key = `quick-notes/${id}/${stored}`;
    assets.set(key, input.bytes);
    await saveAssetBytesFs(key, input.bytes);
    return {
      filename: stored,
      mimeType: mimeTypeForFilename(stored),
      size: input.bytes.length,
      url: localAssetHttpUrl(id, stored, { space: "quick-notes" }),
    };
  },

  /** 保存内核编辑器产出的小记正文（body + text 镜像 + 资源清单）。 */
  async saveQuickNoteContent(id: string, payload: { text: string; body: string; images: StoredQuickNoteImage[] }): Promise<string> {
    return runWrite("saveQuickNoteContent", async () => {
      const d = await ensureDb();
      return await quickNotesRepository.saveQuickNoteContent(d, id, payload);
    });
  },

  /**
   * 「保存并同步」（261013）：只把**这一条**小记（正文 + 它的图片）推到 S3，其余小记在云端原样保留
   * （core/quickNotePush 的合并语义）。
   *
   * 入**高优先域**（不是维护域）：长按小记 → 写完 → 同步 → 桌面端及时看到 是高频场景，
   * **绝不能**排在在途的整轮同步后面（弱网整轮可到分钟级）。推送成功后往维护域队尾排一次
   * **幂等回核**，兜住唯一交叉风险（整轮同步拿旧快照覆盖我们刚写的清单条目）。
   * 出网判据与 syncNow 同一来源（AGENTS §3#20）：关闭云同步 ⇒ 直接抛、零请求。
   */
  async syncQuickNote(id: string): Promise<QuickNotePushOutcome> {
    if ((await mobileCloudState()) === "offline") throw new Error(cloudStateHint("offline") ?? "云同步已关闭");
    const outcome = await runPriority("syncQuickNote", () => pushSingleQuickNote(id));
    if (outcome.status === "pushed") scheduleQuickNoteVerify(id);
    return outcome;
  },

  /**
   * 当前云同步状态（判据单一来源 `mobileCloudState` → core/cloudState）。
   * UI 用它决定「保存并同步」是否可用（用户 261013：关闭云同步时置灰）。
   */
  async getCloudState(): Promise<CloudState> {
    return mobileCloudState();
  },

  async createQuickNote(text: string): Promise<string> {
    return runWrite("createQuickNote", async () => {
      const d = await ensureDb();
      const id = crypto.randomUUID();
      const result = await quickNotesRepository.saveQuickNote(d, id, text, []);
      return result;
    });
  },

  /** 本地删除小记：软删（保留 content 供墓碑携带），同步时上传墓碑跨端传播删除。 */
  async deleteQuickNote(id: string): Promise<void> {
    return runWrite("deleteQuickNote", async () => {
      const d = await ensureDb();
      await quickNotesRepository.deleteQuickNote(d, id);
    });
  },

  /** 小记图片字节读取（composer/卡片显示用；缺失 → null）。纯文件为准（无 BLOB）。 */
  async getQuickNoteImage(id: string, filename: string): Promise<Uint8Array | null> {
    return loadAssetBytesFs("quick-notes/" + id + "/" + filename);
  },

  /** 小记回收站列表（软删行；含冲突归档的 ready_to_sync=0 条目——它们也是可恢复的本地内容）。 */
  async listQuickNoteTrash(): Promise<Array<{ id: string; createdAt: string; updatedAt: string; deletedAt: string; previewText: string }>> {
    const d = await ensureDb();
    return await quickNotesRepository.listQuickNoteTrash(d);
  },

  /** 小记恢复（回收站 → active）：restore_pending_at → 同步 local-wins 上传 active 覆盖墓碑。 */
  async restoreQuickNote(id: string): Promise<void> {
    return runWrite("restoreQuickNote", async () => {
      const d = await ensureDb();
      await quickNotesRepository.restoreQuickNote(d, id);
    });
  },

  /** 小记彻底删除（回收站 → 不可恢复）：删行 + 删图片；保留墓碑记录（同步继续传播删除，正文已删 → 占位符 hash）。 */
  async purgeQuickNote(id: string): Promise<void> {
    return runWrite("purgeQuickNote", async () => {
      const d = await ensureDb();
      await quickNotesRepository.purgeQuickNote(d, id, removeAssetBytesFs);
    });
  },

  /** 保存文档（编辑器自动保存 / createNote 的落库入口）。审计 F06：create 与 save 分离——
   * gone（回收站 / sync_state='purged'）明确拒绝；missing 仅当无永久墓碑时初始化新文档；
   * 绝不 upsert 覆盖回收站/已 purge 的行，也不复活已写墓碑的条目。 */
  async saveNote(id: string, title: string, content: string, parentId: string | null = null, plain?: string): Promise<void> {
    return runWrite("saveNote", async () => {
      const d = await ensureDb();
      const state = await noteRepository.noteWriteState(d, id);
      if (state === "gone") throw new Error("笔记已在回收站或已被删除，保存被拒绝；请先显式恢复");
      if (state === "missing") {
        if (await noteRepository.isTombstoned(d, id)) throw new Error("笔记已被彻底删除，保存被拒绝");
        await noteRepository.createNote(d, id, title, content, parentId, assets, plain);
        return;
      }
      await noteRepository.saveNote(d, id, title, content, parentId, assets, plain);
    });
  },

  /** 列出某文档的历史快照（纯本地；冲突留档/手动快照）。 */
  async listNoteHistory(noteId: string): Promise<Array<{ id: number; title: string; createdAt: string }>> {
    const d = await ensureDb();
    return await historyRepository.listNoteHistory(d, noteId);
  },

  /** 文档属性（移动端：正文在本地 DB，资源在 app Data 目录）。 */
  async getNoteInfo(id: string) {
    const d = await ensureDb();
    const note = await noteRepository.readNote(d, id);
    if (!note) throw new Error("笔记不存在");
    const row = await d.prepare("SELECT sync_state, is_conflict, updated_at FROM notes WHERE id=?").get(id) as
      { sync_state: string; is_conflict: number; updated_at: string } | undefined;
    const plain = lakeHtmlToPlain(note.content);
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
      syncState: row?.sync_state ?? "local",
      isConflict: Boolean(row?.is_conflict),
      isLocked: false,
      lakePath: "(移动端：正文存于本地数据库)",
      assetsDir: `note-assets/${id}`,
      sizeBytes: new TextEncoder().encode(note.content).length,
      charCount,
      wordCount,
      assets,
      assetTotalBytes: assets.reduce((sum, a) => sum + a.size, 0),
      history,
    };
  },

  /** 本地资源预览（仅图片返回 dataUrl）。 */
  /** 历史快照预览（返回 HTML，供属性面板内联渲染）。 */
  async previewHistorySnapshot(historyId: number) {
    const d = await ensureDb();
    const h = await historyRepository.readHistory(d, historyId);
    if (!h) return null;
    return { plain: lakeHtmlToPlain(h.content), html: h.content, createdAt: "", contentHash: "" };
  },

  /** 恢复历史快照：对齐桌面端——先给当前正文留档（可反悔），再把快照正文+标题写回（sync_state=local → 下轮同步上传覆盖远端）。 */
  async restoreHistory(historyId: number): Promise<void> {
    const d = await ensureDb();
    const mobileDb = d;
    const snapshot = await historyRepository.readHistory(mobileDb, historyId);
    if (!snapshot) return;
    await historyRepository.backupCurrentNote(mobileDb, snapshot.noteId);
    await bridge.saveNote(snapshot.noteId, snapshot.title, snapshot.content);
  },

  /** 手动删除单个历史快照（对齐桌面 deleteHistory）。 */
  async deleteHistory(historyId: number): Promise<void> {
    await runWrite("deleteHistory", async () => {
      const d = await ensureDb();
      await historyRepository.deleteHistory(d, historyId);
    });
  },

  /** 读取历史快照设置（对齐桌面 getHistorySettings；存 device_state，纯本地）。 */
  async getHistorySettings(): Promise<HistoryMobileSettings> {
    const d = await ensureDb();
    return await historyRepository.getHistorySettings(d);
  },

  /** 保存历史快照设置（对齐桌面 saveHistorySettings）。 */
  async saveHistorySettings(settings: HistoryMobileSettings): Promise<void> {
    await runWrite("saveHistorySettings", async () => {
      const d = await ensureDb();
      await historyRepository.saveHistorySettings(d, settings);
    });
  },

  /** 给某笔记创建快照（定时自动快照用；读当前正文，24h 去重）。 */
  async snapshotNote(noteId: string): Promise<void> {
    await runWrite("snapshotNote", async () => {
      const d = await ensureDb();
      await historyRepository.snapshotNote(d, noteId);
    });
  },

  /** 历史快照清理（对齐桌面 cleanupHistory：分层保留 + 上限 + 保留天数，设置可配置）。 */
  async cleanupHistory(): Promise<{ deleted: number }> {
    return runWrite("cleanupHistory", async () => {
      const d = await ensureDb();
      const mobileDb = d;
      return await historyRepository.cleanupHistory(mobileDb, await historyRepository.getHistorySettings(mobileDb));
    });
  },

  /** GC：登记待回收键（新 manifest 不再引用，对齐桌面 addS3GcPending）。 */

  /** GC：从待回收表移除已被重新引用的键。 */

  /** GC：列出全部待回收键。 */

  /** GC：记录删除（对齐桌面 recordS3GcLog）。 */

  async createNote(title: string, parentId: string | null = null): Promise<LocalNote> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // 无父新建 → 兜底父笔记本（存在的笔记本；无则自动创建"未分类"）
    const pid = parentId ?? await dbPort.defaultNotebookId();
    const content = emptyLakeBody(id);
    await bridge.saveNote(id, title, content, pid);
    return { id, title, content, updatedAt: now, parentId: pid, kind: "doc" };
  },

  /** 本地软删（入回收站）：同步时上传墓碑（删除压编辑） */
  async trashNote(id: string): Promise<void> {
    return runWrite("trashNote", async () => {
      const d = await ensureDb();
      await noteRepository.trashNote(d, id);
    });
  },

  /** 回收站预览：按需补拉该笔记本地缺失的资源（不恢复、不移出回收站）。best-effort。 */
  async ensureTrashNoteAssets(id: string): Promise<void> {
    return runMaintenance("ensureTrashNoteAssets", async () => {
      await downloadDeclaredAssetsFor([id], true);
    });
  },

  /** 本地恢复单条笔记：restore_pending_at → 同步时 local-wins 上传 active 覆盖墓碑。
   * 与 restoreTreeItem(id, "note") 完全等价（同一实现）；回收站 UI 统一走 restoreTreeItem，
   * 本方法仅供 lakeNative 调试契约使用，避免两套恢复入口语义分叉。 */
  async restoreNote(id: string): Promise<void> {
    return bridge.restoreTreeItem(id, "note");
  },

  /** 回收站列表 */
  async listTrashed(): Promise<LocalNote[]> {
    const d = await ensureDb();
    return await noteRepository.listTrashed(d);
  },

  /** 软删除（入回收站）：folder = 整棵子树（含深层 folders + 子树 notes）标 trashed_at；note = 单条。
   * 与桌面 deleteTreeNode 同语义（删除 = 移入回收站，回收站条目是普通条目，移动即同步传播）：
   * 移动端无 notebook-trash 容器行，用 trashed_at 标记 + listFoldersForSync 输出 trashedAt 传播；
   * parent_id 不变（恢复即原地清 trashed_at，对齐 restoreTreeItem）。
   * 仅提供 API（lakeNative 契约/未来 UI 用），当前移动端 UI 未接入删除笔记本入口。 */
  async trashTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return runWrite("trashTreeItem", async () => {
      const d = await ensureDb();
      await trashRepository.trashTreeItem(d, id, kind);
      await reconcileIndex(d);
    });
  },

  /** B2：统一回收站树（folders 笔记本/分组 + notes 文档）。复用桌面 TrashPanel 语义：仅根节点可恢复（整棵连带），任意节点可彻底删除。 */
  async listTrashTree(): Promise<Array<{ id: string; title: string; kind: "folder" | "note"; parentId: string | null; deletedAt: string | null }>> {
    const d = await ensureDb();
    return await trashRepository.listTrashTree(d);
  },

  /** B2：恢复回收站项。folder = 恢复整棵（含深层子树）；note = 文档级恢复。恢复标记 restore_pending_at → 同步 local-wins 上传 active 覆盖墓碑。 */
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

  /** B2：彻底删除回收站项（purge）。folder = 子树全部 purge；note = 单条 purge（同步发墓碑）。
   * 对齐桌面 purgeTrashItem：物理删除行 + 写 deleted_notes 墓碑（purged_at + node_type）。
   * 墓碑经 syncEngine 发布 deleted:true 传播到其他端（否则仅从 manifest 移除 → 其他端保留 active 副本，删除不传播）；
   * folder 墓碑（purged_at）供 isFolderPurged 下载过滤（防远端文件夹重新导入复活）。
   * 与收到他端 purge（applyRemotePurge：行保留标 purged、可恢复）语义不同：本地主动 purge 不可恢复。 */
  async purgeTreeItem(id: string, kind: "folder" | "note"): Promise<void> {
    return runWrite("purgeTreeItem", async () => {
      const d = await ensureDb();
      await trashRepository.purgeTreeItem(d, id, kind);
      await reconcileIndex(d);
    });
  },

  // ---- 云同步开关（与桌面同语义：关闭 = 离线本地空间） ----



  // ---- S3（连接检查 / 单发上传 / 深度清理） ----



  /** 七牛验证必须用 ListObjectsV2（HeadBucket 对存在的桶也返回 404，AGENTS.md 踩坑 #4） */


  /** 云端 GC（对齐桌面 runDeepCleanup）：删「未被 latest/prev 链清单/历史快照引用 ∧ 双锚窗口（创建 + 待回收标记）已过」的 objects/assets。 */

  /** 运行诊断（移动端"日志查看/关于"等价）：存储统计。 */

  /** 整轮同步：Lake Manifest V1（拉取对账 + 上传发布）+ 小记 quick-notes/ 子空间同步，复用 src/core 引擎。
   * P2-5/6（GPT 审计）：结构化返回（notes/quickNotes 分字段）；主维护队列串行化防与本地写操作交错。 */
  // ---- 目录树只读契约（同步调试/测试用） ----
  async listNotebookTree(notebookId: string): Promise<notebookTreeRepository.NotebookTreeItem[]> {
    const d = await ensureDb();
    return await notebookTreeRepository.listNotebookTree(d, notebookId);
  },
  // ---- 墓碑只读契约（同步调试/测试用；生产同步路径直接走 dbPort，不经此对象） ----
};
