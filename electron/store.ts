import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ASSET_PORT } from "./assetServer.js";
import { DocumentTagsService } from "./documentTags.js";
import { createSilentLoggerScopes, type LoggerScopes } from "../src/core/logger.js";
import { AppError } from "../src/core/storeErrors.js";
import { perfMessage } from "../src/core/logFormat.js";
import { extractAssetRefs, isSafePathSegment } from "../src/core/storeUtils.js";
import { readNoteDigest, type NoteDigest } from "./storeQueries.js";
import { emptyLakeBody } from "../src/core/lakeDocForm.js";
import { type NoteKind, normalizeNoteKind } from "../src/core/noteKind.js";
import { noteBodyCandidatePaths, noteBodyRelativePath } from "../src/core/noteBodyPaths.js";
import type { AiSettings } from "../src/core/aiProviders.js";
import { emptyUsheetBody } from "../src/core/usheetDoc.js";
import { emptyBitableBody } from "../src/core/bitableDoc.js";
import { emptyBoardBody } from "../src/core/boardDoc.js";
import { emptyInkBody } from "../src/core/inkDoc.js";
import { searchTextForKind } from "../src/core/noteSearchText.js";
import { countChars, countWords } from "../src/core/textStats.js";
import { missingBodyRecovery, type MissingBodyDoc } from "../src/core/missingBody.js";
import { canTouchNetwork, cloudStateOf } from "../src/core/cloudState.js";
import { SearchRepository } from "./searchRepository.js";
import type { SearchResult } from "../src/core/searchTypes.js";
import { HistoryRepository, type HistorySnapshotPreview, type HistorySnapshotSummary } from "./historyRepository.js";
import { TrashRepository } from "./trashRepository.js";
import { TrashLifecycle } from "./trashLifecycle.js";
import { HistoryLifecycle } from "./historyLifecycle.js";
import { OrphanLifecycle } from "./orphanLifecycle.js";
import { Diagnostics } from "./diagnostics.js";
import { SyncReconciliation } from "./syncReconciliation.js";
import { SettingsRepository } from "./settingsRepository.js";
import { NoteExport } from "./noteExport.js";
import { SchemaInit } from "./schemaInit.js";
import type { TrashItem, TrashReminderItem } from "./trashRepository.js";
export type { TrashItem, TrashReminderItem };
import { AssetRepository, type OrphanAsset } from "./assetRepository.js";
import { NoteQueries } from "./noteQueries.js";
import type { NoteSummary, SummaryRow, SyncFolder, SyncNote, TreeNode } from "./noteQueries.js";
import { NoteMetadataRepository } from "./noteMetadataRepository.js";
import { NoteContentRepository, type NoteCacheInput } from "./noteContentRepository.js";
import { createPlaintextSecretCipher, type SecretCipher } from "../src/core/secretCipher.js";
import type { DbLike } from "./dbLike.js";
import { ResourceRepository } from "./resourceRepository.js";
import { draftJournalDir, readDraftEntry } from "./draftJournal.js";
import { RemoteImportRepository } from "./remoteImportRepository.js";
import type { ResourceUploadOutput, HistorySettings, HistoryCleanupResult, S3Settings, SyncSettings, S3GcSettings } from "./storeTypes.js";
import { fileKindOf, renameFileCardDisplay, scanAssetCards } from "../src/core/fileCard.js";

export { ASSET_NAME_RE, extractAssetRefs, isoWeekKey, selectHistoryDrops, sanitizeFileName } from "../src/core/storeUtils.js";

const DEFAULT_WORKSPACE_ID = "default";
const DEFAULT_NOTEBOOK_ID = "notebook-personal";
/** 隐藏回收站笔记本（固定 ID，每端本地初始化、不同步 folder；软删 = 移入此处）。 */
export const TRASH_NOTEBOOK_ID = "notebook-trash";

export { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../src/core/storeLimits.js";

export { AppError } from "../src/core/storeErrors.js";

interface NoteDocument extends NoteSummary {
  content: string;
  /** 正文文件缺失（被手动删除等）：content 为空串；渲染层据此只读打开，同步不会上传空正文。 */
  bodyMissing?: boolean;
}

/** 设置/账本类型单一来源：storeTypes.ts（S3/Sync/S3GC/History） */
export type { S3Settings, SyncSettings, S3GcSettings, HistorySettings, HistoryCleanupResult } from "./storeTypes.js";

/** 仅供主进程内部的小记转换调用。sourcePath 绝不来自渲染进程。 */
export interface ImportedNoteAsset {
  filename: string;
  sourcePath: string;
}

/** 文档属性（设置里的"属性"弹窗数据）。 */
export interface NoteInfo {
  id: string;
  title: string;
  /** 所属路径（笔记本 / 分组 …），根下为空 */
  parentPath: string;
  /** 所属路径链（自根向下，带 id，供跳转） */
  parents: Array<{ id: string; title: string }>;
  /** 卡片统计（图片/视频/附件/代码块/表格…） */
  cardStats: Array<{ key: string; label: string; count: number }>;
  createdAt: string | null;
  updatedAt: string;
  isDirty?: boolean;
  isPurged?: boolean;
  isConflict: boolean;
  isEditLocked: boolean;
  lakePath: string;
  assetsDir: string;
  sizeBytes: number;
  charCount: number;
  wordCount: number;
  /** 当前正文（已落盘那份）的 sha256：历史面板用来标出"与当前版本一致"的快照。 */
  contentHash: string;
  /** 正文引用到的本地资产（去重） */
  assets: NoteInfoAsset[];
  assetTotalBytes: number;
  history: Array<{ id: number; createdAt: string; size: number; contentHash: string }>;
}

export interface NoteInfoAsset {
  filename: string;
  size: number;
  kind: string;
}

/** v3 同步用的轻量元数据（不读正文、不算资产卡片），O(notes) 单查询。 */
export interface NoteSyncMeta {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  contentHash: string;
  isConflict: boolean;
  isEditLocked: boolean;
  editLockedAt: string | null;
  icon: string | null;
  trashedAt: string | null;
  deletedFromParentId: string | null;
  kind: string;
}

/** 卡片名 → 统计展示名。 */
const CARD_LABELS: Record<string, string> = {
  image: "图片", video: "视频", audio: "音频", file: "附件",
  codeblock: "代码块", table: "表格", board: "画板", mindmap: "思维导图",
  bookmark: "书签", database: "数据库", hr: "分隔线", math: "公式",
};

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  return crypto.randomUUID();
}

/** W-3：资产 URL 正则工厂（端口跟随 ASSET_PORT）——实现已搬到 noteExport.ts，此处 re-export 保兼容 */
export { localAssetLakeSrcRe, localAssetHtmlImgRe, localAssetMdImgRe } from "./noteExport.js";

export class Store {
  private db: DbLike;
  private root: string;
  private noteAssetsDir: string;
  /** 15 分钟自动快照的 dirty 集合（saveNote 落盘时标记，flush 后清空，内存态） */
  private historyDirty = new Set<string>();
  private searchRepository: SearchRepository;
  private historyRepository: HistoryRepository;
  private trashRepository: TrashRepository;
  private trashLifecycle: TrashLifecycle;
  private historyLifecycle: HistoryLifecycle;
  private orphanLifecycle: OrphanLifecycle;
  private diagnostics: Diagnostics;
  private syncReconciliation: SyncReconciliation;
  private settingsRepository: SettingsRepository;
  private noteExport: NoteExport;
  private schemaInit: SchemaInit;
  private assetRepository: AssetRepository;
  private noteQueries: NoteQueries;
  private noteMetadata: NoteMetadataRepository;
  private noteContent: NoteContentRepository;
  private resourceRepository: ResourceRepository;
  private remoteImport: RemoteImportRepository;
  /** V5 Phase 2：日志注入点（桌面默认 = electron-log，由 main.ts 装配；sync/quickNotes 经此读取） */
  readonly logScopes: LoggerScopes;
  /** 文档标签（目录 + tag_links(target_kind='note')）。 */
  readonly documentTags: DocumentTagsService;

  /** 数据根目录（v3 适配器/诊断用；只读）。 */
  get rootPath(): string { return this.root; }

  constructor(root: string, secretCipher: SecretCipher = createPlaintextSecretCipher(), logScopes: LoggerScopes = createSilentLoggerScopes()) {
    this.root = root;
    this.logScopes = logScopes;
    this.noteAssetsDir = path.join(root, "note-assets");
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    // 表格（usheet）/ 多维表（bitable）/ 画板（board）正文独立目录：notes/ 仍是 doc 的容器（docs/STORAGE-LAYERS.md §4.1）
    fs.mkdirSync(path.join(root, "usheets"), { recursive: true });
    fs.mkdirSync(path.join(root, "bitables"), { recursive: true });
    fs.mkdirSync(path.join(root, "boards"), { recursive: true });
    fs.mkdirSync(path.join(root, "inks"), { recursive: true });
    fs.mkdirSync(this.noteAssetsDir, { recursive: true });
    this.db = new Database(path.join(root, "metadata.sqlite3"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.schemaInit = new SchemaInit({
      db: this.db,
      workspaceId: DEFAULT_WORKSPACE_ID,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      defaultNotebookId: DEFAULT_NOTEBOOK_ID,
      nextSortOrder: (parentId) => this.nextSortOrder(parentId),
      atomicWrite: (filePath, content) => this.atomicWrite(filePath, content),
      notePathFor: (noteId) => this.notePath(noteId),
    });
    this.schemaInit.migrate();
    this.documentTags = new DocumentTagsService(this.db);
    this.settingsRepository = new SettingsRepository(this.db, secretCipher);
    this.historyRepository = new HistoryRepository(this.db, this.root);
    this.trashRepository = new TrashRepository(this.db, TRASH_NOTEBOOK_ID);
    this.noteQueries = new NoteQueries(this.db, DEFAULT_WORKSPACE_ID, TRASH_NOTEBOOK_ID);
    this.noteMetadata = new NoteMetadataRepository({
      db: this.db,
      workspaceId: DEFAULT_WORKSPACE_ID,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      uuid,
      nowIso,
      nextSortOrder: (parentId) => this.nextSortOrder(parentId),
      ensureParent: (parentId) => this.ensureParent(parentId),
      assertParentCompatible: (parentId, childType) => this.assertParentCompatible(parentId, childType),
      descendantIds: (id) => this.descendantIds(id),
      readTreeNode: (id) => this.readTreeNode(id),
      upsertSearch: (noteId, title, body) => this.searchRepository.upsert(noteId, title, body),
    });
    this.noteContent = new NoteContentRepository({
      db: this.db,
      notePathFor: (noteId) => this.notePath(noteId),
      atomicWrite: (filePath, content) => this.atomicWrite(filePath, content),
      upsertSearch: (noteId, title, body) => this.searchRepository.upsert(noteId, title, body),
      detectOrphans: (noteId, content) => this.orphanLifecycle.detectOrphans(noteId, content),
      markHistoryDirty: (noteId) => this.markHistoryDirty(noteId),
    });
    this.resourceRepository = new ResourceRepository({
      noteAssetsDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      assetUrl: (noteId, filename) => this.assetUrl(noteId, filename),
      registerOrphan: (noteId, filename, size, mimeType) => this.orphanLifecycle.registerOrphan(noteId, filename, size, mimeType),
    });
    this.remoteImport = new RemoteImportRepository({
      db: this.db,
      workspaceId: DEFAULT_WORKSPACE_ID,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      notePathFor: (noteId) => this.notePath(noteId),
      bodyPathFor: (noteId, kind) => this.bodyPathFor(noteId, kind),
      assetDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      isSafeSegment: isSafePathSegment,
      detectOrphans: (noteId, content) => this.orphanLifecycle.detectOrphans(noteId, content),
      ensureNoteCaches: (noteId, content) => this.ensureNoteCaches(noteId, content),
      logImport: (noteId, bytes, assetCount, startedAt) => this.logScopes.store.info(`[perf] importRemoteNote ${noteId} ${Date.now() - startedAt}ms (lake=${bytes}B, assets=${assetCount})`),
    });
    this.assetRepository = new AssetRepository({
      db: this.db,
      notePathFor: (noteId) => this.notePath(noteId),
      extractAssetRefs,
      // 未保存草稿引用的资源纳入保护集（审计 260918 D3）：草稿文件由渲染层经 save_draft_journal 写入，
      // 保存成功即删除 ⇒ 保护是瞬时的，不会让真孤儿永久留下。只读，不建目录。
      draftRefsFor: (noteId) => {
        const draft = readDraftEntry(draftJournalDir(this.root), noteId);
        return draft ? extractAssetRefs(draft.content) : new Set<string>();
      },
    });
    this.orphanLifecycle = new OrphanLifecycle({
      db: this.db,
      root: this.root,
      noteAssetsDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      assetRepository: this.assetRepository,
    });
    this.diagnostics = new Diagnostics({
      db: this.db,
      root: this.root,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      noteAssetsDir: this.noteAssetsDir,
      notePathFor: (noteId) => this.notePath(noteId),
      noteAssetsDirFor: (noteId) => this.noteAssetsDirFor(noteId),
      logScopes: this.logScopes,
    });
    this.searchRepository = new SearchRepository({
      db: this.db,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      derivePlainText: (noteId) => this.derivePlainText(noteId),
      readNoteCaches: (noteId) => this.readNoteCaches(noteId),
    });
    this.syncReconciliation = new SyncReconciliation({
      db: this.db,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      notePathFor: (noteId) => this.notePath(noteId),
      readNoteCaches: (noteId) => this.readNoteCaches(noteId),
      upsertSearch: (noteId, title, body) => this.searchRepository.upsert(noteId, title, body),
      removeSearch: (noteIds) => this.searchRepository.remove(noteIds),
      listNotesForSync: () => this.noteQueries.listNotesForSync(),
    });
    this.noteExport = new NoteExport({
      db: this.db,
      notePathFor: (noteId) => this.notePath(noteId),
      noteAssetsDir: this.noteAssetsDir,
      readNoteCaches: (noteId) => this.readNoteCaches(noteId),
    });
    this.historyLifecycle = new HistoryLifecycle({
      db: this.db,
      root: this.root,
      logScopes: this.logScopes,
      notePathFor: (noteId) => this.notePath(noteId),
      atomicWrite: (filePath, content) => this.atomicWrite(filePath, content),
      updateNoteCaches: (noteId, markdown, plain) => this.updateNoteCaches(noteId, markdown, plain),
      deriveSearchText: (noteId, content) => this.searchTextFor(noteId, content),
      getHistorySettings: () => this.getHistorySettings(),
      cleanupUnreferencedAssetsForNote: (noteId) => this.orphanLifecycle.cleanupUnreferencedAssetsForNote(noteId),
    });
    this.trashLifecycle = new TrashLifecycle({
      db: this.db,
      trashNotebookId: TRASH_NOTEBOOK_ID,
      notePathFor: (noteId) => this.notePath(noteId),
      noteAssetsDir: this.noteAssetsDir,
      historyNoteDirFor: (noteId) => this.historyLifecycle.historyNoteDir(noteId),
      logScopes: this.logScopes,
      readTreeNode: (id) => this.readTreeNode(id),
      readNoteCaches: (noteId) => this.readNoteCaches(noteId),
      upsertSearch: (noteId, title, body) => this.searchRepository.upsert(noteId, title, body),
      removeSearch: (noteIds) => this.searchRepository.remove(noteIds),
      resolveParentNotebook: () => this.resolveParentNotebook(),
    });
    this.schemaInit.seed();
    // M2 v2：增量账本；仅在账本缺失/与活跃文档数不符时全量重建，正常启动零重建。
    const ftsStart = Date.now();
    try {
      if (this.searchRepository.ensureIndex()) {
        console.info(`[perf] FTS rebuild ${Date.now() - ftsStart}ms`);
      }
    } catch (error) {
      console.warn("[store] 全文索引重建失败（不影响使用）:", error);
    }
  }

  /** 文档类型缓存（kind 创建后不可变，可长期缓存；避免每次拼路径都查库）。 */
  private readonly noteKindCache = new Map<string, NoteKind>();

  /** 读取笔记类型；行不存在（已 purge/未登记）时返回 null。 */
  private kindOf(id: string): NoteKind | null {
    const cached = this.noteKindCache.get(id);
    if (cached) return cached;
    const row = this.db.prepare("SELECT kind FROM notes WHERE id=?").get(id) as { kind?: string | null } | undefined;
    if (!row) return null;
    const kind = normalizeNoteKind(row.kind);
    this.noteKindCache.set(id, kind);
    return kind;
  }

  /** 按类型构造正文路径（唯一出口：37 处 notePathFor 调用点全部经此）。 */
  private bodyPathFor(id: string, kind: NoteKind): string {
    // 审计 #3/#17：校验下沉到路径构造本身——manifest（sync 导入）与 IPC（save/read）
    // 的 id 都可能来自外部，必须保证是安全单路径段，否则 ../ 可逃逸工作区
    if (!isSafePathSegment(id)) {
      throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    }
    // 路径规则是两端共享的单一来源（src/core/noteBodyPaths.ts）：移动端落 App 私有 Data 目录下的同名相对路径。
    return path.join(this.root, noteBodyRelativePath(kind, id));
  }

  /**
   * 正文路径（kind 感知）：kind 存在 notes.kind；行已删（purge 后残留墓碑）时回退 doc 路径——
   * purge 本来就把正文删了，返回 doc 路径与旧行为一致。
   */
  private notePath(id: string): string {
    if (!isSafePathSegment(id)) {
      throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    }
    return this.bodyPathFor(id, this.kindOf(id) ?? "doc");
  }

  /** 该类型是否有独立正文目录（用于「未登记残留」清理时逐个候选路径尝试）。 */
  private candidateBodyPaths(id: string): string[] {
    return noteBodyCandidatePaths(id).map((relative) => path.join(this.root, relative));
  }

  /** 正文 → 搜索/缓存文本（按类型分派：doc 走 Lake HTML 解析，usheet 走单元格抽取，bitable 走「表名 + 字段展示值」，board 走形状文字）。 */
  private searchTextFor(id: string, content: string): { markdown: string | null; plain: string | null } {
    const kind = this.kindOf(id);
    // 口径与移动端共用同一来源（src/core/noteSearchText.ts）
    return searchTextForKind(kind ?? "doc", content);
  }

  private atomicWrite(filePath: string, data: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, filePath);
  }

  private nextSortOrder(parentId: string | null): number {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM tree_nodes WHERE workspace_id=? AND parent_id IS ? AND deleted_at IS NULL"
    ).get(DEFAULT_WORKSPACE_ID, parentId) as { n: number };
    return row.n;
  }

  private ensureParent(parentId: string | null) {
    if (!parentId) return;
    const row = this.db.prepare("SELECT id FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(parentId);
    if (!row) throw new AppError("NotFound", `父节点不存在: ${parentId}`);
  }

  /** 树结构不变量：notebook 只能位于根层；note/group 必须位于某个节点下。
   * 支持多层嵌套：文档可包含分组/文档，分组可包含文档/分组（note/group 的父节点不限类型）。 */
  private assertParentCompatible(parentId: string | null, childType: string): void {
    if (parentId === TRASH_NOTEBOOK_ID) {
      throw new AppError("InvalidInput", "回收站是隐藏笔记本，不能直接作为父目录（删除请走删除操作）");
    }
    if (childType === "notebook") {
      if (parentId !== null) throw new AppError("InvalidInput", "笔记本只能位于根层");
      return;
    }
    if (parentId === null) throw new AppError("InvalidInput", "note/group 必须位于目录节点下");
    const parent = this.db.prepare("SELECT node_type FROM tree_nodes WHERE id=? AND deleted_at IS NULL").get(parentId) as { node_type: string } | undefined;
    if (!parent) throw new AppError("NotFound", `父节点不存在: ${parentId}`);
  }

  bootstrap() {
    const notes = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,is_dirty,is_conflict,is_locked,locked_at,kind FROM notes WHERE deleted_at IS NULL AND parent_id != ? ORDER BY sort_order"
    ).all(TRASH_NOTEBOOK_ID).map((r) => this.noteQueries.mapSummary(r as SummaryRow));
    const last = this.db.prepare("SELECT value FROM device_state WHERE key='last_opened_note_id'").get() as { value: string } | undefined;
    return {
      workspaceId: DEFAULT_WORKSPACE_ID,
      workspaceName: "LocalLakexNotes 本地仓库",
      notes,
      lastOpenedNoteId: last?.value ?? null,
      sync: { phase: "idle", message: "仅本地保存", lastSyncedAt: null, pendingChanges: 0 },
    };
  }

  /** v3 同步专用：单 SQL 取轻量元数据，禁止逐篇 readNote/getNoteInfo（大库会退化为全量 IO）。 */
  listNotesSyncMeta(): NoteSyncMeta[] {
    const rows = this.db.prepare(
      "SELECT n.id,n.title,n.parent_id,n.sort_order,n.updated_at,'' AS content_hash,n.is_conflict,n.is_locked,n.locked_at,n.trashed_at,n.deleted_from_parent_id,n.kind AS doc_kind,t.icon " +
      "FROM notes n LEFT JOIN tree_nodes t ON t.note_file_id=n.id WHERE n.deleted_at IS NULL ORDER BY n.sort_order"
    ).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      parentId: row.parent_id == null ? null : String(row.parent_id),
      sortOrder: Number(row.sort_order),
      updatedAt: String(row.updated_at),
      contentHash: row.content_hash == null ? "" : String(row.content_hash),
      isConflict: !!row.is_conflict,
      isEditLocked: !!row.is_locked,
      editLockedAt: row.locked_at == null ? null : String(row.locked_at),
      icon: row.icon == null ? null : String(row.icon),
      trashedAt: row.trashed_at == null ? null : String(row.trashed_at),
      deletedFromParentId: row.deleted_from_parent_id == null ? null : String(row.deleted_from_parent_id),
      kind: row.doc_kind == null ? "doc" : String(row.doc_kind),
    }));
  }

  /** 侧栏树：排除隐藏回收站笔记本及其全部后代（trash 子树只出现在回收站面板）。 */
  listTreeNodes(): TreeNode[] {
    return this.noteQueries.listTreeNodes();
  }

  private readTreeNode(id: string): TreeNode {
    // 与 listTreeNodes 共用同一 row 形状（LEFT JOIN notes 取 kind）——单节点回传绝不能丢 kind，
    // 否则渲染层 replaceTreeNode() 会把 board/usheet/bitable 的图标退化成文档图标（刷新才恢复）。
    return this.noteQueries.readTreeNode(id);
  }

  readNote(id: string): NoteDocument {
    const row = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,is_dirty,is_conflict,is_locked,locked_at,kind FROM notes WHERE id=? AND deleted_at IS NULL"
    ).get(id);
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    // 261023：正文文件被手动删除（ENOENT）不是"打开失败"——按「缺正文」只读打开，
    // 不再抛错（否则每次打开都弹 ENOENT，且渲染层无从处置）。其他 IO 错误仍抛出。
    let content = "";
    let bodyMissing = false;
    try {
      content = fs.readFileSync(this.notePath(id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      bodyMissing = true;
    }
    this.db.prepare("INSERT INTO device_state(key,value) VALUES('last_opened_note_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(id);
    return { ...this.noteQueries.mapSummary(row as SummaryRow), content, ...(bodyMissing ? { bodyMissing: true } : {}) };
  }

  /** 轻量状态摘要：只读 DB 行（不读正文文件），供渲染进程在同步后判断打开 tab 是否需重载。
   * - 返回 null：笔记已被彻底删除（purge）或从未存在；
   * - deleted=true：软删除（回收站/远端删除墓碑已应用）；
   * - 否则 updatedAt/title 任一变化即代表正文或元数据被远端更新过。 */
  getNoteDigest(id: string): NoteDigest | null {
    return readNoteDigest(this.db, id, TRASH_NOTEBOOK_ID);
  }

  createNote(title: string): NoteDocument {
    // 无默认笔记本概念：无父新建落到兜底父笔记本（任意存在的笔记本；无则自动创建"未分类"）
    return this.createNoteIn(this.resolveParentNotebook(), title);
  }

  createNoteIn(parentId: string | null, title: string): NoteDocument {
    const id = uuid();
    return this.createNoteInWithContent(parentId, title, emptyLakeBody(id), [], id, "bottom");
  }

  /** 新建 Univer 表格文档（kind="usheet"）：正文是 usheets/{id}.usheet.json（Univer IWorkbookData 快照）。 */
  createUsheetIn(parentId: string | null, title: string): NoteDocument {
    const id = uuid();
    return this.createNoteInWithContent(parentId, title, emptyUsheetBody(), [], id, "bottom", "usheet");
  }

  /**
   * 新建多维表文档（kind="bitable"）：正文是 bitables/{id}.bitable.json（自研 record-based JSON），
   * 其余全部复用文档管线（目录/回收站/历史/同步/GC）。v1 默认 = 1 张数据表（3 字段 + 表格视图）。
   */
  createBitableIn(parentId: string | null, title: string): NoteDocument {
    const id = uuid();
    return this.createNoteInWithContent(parentId, title, emptyBitableBody(), [], id, "bottom", "bitable");
  }

  /**
   * 新建画板文档（kind="board"）：正文是 boards/{id}.board.json（Drawnix/Plait 场景 JSON），
   * 其余全部复用文档管线（目录/回收站/历史/同步/GC）。v1 默认 = 空白画布（preset=drawing）。
   */
  createBoardIn(parentId: string | null, title: string): NoteDocument {
    const id = uuid();
    return this.createNoteInWithContent(parentId, title, emptyBoardBody(), [], id, "bottom", "board");
  }

  /** 新建手写板文档（kind="ink"）：正文是矢量墨迹 JSON（inks/{id}.ink.json）。 */
  createInkIn(parentId: string | null, title: string): NoteDocument {
    const id = uuid();
    return this.createNoteInWithContent(parentId, title, emptyInkBody(), [], id, "bottom", "ink");
  }

  /**
   * 在指定目录的顶部创建正式笔记。它是目录排序的底层通用能力：未来普通“新建文档”
   * 也可选择 top / bottom；小记转换仅是第一个使用者。
   *
   * sourcePath 只允许由主进程内部传入，先复制并验证目标资源，再写入元数据。若进程
   * 在跨空间转换中断，调用方的 conversion journal 会负责识别并清理未登记的目标文件。
   */
  createNoteInAtTopWithContent(parentId: string | null, title: string, content: string, assets: ImportedNoteAsset[], id = uuid(), kind: NoteKind = "doc"): NoteDocument {
    return this.createNoteInWithContent(parentId, title, content, assets, id, "top", kind);
  }

  private createNoteInWithContent(
    parentId: string | null,
    title: string,
    content: string,
    assets: ImportedNoteAsset[],
    id: string,
    position: "top" | "bottom",
    kind: NoteKind = "doc",
  ): NoteDocument {
    const parent = parentId ?? this.resolveParentNotebook();
    this.ensureParent(parent);
    this.assertParentCompatible(parent, "note");
    if (!isSafePathSegment(id)) throw new AppError("InvalidInput", `无效的笔记 ID: ${id}`);
    const normalizedTitle = title.trim() || "无标题文档";
    const updatedAt = nowIso();
    const sortOrder = position === "top" ? 0 : this.nextSortOrder(parent);
    const targetAssetsDir = this.noteAssetsDirFor(id);
    const targetNotePath = this.bodyPathFor(id, kind);

    // 资源副本先完整落盘；任何失败都在写数据库前回收，保证源小记绝不被影响。
    try {
      if (assets.length > 0) fs.mkdirSync(targetAssetsDir, { recursive: true });
      for (const asset of assets) {
        if (!isSafePathSegment(asset.filename)) throw new AppError("InvalidInput", `无效的资源文件名: ${asset.filename}`);
        if (!fs.existsSync(asset.sourcePath) || !fs.statSync(asset.sourcePath).isFile()) {
          throw new AppError("NotFound", `转换资源不存在: ${asset.filename}`);
        }
        const destination = path.join(targetAssetsDir, asset.filename);
        if (fs.existsSync(destination)) throw new AppError("InvalidInput", `目标资源重名: ${asset.filename}`);
        const temporary = `${destination}.tmp-${process.pid}`;
        fs.copyFileSync(asset.sourcePath, temporary);
        fs.renameSync(temporary, destination);
      }
      this.atomicWrite(targetNotePath, content);
      const tx = this.db.transaction(() => {
        if (position === "top") {
          // 同一事务内挪开所有同级节点和笔记元数据，避免排序重叠与 IPC 中断窗口。
          this.db.prepare("UPDATE tree_nodes SET sort_order=sort_order+1,updated_at=?,is_dirty=1 WHERE workspace_id=? AND parent_id=? AND deleted_at IS NULL")
            .run(updatedAt, DEFAULT_WORKSPACE_ID, parent);
          this.db.prepare("UPDATE notes SET sort_order=sort_order+1,updated_at=?,is_dirty=1 WHERE parent_id=? AND deleted_at IS NULL")
            .run(updatedAt, parent);
        }
        this.db.prepare("INSERT INTO notes(id,title,parent_id,sort_order,updated_at,is_dirty,kind) VALUES(?,?,?,?,?,1,?)")
          .run(id, normalizedTitle, parent, sortOrder, updatedAt, kind);
        this.noteKindCache.set(id, kind);
        this.db.prepare("INSERT INTO tree_nodes(id,workspace_id,parent_id,node_type,title,note_file_id,sort_order,created_at,updated_at,is_dirty,is_conflict) VALUES(?,?,?,'note',?,?,?,?,?,1,0)")
          .run(id, DEFAULT_WORKSPACE_ID, parent, normalizedTitle, id, sortOrder, updatedAt, updatedAt);
      });
      tx();
      // 新建文档立即入索引（标题即可搜）；索引失败不阻断创建，可由全量重建修复。
      try { this.searchRepository.upsert(id, normalizedTitle, ""); } catch { /* 忽略 */ }
    } catch (error) {
      // 本地原子性边界：元数据未成功时回收目标半成品；若元数据已成功，绝不误删。
      const exists = this.db.prepare("SELECT 1 FROM notes WHERE id=?").get(id);
      if (!exists) {
        try { fs.rmSync(targetNotePath, { force: true }); } catch { /* best effort */ }
        try { fs.rmSync(targetAssetsDir, { force: true, recursive: true }); } catch { /* best effort */ }
      }
      throw error;
    }
    return { id, title: normalizedTitle, parentId: parent, sortOrder, updatedAt, isDirty: true, isConflict: false, kind, content };
  }

  /** conversion journal 崩溃恢复使用：仅删除没有元数据登记的目标残留。 */
  removeUntrackedNoteArtifacts(id: string): void {
    if (!isSafePathSegment(id)) return;
    const exists = this.db.prepare("SELECT 1 FROM notes WHERE id=? AND deleted_at IS NULL").get(id);
    if (exists) return;
    for (const candidate of this.candidateBodyPaths(id)) {
      try { fs.rmSync(candidate, { force: true }); } catch { /* best effort */ }
    }
    try { fs.rmSync(this.noteAssetsDirFor(id), { force: true, recursive: true }); } catch { /* best effort */ }
  }

  hasNote(id: string): boolean {
    if (!isSafePathSegment(id)) return false;
    return !!this.db.prepare("SELECT 1 FROM notes WHERE id=? AND deleted_at IS NULL").get(id);
  }

  createNotebook(title: string): TreeNode {
    return this.noteMetadata.createNotebook(title);
  }

  createGroup(parentId: string, title: string): TreeNode {
    return this.noteMetadata.createGroup(parentId, title);
  }

  renameTreeNode(id: string, title: string): TreeNode {
    return this.noteMetadata.renameTreeNode(id, title);
  }

  saveNote(id: string, title: string, content: string, caches?: NoteCacheInput): NoteDocument {
    const startedAt = Date.now();
    // 非文档类型的正文不是 Lake HTML：缓存**只能**由主进程按类型派生；doc 仍沿用渲染层从内核带来的缓存（不改旧行为）。
    // 261019 review 实测：渲染层在没有 Lake 实例时也会传 { markdown:null, plain:null }（而非 undefined），
    // 若直接采用会把 text_cache / FTS 正文清空 ⇒ 多维表/表格/画板保存后正文搜不到。故非 doc 一律忽略入参。
    const kind = this.kindOf(id);
    this.noteContent.save(id, title, content, kind === "doc" ? caches : this.searchTextFor(id, content));
    // P1-2a：免回读——正文即入参 content（刚写入的同一字符串），不再 readFileSync 全文重读 +
    // IPC 全文回传；轻量 SELECT 只取元数据（无文件 IO）。副作用修正：保存不再误写
    // last_opened_note_id（那是「打开」语义，保存非活动文档不应改「最后打开」记录）。
    const row = this.db.prepare(
      "SELECT id,title,parent_id,sort_order,updated_at,is_dirty,is_conflict,is_locked,locked_at,kind FROM notes WHERE id=? AND deleted_at IS NULL"
    ).get(id);
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    // 261023：保存耗时 + 正文体量（"越写越慢"类问题的唯一量化依据）；慢保存升 info，其余 debug。
    const savedMs = Date.now() - startedAt;
    const savedChars = content.length;
    const saveFields = { id, chars: savedChars };
    if (savedMs >= 200 || savedChars >= 1024 * 1024) this.logScopes.store.info(perfMessage("note.save", savedMs, saveFields));
    else this.logScopes.store.debug(perfMessage("note.save", savedMs, saveFields));
    return { ...this.noteQueries.mapSummary(row as SummaryRow), content };
  }

  /** 15 分钟自动快照：标记文档为"本周期内保存过"（saveNote 落盘时调用） */
  markHistoryDirty(noteId: string): void {
    this.historyDirty.add(noteId);
  }

  /** 15 分钟自动快照：把 dirty 集合中文档各快照一次（force=false 走 24h 防抖），然后清空。
   * 返回实际创建的快照数。由主进程定时器调用。 */
  flushHistorySnapshots(): number {
    const t0 = Date.now();
    const pending = [...this.historyDirty];
    this.historyDirty.clear();
    let created = 0;
    for (const noteId of pending) {
      try {
        if (this.createHistorySnapshot(noteId)) created++;
      } catch { /* 单篇失败不阻断其余 */ }
    }
    this.logScopes.history.info(`[perf] flush-snapshots ${Date.now() - t0}ms (pending=${pending.length}, created=${created})`);
    return created;
  }

  /** M1：单独更新文本缓存（打开文档时补缓存用，不重写 .lake 正文） */
  updateNoteCaches(id: string, markdown: string | null, plain: string | null): void {
    this.db.prepare("UPDATE notes SET md_cache=?, text_cache=? WHERE id=?").run(markdown, plain, id);
    const titleRow = this.db.prepare("SELECT title FROM notes WHERE id=?").get(id) as { title: string } | undefined;
    this.searchRepository.upsert(id, titleRow?.title ?? "", plain ?? "");
  }

  /** 从磁盘 .lake 派生纯文本并写缓存列（不触发索引）；全量重建兜底用。 */
  private derivePlainText(id: string): string | null {
    const row = this.db.prepare("SELECT text_cache FROM notes WHERE id=?").get(id) as { text_cache: string | null } | undefined;
    if (!row) return null;
    if (row.text_cache != null) return row.text_cache;
    const content = fs.existsSync(this.notePath(id)) ? fs.readFileSync(this.notePath(id), "utf8") : "";
    const { markdown, plain } = this.searchTextFor(id, content);
    if (!markdown && !plain) return null;
    this.db.prepare("UPDATE notes SET md_cache=?, text_cache=? WHERE id=?").run(markdown, plain, id);
    return plain;
  }

  /**
   * 兜底补齐文本缓存：锁定态 Viewer 无法用内核 getDocument 生成缓存，
   * 这里从磁盘 .lake 正文解析 md/text 缓存（不重写正文）。
   * 已有缓存时不覆盖；传 lakeContent 则用它（避免重复读盘）。
   * 返回是否写入了新缓存。
   */
  ensureNoteCaches(id: string, lakeContent?: string): boolean {
    const caches = this.readNoteCaches(id);
    if (caches.markdown && caches.plain) return false;
    const content = lakeContent ?? (() => {
      if (!fs.existsSync(this.notePath(id))) return "";
      return fs.readFileSync(this.notePath(id), "utf8");
    })();
    const { markdown, plain } = this.searchTextFor(id, content);
    if (!markdown && !plain) return false;
    this.updateNoteCaches(id, markdown, plain);
    return true;
  }

  /** M1：读取文本缓存（导出资料包 / 复制 Markdown 用） */
  readNoteCaches(id: string): { markdown: string | null; plain: string | null } {
    const row = this.db.prepare("SELECT md_cache, text_cache FROM notes WHERE id=?").get(id) as { md_cache: string | null; text_cache: string | null } | undefined;
    if (!row) throw new AppError("NotFound", `笔记不存在: ${id}`);
    return { markdown: row.md_cache, plain: row.text_cache };
  }

  // ---- M2 全文搜索 ----

  /** Rebuild the full-text index without exposing repository internals to callers. */
  checkpointWal(): void {
    this.diagnostics.checkpointWal();
  }

  checkIntegrity(): { ok: boolean; integrity: string; foreignKeyErrors: number } {
    const row = this.db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    const foreignKeyErrors = this.db.prepare("PRAGMA foreign_key_check").all().length;
    const integrity = row?.integrity_check ?? "unknown";
    return { ok: integrity === "ok" && foreignKeyErrors === 0, integrity, foreignKeyErrors };
  }

  rebuildSearchIndex(): void {
    this.searchRepository.rebuild();
  }

  /** Search notes through FTS5, with the existing short-query title fallback. */
  searchNotes(query: string, limit = 30): SearchResult[] {
    return this.searchRepository.search(query, limit);
  }

  /** M1：返回文档正文/图片目录的绝对路径（供“复制资料路径给本机 AI”） */
  getNotePaths(id: string): { title: string; lakePath: string; assetsDir: string } {
    return this.noteExport.getNotePaths(id);
  }

  /** 文档属性：元数据 + 字数 + 引用资产 + 历史快照（"属性"弹窗）。 */
  getNoteInfo(id: string): NoteInfo {
    const doc = this.readNote(id);
    const created = this.db.prepare("SELECT created_at FROM tree_nodes WHERE id=?").get(id) as { created_at: string } | undefined;
    const { lakePath, assetsDir } = this.getNotePaths(id);
    const sizeBytes = fs.existsSync(lakePath) ? fs.statSync(lakePath).size : 0;
    const plain = this.readNoteCaches(id).plain ?? this.searchTextFor(id, doc.content).plain ?? "";
    // 字数/字符数 = 与内核 wordCount 同语义的单一来源（261016，B1；此前这里另写了一套正则）。
    const charCount = countChars(plain);
    const wordCount = countWords(plain);
    const seen = new Set<string>();
    const assets: NoteInfoAsset[] = [];
    for (const card of scanAssetCards(doc.content)) {
      if (!card.filename || seen.has(card.filename)) continue;
      seen.add(card.filename);
      // 图片/音视频卡的 value 不带 size（恒 0）：以磁盘实际大小兜底（file 卡 value.size 仍优先）。
      let size = card.size;
      if (!size) {
        try { size = fs.statSync(path.join(assetsDir, card.filename)).size; } catch { /* 文件缺失保持 0 */ }
      }
      assets.push({ filename: card.filename, size, kind: fileKindOf(card.filename) });
    }
    const parents = this.parentChainOf(id);
    const cardCounts = new Map<string, number>();
    for (const m of doc.content.matchAll(/<card\b[^>]*\bname="([^"]+)"/g)) {
      cardCounts.set(m[1], (cardCounts.get(m[1]) ?? 0) + 1);
    }
    const tableCount = (doc.content.match(/<table\b/g) ?? []).length;
    if (tableCount > 0) cardCounts.set("table", (cardCounts.get("table") ?? 0) + tableCount);
    // 当前正文 hash（就是刚读到的这份正文；与 note_history.content_hash 同口径 = 正文串的 sha256）
    // 历史面板据此标出"与当前版本一致"的那条快照。notes 表本身不存正文 hash，所以这里现算。
    const contentHash = crypto.createHash("sha256").update(doc.content).digest("hex");
    const cardStats = [...cardCounts.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: CARD_LABELS[key] ?? key, count }));
    return {
      id,
      title: doc.title,
      parentPath: parents.map((p) => p.title).join(" / "),
      parents,
      cardStats,
      createdAt: created?.created_at ?? null,
      updatedAt: doc.updatedAt,
      isDirty: doc.isDirty,
      isPurged: doc.isPurged,
      isConflict: doc.isConflict,
      isEditLocked: doc.isEditLocked ?? false,
      lakePath,
      assetsDir,
      sizeBytes,
      charCount,
      wordCount,
      contentHash,
      assets,
      assetTotalBytes: assets.reduce((sum, a) => sum + a.size, 0),
      history: this.listNoteHistory(id).map((h) => ({ id: h.id, createdAt: h.createdAt, size: h.size, contentHash: h.contentHash })),
    };
  }

  /**
   * 重命名附件（**只改展示名**，不动 note-assets 下的存储文件/路径）。
   * 用途：让微信等来源的 `weixin-xxx.pdf` 在文档里显示得体面。
   * 只处理 `name="file"` 卡（图片/音视频卡不展示名字，改了也没意义）。
   */
  renameAssetDisplay(noteId: string, filename: string, newName: string): { ok: boolean; changed: number } {
    const doc = this.readNote(noteId);
    const trimmed = newName.trim();
    if (!trimmed) throw new AppError("InvalidInput", "名称不能为空");
    const content = renameFileCardDisplay(doc.content, noteId, filename, trimmed);
    if (content === doc.content) return { ok: false, changed: 0 };
    this.saveNote(noteId, doc.title, content);
    return { ok: true, changed: 1 };
  }

  /** 所属路径链：自根向下的父级（笔记本 / 分组 …），带 id 供目录跳转。 */
  private parentChainOf(id: string): Array<{ id: string; title: string }> {
    const chain: Array<{ id: string; title: string }> = [];
    let parentId = (this.db.prepare("SELECT parent_id FROM tree_nodes WHERE id=?").get(id) as { parent_id: string | null } | undefined)?.parent_id ?? null;
    let guard = 0;
    while (parentId && guard++ < 64) {
      const row = this.db.prepare("SELECT id,parent_id,title FROM tree_nodes WHERE id=?").get(parentId) as { id: string; parent_id: string | null; title: string } | undefined;
      if (!row) break;
      chain.unshift({ id: row.id, title: row.title });
      parentId = row.parent_id;
    }
    return chain;
  }

  /** D01：导出多维表活动数据表为 CSV（UTF-8 BOM + CRLF，Excel 通用）。 */
  exportBitableCsv(id: string, baseDir?: string): { exportPath: string; rowCount: number; size: number } {
    return this.noteExport.exportBitableCsv(id, baseDir);
  }

  /** 文档（doc）：导出 Word（.docx，图片内嵌）。 */
  exportDocxNote(id: string, baseDir?: string): Promise<{ exportPath: string; imageCount: number; skipped: number; size: number }> {
    return this.noteExport.exportDocxNote(id, baseDir);
  }

  /** 表格（usheet）：导出指定 / 第一张工作表为 CSV。 */
  exportUsheetCsv(id: string, baseDir?: string, sheetId?: string): { exportPath: string; rowCount: number; sheetName: string; size: number } {
    return this.noteExport.exportUsheetCsv(id, baseDir, sheetId);
  }

  /** 表格（usheet）：导出全部工作表为 Excel（.xlsx，图片内嵌）。 */
  exportUsheetXlsx(id: string, baseDir?: string): Promise<{ exportPath: string; rowCount: number; sheetCount: number; imageCount: number; skipped: number; size: number }> {
    return this.noteExport.exportUsheetXlsx(id, baseDir);
  }

  /**
   * 表格类统一 CSV 入口（多维表 = 活动数据表 / 表格 = 指定工作表）：
   * 渲染层只认「导出为 CSV」，不必再自己判 kind、也不会把表格文档打到多维表导出上。
   */
  exportTableCsv(id: string, baseDir?: string, sheetId?: string): { exportPath: string; rowCount: number; size: number; sheetName?: string } {
    const kind = this.kindOf(id);
    if (kind === "bitable") return this.noteExport.exportBitableCsv(id, baseDir);
    if (kind === "usheet") return this.noteExport.exportUsheetCsv(id, baseDir, sheetId);
    if (!kind) throw new AppError("NotFound", `笔记不存在: ${id}`);
    throw new AppError("InvalidInput", "该文档不是表格或多维表，无法导出 CSV");
  }

  /** D01 续：导出多维表活动数据表为 ZIP（CSV + 附件/图片文件）。 */
  exportBitableZip(id: string, baseDir?: string): { exportPath: string; rowCount: number; fileCount: number; skipped: number; size: number } {
    return this.noteExport.exportBitableZip(id, baseDir);
  }

  /** M1：导出 HTML（读缓存 Markdown → 转换 + 复制图片 + 相对引用 → index.html）。 */
  exportHtmlNote(id: string, baseDir?: string): { exportPath: string; imageCount: number; skipped: number; size: number } {
    return this.noteExport.exportHtmlNote(id, baseDir);
  }

  /** M1：导出资料包（Markdown + 图片，自包含资料包）。 */
  exportNotePackage(id: string, baseDir?: string): { exportDir: string; imageCount: number; skipped: number; size: number } {
    return this.noteExport.exportNotePackage(id, baseDir);
  }

  /** M3：PDF 导出内容准备（图片内嵌的自包含临时 HTML + 唯一 pdf 目标路径；渲染在 export.ts）。 */
  exportPdfHtml(id: string, baseDir?: string): { htmlPath: string; tempDir: string; pdfPath: string; imageCount: number; skipped: number } {
    return this.noteExport.exportPdfHtml(id, baseDir);
  }

  // ===== 文档历史（快照，纯本地不参与同步） =====

  /** 创建历史快照。content 缺省时读磁盘 .lake；protectedDays>0 时写 protected_until（冲突归档保护，B3）。
   * 返回快照 id；同 hash 且 24h 内已有则跳过返回 null。 */
  createHistorySnapshot(noteId: string, content?: string, force = false, protectedDays?: number): number | null {
    return this.historyLifecycle.createHistorySnapshot(noteId, content, force, protectedDays);
  }

  /** 列出文档历史快照（新→旧）。 */
  listNoteHistory(noteId: string): HistorySnapshotSummary[] {
    return this.historyRepository.listForNote(noteId);
  }

  /** 快照预览：解压历史快照正文 → 纯文本。 */
  previewHistorySnapshot(historyId: number): HistorySnapshotPreview | null {
    return this.historyRepository.preview(historyId);
  }

  /** 孤儿文件预览：读取 note-assets/{noteId}/{filename} 内容。
   * 图片返回 base64 data URL；文本返回前 64KB；其他返回 null。 */
  previewNoteOrphan(noteId: string, filename: string): { kind: "image" | "text"; data: string; size: number } | null {
    return this.orphanLifecycle.previewNoteOrphan(noteId, filename);
  }

  /** 恢复历史版本（恢复前留档 + 解压写回 + 标 local 待上传；语义详见 historyLifecycle）。 */
  restoreHistory(historyId: number): void {
    this.historyLifecycle.restoreHistory(historyId);
  }

  /** 手动删除单个历史快照（文件 + DB）。调用方随后刷新孤儿列表（顺序 §5）。 */
  deleteHistory(historyId: number): void {
    this.historyLifecycle.deleteHistory(historyId);
  }

  /** 惰性清理：每文档超上限删最旧 + 天数兜底；删除后重算引用，无引用资源物理删（方案 A）。 */
  cleanupHistory(): HistoryCleanupResult {
    return this.historyLifecycle.cleanupHistory();
  }

  /** 历史占用统计（U6/P4：设置面板展示"快照总数 + 占用字节"）。 */
  getHistoryStats(): { snapshotCount: number; totalBytes: number } {
    return this.historyRepository.stats();
  }

  /** 公共引用集（当前正文 ∪ 历史 refs）：历史/孤儿/S3 keep 三处复用。 */
  getProtectedRefs(noteId: string): Set<string> {
    return this.assetRepository.getProtectedRefs(noteId);
  }

  /** 所有存在历史快照的 noteId（S3 GC keep 集历史引用保护用）。 */
  listNoteIdsWithHistory(): string[] {
    return this.assetRepository.listNoteIdsWithHistory();
  }

  /** 当前正文引用集（上传资格判定用）。 */
  getCurrentContentRefs(noteId: string): Set<string> {
    return this.assetRepository.getCurrentContentRefs(noteId);
  }

  /** 文档级孤儿列表（实时）：磁盘文件 − (当前正文引用 ∪ 历史 refs) */
  listNoteOrphans(noteId: string): Array<{ filename: string; size: number; mimeType: string; protectedByHistory: boolean }> {
    return this.orphanLifecycle.listNoteOrphans(noteId);
  }

  /** 清理文档级孤儿：只删非 protectedByHistory 的文件（被历史引用的跳过）。
   * filenames 缺省清全部可清。 */
  cleanNoteOrphans(noteId: string, filenames?: string[]): { count: number; freedBytes: number } {
    return this.orphanLifecycle.cleanNoteOrphans(noteId, filenames);
  }

  deleteNote(id: string) {
    this.deleteTreeNode(id);
  }

  private descendantIds(id: string): string[] {
    const result: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      result.push(cur);
      const children = this.db.prepare("SELECT id FROM tree_nodes WHERE parent_id=? AND deleted_at IS NULL").all(cur) as { id: string }[];
      for (const c of children) stack.push(c.id);
    }
    return result;
  }

  /**
   * 无父新建/恢复/同步兜底的父笔记本（系统中没有"默认笔记本"——所有笔记本都是普通笔记本）：
   * 1. 任意存在的笔记本（非回收站，sortOrder 最小）→ 用它；
   * 2. 否则自动创建一个普通笔记本"未分类"（随机 ID + 图标 X，与用户手动创建完全一致，可随意删除）。
   * 仅在"必须给内容一个家"（新建/恢复/同步导入，数据不丢红线）时自动创建。
   */
  private resolveParentNotebook(): string {
    // 回收站容器（notebook-trash）本身也是根层 notebook，必须显式排除；
    // 根层笔记本 parent_id 为 NULL：parent_id != ? 对 NULL 恒不成立（SQL 三值逻辑），必须显式允许 NULL
    const any = this.db.prepare(
      "SELECT id FROM tree_nodes WHERE node_type='notebook' AND deleted_at IS NULL AND id != ? AND (parent_id IS NULL OR parent_id != ?) ORDER BY sort_order LIMIT 1"
    ).get(TRASH_NOTEBOOK_ID, TRASH_NOTEBOOK_ID) as { id: string } | undefined;
    if (any) return any.id;
    const created = this.createNotebook("未分类");
    try { this.setNodeIcon(created.id, "X"); } catch { /* 图标设置失败不影响兜底 */ }
    return created.id;
  }

  /**
   * 软删除（移入隐藏回收站笔记本）：记录 trashed_at + 删除前父目录，标 local 待上传；
   * 不写墓碑（回收站条目是普通条目，移动即同步传播）；文件保留；彻底删除走 purgeTrashItem。
   */
  deleteTreeNode(id: string) {
    this.trashLifecycle.deleteTreeNode(id);
  }

  /** 回收站：trash 笔记本的直接子节点（文件夹整体显示，子节点随动）。 */
  listTrash(): TrashItem[] {
    return this.trashRepository.list();
  }

  /** M9：回收站自动过期候选。 */
  listTrashReminder(days: number): TrashReminderItem[] {
    return this.trashRepository.listReminder(days);
  }

  /** 回收站自动过期（TRASH-NOTEBOOK）：trashed_at 超过 N 天的 trash 顶级条目自动 purge。返回 purge 数。 */
  autoPurgeExpiredTrash(days: number): number {
    return this.trashLifecycle.autoPurgeExpiredTrash(days);
  }

  /** 恢复回收站节点：移回原位置（deleted_from_parent_id）；原父不存在/已被删/在回收站 → 默认笔记本。 */
  restoreTrashItem(id: string): void {
    this.trashLifecycle.restoreTrashItem(id);
  }

  /**
   * 撤销本地删除（sync 下载分支在"远端恢复较新"时调用）：清 purge 墓碑。
   * 语义详见 trashLifecycle（不强制标 local——远端为权威，随后由下载/对账流程对齐并 markSynced）。
   */
  revokeLocalDeletion(id: string): void {
    this.trashLifecycle.revokeLocalDeletion(id);
  }

  /** 彻底删除回收站节点（不可恢复）：物理删子树 + 写 purge 墓碑（deleted_notes，带 purged_at）。 */
  purgeTrashItem(id: string): void {
    this.trashLifecycle.purgeTrashItem(id);
  }

  /** 清空回收站：彻底删除 trash 笔记本的全部根节点（各 purge 连带子树，写 purge 墓碑）。 */
  emptyTrash(): void {
    this.trashLifecycle.emptyTrash();
  }

  /** M1.6：设置/清除文档或分组的自定义图标（emoji，本地化） */
  setNodeIcon(id: string, icon: string | null): TreeNode {
    return this.noteMetadata.setNodeIcon(id, icon);
  }

  moveTreeNode(id: string, parentId: string | null, sortOrder: number): TreeNode {
    return this.noteMetadata.moveTreeNode(id, parentId, sortOrder);
  }

  /** 审计 #18：移动 + 同级重排一次原子完成。 */
  moveTreeNodeOrdered(id: string, parentId: string | null, orderedIds: string[]): TreeNode {
    return this.noteMetadata.moveTreeNodeOrdered(id, parentId, orderedIds);
  }

  reorderTreeNodes(parentId: string | null, orderedIds: string[]): void {
    this.noteMetadata.reorderTreeNodes(parentId, orderedIds);
  }

  private noteAssetsDirFor(noteId: string): string {
    if (!isSafePathSegment(noteId)) {
      throw new AppError("InvalidInput", `无效的笔记 ID: ${noteId}`);
    }
    return path.join(this.noteAssetsDir, noteId);
  }

  private assetUrl(noteId: string, filename: string): string {
    return `http://127.0.0.1:${ASSET_PORT}/${noteId}/${filename}`;
  }

  /** 单条删除未引用资源（与 cleanOrphanAssets 同规则：清理前按当前正文/历史引用再校验）。 */
  deleteOrphanAsset(id: number): { deleted: boolean; freedBytes: number } {
    return this.orphanLifecycle.deleteOrphanAsset(id);
  }

  /** 读取孤儿文件预览（仅图片返回 dataUrl；其它类型/过大返回 supported=false）。 */
  readOrphanPreview(id: number): { filename: string; mimeType: string; supported: boolean; dataUrl?: string } {
    return this.orphanLifecycle.readOrphanPreview(id);
  }

  /** 按 noteId+filename 直接读取 note-assets 下文件预览（未引用资源/历史保护文件共用；路径双段校验）。 */
  readAssetPreview(noteId: string, filename: string): { filename: string; mimeType: string; supported: boolean; dataUrl?: string } {
    return this.orphanLifecycle.readAssetPreview(noteId, filename);
  }

  /** 读取 note-assets 下文件原始字节（多模态 AI 用：图片 / PDF）。 */
  readAssetBytes(noteId: string, filename: string): { bytes: Buffer; size: number; mimeType: string } | null {
    return this.orphanLifecycle.readAssetBytes(noteId, filename);
  }

  /** 全局“未引用/被移除资源”汇总（orphan 可删 / history 受保护；设置页聚合）。 */
  listRemovedAssets(): Array<{
    noteId: string; filename: string; status: "orphan" | "history"; orphanId?: number;
    size: number; mimeType: string; noteTitle: string; noteState: "active" | "trash" | "missing"; detectedAt?: string;
    /** 登记在、磁盘文件已不在（设置页「缺失」分类）。 */
    fileMissing: boolean;
  }> {
    return this.orphanLifecycle.listRemovedAssets();
  }

  listOrphanAssets(): OrphanAsset[] {
    return this.orphanLifecycle.listOrphanAssets();
  }

  /** 某笔记当前登记的孤儿文件名集合（供“孤儿不同步上传”过滤与 UI 幂等）。 */
  orphanFilenamesForNote(noteId: string): Set<string> {
    return this.orphanLifecycle.orphanFilenamesForNote(noteId);
  }

  cleanOrphanAssets(): { count: number; freedBytes: number } {
    return this.orphanLifecycle.cleanOrphanAssets();
  }

  /** 关于页「数据与存储」概览（只读）：库内计数 + 资源目录浅两层遍历（不做全盘扫描）。
   * 小记在独立库（quick-notes/metadata.sqlite3），计数由调用方补（见 registerSystemInfo）。 */
  getStorageOverview(): {
    root: string; dbBytes: number;
    notes: number; notebooks: number; groups: number; trashedNodes: number; tombstones: number;
    historySnapshots: number; historyBytes: number;
    assetFiles: number; assetBytes: number; orphanRows: number;
  } {
    return this.diagnostics.getStorageOverview();
  }

  // ===== A3 数据体检（只读诊断：不自动修复、不写库） =====

  /** 只读四查（notes↔文件、history↔快照、孤儿登记漂移、树完整性 + 资源引用；语义详见 diagnostics）。 */
  runDataHealthCheck(): {
    notesChecked: number;
    notesMissingFile: Array<{ id: string; title: string }>;
    notesHashMismatch: Array<{ id: string; title: string }>;
    historyChecked: number;
    historyMissingFile: number;
    historyMissingSample: Array<{ id: number; noteId: string; filePath: string }>;
    orphanRowsChecked: number;
    orphanRowsFileMissing: Array<{ id: number; noteId: string; filename: string }>;
    treeChecked: number;
    treeDanglingParent: Array<{ id: string; title: string; parentId: string }>;
    refsChecked: number;
    refsMissingResource: Array<{ noteId: string; filename: string }>;
    checkedAt: string;
  } {
    return this.diagnostics.runDataHealthCheck();
  }

  /** A1 一致性 DB 快照：VACUUM INTO 单文件（无 WAL 依赖、可独立打开）。 */
  backupDatabaseTo(targetPath: string): void {
    this.diagnostics.backupDatabaseTo(targetPath);
  }

  // ===== S3 同步支持 =====

  getS3Settings(): S3Settings | null {
    return this.settingsRepository.getS3Settings();
  }

  /** A2 恢复 seed：导出 settings 表原始行（密文直通，绝不解密）。无配置 → null。 */
  exportS3SettingsRow(): string | null {
    return this.settingsRepository.exportS3SettingsRow();
  }

  /** A2 恢复 seed：把密文行原样写回（不经 saveS3Settings，避免二次加密）。 */
  importS3SettingsRow(value: string): void {
    this.settingsRepository.importS3SettingsRow(value);
  }

  /** 历史保留策略配置（P5）：读取，缺省返回默认值 */
  getHistorySettings(): HistorySettings {
    return this.settingsRepository.getHistorySettings();
  }

  saveHistorySettings(settings: HistorySettings): void {
    this.settingsRepository.saveHistorySettings(settings);
  }

  /** AI 设置（P0）：密钥加密落盘、独立 key，不参与 S3/同步/导出。 */
  getAiSettings(): AiSettings {
    return this.settingsRepository.getAiSettings();
  }

  saveAiSettings(settings: AiSettings): void {
    this.settingsRepository.saveAiSettings(settings);
  }

  saveS3Settings(settings: S3Settings): void {
    this.settingsRepository.saveS3Settings(settings);
  }

  /** 正文文件是否缺失（只 stat，不读正文；启动跳过缺正文文档用）。 */
  isNoteBodyMissing(id: string): boolean {
    return !fs.existsSync(this.notePath(id));
  }
  /**
   * 资源页「缺正文」清单（261023）：只 stat、不读正文；带历史快照数 / 同步基线 / 云配置，
   * 供 UI 分组（云可恢复 / 仅历史 / 无备份）与处置。
   */
  listMissingBodies(): MissingBodyDoc[] {
    const rows = this.db.prepare(`
      SELECT n.id, n.title, n.kind, n.updated_at, n.parent_id,
             (SELECT COUNT(*) FROM note_history h WHERE h.note_id = n.id) AS history_count,
             (SELECT MAX(h.id) FROM note_history h WHERE h.note_id = n.id) AS last_history_id,
             (SELECT 1 FROM sync_base b WHERE b.note_id = n.id) AS has_sync_base
      FROM notes n
      WHERE n.deleted_at IS NULL AND n.parent_id != ?
    `).all(TRASH_NOTEBOOK_ID) as Array<{ id: string; title: string; kind: string | null; updated_at: string; parent_id: string | null; history_count: number; last_history_id: number | null; has_sync_base: number | null }>;
    // 可云恢复 = 已配置 S3 **且**允许出网（「关闭云同步 = 完全没配置」红线：关闭时任何路径不出网）。
    // 只配置但关闭同步的库，这条判据为 false，UI 会归到"仅历史 / 无备份"，不会诱导点击后报"云同步不可用"。
    const cloudConfigured = canTouchNetwork(cloudStateOf(this.getS3Settings() !== null, this.getSyncSettings()));
    const out: MissingBodyDoc[] = [];
    for (const row of rows) {
      if (fs.existsSync(this.notePath(row.id))) continue;
      const historyCount = Number(row.history_count) || 0;
      const hasSyncBase = row.has_sync_base === 1;
      out.push({
        id: row.id,
        title: row.title,
        kind: normalizeNoteKind(row.kind) ?? "doc",
        updatedAt: row.updated_at,
        parentId: row.parent_id ?? null,
        historyCount,
        lastHistoryId: row.last_history_id ?? null,
        hasSyncBase,
        cloudConfigured,
        recovery: missingBodyRecovery({ cloudConfigured, hasSyncBase, historyCount }),
      });
    }
    out.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return out;
  }

  /** 从云端恢复正文时落盘（原子写；调用方负责校验 hash 与记账）。 */
  writeRestoredBody(noteId: string, content: string): void {
    const target = this.notePath(noteId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, target);
  }

  /**
   * 彻底删除「缺正文」文档：先走正常删除流程移入回收站（保留 deleted_from_parent_id 语义），
   * 再彻底删除（写 purge 墓碑 ⇒ 云端下架、不会复活）。正文文件本来就不存在，不涉及文件移动。
   */
  purgeMissingBodyNote(id: string): void {
    this.trashLifecycle.deleteTreeNode(id);
    this.trashLifecycle.purgeTrashItem(id);
  }


  /** v3 发布成功后批量标记已同步（只改同步账本/UI dirty，不碰正文）。 */
  markNotesSynced(ids: readonly string[]): void {
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 200) {
      const batch = unique.slice(i, i + 200);
      const ph = batch.map(() => "?").join(",");
      this.db.prepare("UPDATE notes SET is_dirty=0 WHERE id IN (" + ph + ") AND is_purged=0").run(...batch);
      this.db.prepare("UPDATE tree_nodes SET is_dirty=0 WHERE note_file_id IN (" + ph + ") AND is_purged=0").run(...batch);
    }
  }

  contentHash(id: string): string {
    return this.syncReconciliation.contentHash(id);
  }

  baseHash(id: string): string | null {
    return this.syncReconciliation.baseHash(id);
  }

  setBaseHash(id: string, hash: string): void {
    this.syncReconciliation.setBaseHash(id, hash);
  }

  /** P0-1：本机最后一次成功上传某文档的 hash；null = 清除（两端一致 skip 记账用）。 */
  setLastUploadedHash(id: string, hash: string | null): void {
    this.syncReconciliation.setLastUploadedHash(id, hash);
  }

  /** P0-1：读本机最后一次上传的 hash（无则 null） */
  lastUploadedHash(id: string): string | null {
    return this.syncReconciliation.lastUploadedHash(id);
  }

  /** 统一冲突语义：本设备"上次成功同步时该笔记的 updated_at"（元数据已确认版本；无则 null）。 */
  lastSyncedMetaAt(id: string): string | null {
    return this.syncReconciliation.lastSyncedMetaAt(id);
  }

  /** 批量读 hash 账本（同步环一次预载）。 */
  getAllSyncBases(): Map<string, { contentHash: string; lastUploadedHash: string | null; lastSyncedMetaAt: string | null }> {
    return this.syncReconciliation.getAllSyncBases();
  }

  /** 只读锁：本地操作；不触碰正文/updated_at，锁同步走 manifest v3 独立字段 */
  setNoteEditLocked(id: string, locked: boolean): void {
    this.noteMetadata.setNoteEditLocked(id, locked);
  }

  /** 同步合并写入（远端锁状态按 editLockedAt LWW 后由调用方判定）。 */
  applyRemoteEditLock(id: string, locked: boolean, editLockedAt: string | null): void {
    this.noteMetadata.applyRemoteEditLock(id, locked, editLockedAt);
  }

  /** 本地同步快照保护（V5 §5.2）：仅当本地状态与快照一致才标记 synced（语义详见 syncReconciliation）。 */
  markSyncedIfUnchanged(noteId: string, expected: {
    contentHash: string; updatedAt: string; title: string; parentId: string | null;
    sortOrder: number; isEditLocked: boolean; editLockedAt: string | null; icon: string | null;
  }): boolean {
    return this.syncReconciliation.markSyncedIfUnchanged(noteId, expected);
  }

  markSynced(id: string): void {
    this.syncReconciliation.markSynced(id);
  }

  /** 目录/分组归位（V5 §5.1）：按构建 manifest 时的 updatedAt 快照条件归位。 */
  markFolderSynced(id: string, expectedUpdatedAt: string): boolean {
    return this.syncReconciliation.markFolderSynced(id, expectedUpdatedAt);
  }

  /** 是否处于"回收站恢复后待同步"状态（墓碑权威下唯一 local-wins 例外）。 */
  isRestorePending(id: string): boolean {
    return this.syncReconciliation.isRestorePending(id);
  }

  /** 是否处于待上传/本地未对齐状态（sync_state != synced）。 */
  isSyncPending(id: string): boolean {
    return this.syncReconciliation.isSyncPending(id);
  }

  getS3GcSettings(): S3GcSettings {
    return this.settingsRepository.getS3GcSettings();
  }

  saveS3GcSettings(settings: S3GcSettings): void {
    this.settingsRepository.saveS3GcSettings(settings);
  }

  getSyncSettings(): SyncSettings {
    return this.settingsRepository.getSyncSettings();
  }

  saveSyncSettings(settings: SyncSettings): void {
    this.settingsRepository.saveSyncSettings(settings);
  }

  addS3GcPending(key: string, markedAt?: string): void {
    this.syncReconciliation.addS3GcPending(key, markedAt);
  }

  removeS3GcPending(keys: string[]): void {
    this.syncReconciliation.removeS3GcPending(keys);
  }

  listS3GcPending(): Array<{ key: string; markedAt: string }> {
    return this.syncReconciliation.listS3GcPending();
  }
  /** A 方案：记录 manifest 声明的资产元数据（即使本地文件缺失，上传 union 仍可正确声明）。 */
  recordDeclaredAssets(noteId: string, assets: Array<{ filename: string; size: number; hash: string }>): void {
    this.syncReconciliation.recordDeclaredAssets(noteId, assets);
  }

  /** A 方案：列出该笔记已声明（含本地缺失但 manifest 声明过）的资产元数据。 */
  listDeclaredAssets(noteId: string): Array<{ filename: string; size: number; hash: string }> {
    return this.syncReconciliation.listDeclaredAssets(noteId);
  }

  recordS3GcLog(action: string, key: string, reason: string, commitId: string | null, deviceId: string | null, ok: boolean): void {
    this.syncReconciliation.recordS3GcLog(action, key, reason, commitId, deviceId, ok);
  }

  listS3GcLog(): Array<{ id: number; ts: string; action: string; key: string; reason: string; commitId: string | null; deviceId: string | null; ok: boolean }> {
    return this.syncReconciliation.listS3GcLog();
  }

  markSyncComplete(at: string): void {
    this.syncReconciliation.markSyncComplete(at);
  }

  recordSyncResult(json: string): void {
    this.syncReconciliation.recordSyncResult(json);
  }

  /** P4：记录最近一次历史清理结果（自动/手动），供设置面板展示与排查 */
  recordHistoryCleanup(result: HistoryCleanupResult): void {
    this.syncReconciliation.recordHistoryCleanup(result);
  }

  getLastHistoryCleanup(): { at: string; deletedSnapshots: number; freedBytes: number } | null {
    return this.syncReconciliation.getLastHistoryCleanup();
  }

  /** 已写入同步清单的删除标记可安全剪除，避免 deleted_notes 无限累积 */
  pruneTombstones(ids: string[]): void {
    this.syncReconciliation.pruneTombstones(ids);
  }

  getSyncStatus(): { lastSyncedAt: string | null; lastResult: Record<string, unknown> | null } {
    return this.syncReconciliation.getSyncStatus();
  }

  notePathFor(id: string): string {
    return this.notePath(id);
  }

  noteAssetsPathFor(id: string): string {
    return this.noteAssetsDirFor(id);
  }

  /** 渲染层刷新用：全部笔记摘要（含锁状态）。 */
  listNoteSummaries(): NoteSummary[] {
    return this.noteQueries.listNoteSummaries();
  }

  listNotesForSync(): SyncNote[] {
    return this.noteQueries.listNotesForSync();
  }

  /** P3-1：单行同步元数据查询（getNote/记账路径用，替代全表 .find()）。 */
  getNoteForSync(id: string): SyncNote | null {
    return this.noteQueries.getNoteForSync(id);
  }

  /** 同步目录树：活动 notebook/group（不包含隐藏回收站笔记本）。 */
  listFoldersForSync(): SyncFolder[] {
    return this.noteQueries.listFoldersForSync();
  }

  /** 导入远端 notebook/group 节点。 */
  importRemoteFolder(folder: SyncFolder): void {
    this.noteMetadata.importRemoteFolder(folder);
  }

  /** 兜底父笔记本（无默认笔记本概念）：存在的笔记本 → 无则自动创建"未分类"（见 resolveParentNotebook）。 */
  defaultNotebookId(): string {
    return this.resolveParentNotebook();
  }

  hasTreeNode(id: string): boolean {
    return this.noteMetadata.hasTreeNode(id);
  }

  /** 正文 hash 相同、仅元数据变化（标题/父目录/排序/图标/回收站字段）时的对账。 */
  applyRemoteNoteMeta(note: SyncNote): void {
    this.syncReconciliation.applyRemoteNoteMeta(note);
  }

  /** 远端把该笔记移入回收站（软删传播，删除压编辑；详见 syncReconciliation）。 */
  applyRemoteMoveToTrash(id: string, trashedAt: string | null, deletedFromParentId: string | null): void {
    this.syncReconciliation.applyRemoteMoveToTrash(id, trashedAt, deletedFromParentId);
  }

  /** 远端恢复该笔记（移出回收站传播）：移回原位置 + 清回收站字段，标 local 待下载分支对齐。 */
  applyRemoteRestore(id: string, parentId: string | null, updatedAt: string): void {
    this.syncReconciliation.applyRemoteRestore(id, parentId, updatedAt);
  }

  /** 收到他端 purge 墓碑：本地条目移入回收站并标 purged（保留可恢复、不上传）。 */
  applyRemotePurge(id: string): void {
    this.syncReconciliation.applyRemotePurge(id);
  }

  /** 记录"从云端学到的删除"（防 manifest 删除标记因设备清空/换机丢失，审计 #2）。 */
  rememberDeleted(note: SyncNote, deletedAt: string): void {
    this.syncReconciliation.rememberDeleted(note, deletedAt);
  }

  /** v5：记录"从云端学到的 folder 删除"（本设备从未持有该目录），node_type='folder' 墓碑防复活。 */
  rememberFolderDeleted(folder: { id: string; title: string; parentId: string | null; sortOrder: number; updatedAt?: string }, deletedAt: string): void {
    this.syncReconciliation.rememberFolderDeleted(folder, deletedAt);
  }

  /** v5：收到他端 folder 墓碑：folder 子树移入回收站标 purged（行保留可恢复、不上传）。 */
  applyRemoteFolderDelete(id: string, deletedAt: string): void {
    this.syncReconciliation.applyRemoteFolderDelete(id, deletedAt);
  }

  /** purge 前缀删除成功后，清除 purged_at（保留墓碑，避免下次同步重复删前缀）。 */
  markPurgeSynced(id: string): void {
    this.syncReconciliation.markPurgeSynced(id);
  }

  listDeletedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; nodeType: string }> {
    return this.syncReconciliation.listDeletedNotesForSync();
  }

  /** v3 删除意图来源：已彻底删除（purged_at 非空）的墓碑；用于把本地 purge 传播到云端。 */
  listPurgedTombstones(): Array<{ id: string; purgedAt: string | null }> {
    return (this.db.prepare("SELECT id, purged_at FROM deleted_notes WHERE purged_at IS NOT NULL").all() as Array<{ id: string; purged_at: string | null }>)
      .map((r) => ({ id: r.id, purgedAt: r.purged_at }));
  }

  /** 墓碑已发布到 manifest：标记 published_at；墓碑本体永久保留（审计 #2）。 */
  markTombstonesPublished(ids: string[]): void {
    this.syncReconciliation.markTombstonesPublished(ids);
  }

  /** 零变更早退：本设备上次成功读/写的 manifest commitId（device_state）。 */
  getLastSeenCommitId(): string | null {
    return this.syncReconciliation.getLastSeenCommitId();
  }
  setLastSeenCommitId(commitId: string): void {
    this.syncReconciliation.setLastSeenCommitId(commitId);
  }

  /** 本地上次同步时的墓碑签名（COUNT:MAX(deleted_at)），早退判定"是否新增了 purge"。 */
  getLastTombstoneSig(): string {
    return this.syncReconciliation.getLastTombstoneSig();
  }
  setLastTombstoneSig(sig: string): void {
    this.syncReconciliation.setLastTombstoneSig(sig);
  }
  tombstoneSignature(): string {
    return this.syncReconciliation.tombstoneSignature();
  }

  /** 廉价 pending 指纹（三个索引级 COUNT，微秒级）：IPC 层每次调用后 diff，变化才广播完整摘要。 */
  pendingSignature(): string {
    return this.syncReconciliation.pendingSignature();
  }

  getSyncPendingSummary(): { documents: number; folders: number; resources: number; generatedAt: string } {
    return this.syncReconciliation.getSyncPendingSummary();
  }

  /** 是否有本地待上传变更（早退判定；详见 syncReconciliation）。 */
  hasLocalPendingNotes(): boolean {
    return this.syncReconciliation.hasLocalPendingNotes();
  }

  /** 批量读取同步基线信息（一次性取回，替代逐条 lastSyncedMetaAt 查询 + 支撑记账去重）。 */
  allSyncBaseInfo(): Map<string, { syncState: string; updatedAt: string; baseHash: string | null; lastSyncedMetaAt: string | null; lastUploadedHash: string | null }> {
    return this.syncReconciliation.allSyncBaseInfo();
  }

  /** 本地已彻底删除（purge）过的 folder/group（永久判定，node_type='folder' 墓碑；详见 syncReconciliation）。 */
  isFolderPurged(id: string): boolean {
    return this.syncReconciliation.isFolderPurged(id);
  }

  /** 已彻底删除（purge）的墓碑：下次同步需立即删 S3 前缀。 */
  listPurgedNotesForSync(): Array<{ id: string; title: string; parentId: string | null; sortOrder: number; updatedAt: string; deletedAt: string; purgedAt: string }> {
    return this.syncReconciliation.listPurgedNotesForSync();
  }

  /** 导入远程笔记：写 .lake + note-assets 资源 + upsert DB 记录。 */
  importRemoteNote(note: SyncNote, content: Buffer, assets: Array<{ filename: string; bytes: Buffer }>): void {
    this.remoteImport.importNote(note, content, assets);
  }

  async uploadResource(input: { bytes: Uint8Array; filename: string }, noteId: string): Promise<ResourceUploadOutput> {
    return this.resourceRepository.upload(input, noteId);
  }

  async downloadRemoteResource(url: string, noteId: string): Promise<ResourceUploadOutput> {
    return this.resourceRepository.downloadRemote(url, noteId);
  }

}
