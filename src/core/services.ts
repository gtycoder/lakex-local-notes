/**
 * 跨端服务契约（lake-core，V5 Phase 3）。
 * 移动端页面真实需求的最小形态：纯接口 + DTO，不搬实现、不依赖 Electron/IPC。
 * 桌面适配器：src/lib/services.ts（createNativeServices，字段映射替代类型断言）。
 * 明确不进契约：导出 docx/pdf、S3 GC、pickExportDir、窗口控制（桌面专属）。
 */

// ===== DTO（最小字段，跨端稳定） =====

export interface NoteDto {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  content: string;
  isEditLocked: boolean;
}

export interface TreeNodeDto {
  id: string;
  parentId: string | null;
  nodeType: "notebook" | "group" | "note";
  title: string;
  sortOrder: number;
  updatedAt: string;
  noteFileId: string | null;
}

export interface NoteDigestDto {
  id: string;
  title: string;
  updatedAt: string;
  deleted: boolean;
}

export interface QuickNoteImageDto {
  id: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  size: number;
}

export interface QuickNoteDto {
  id: string;
  createdAt: string;
  updatedAt: string;
  text: string;
  images: QuickNoteImageDto[];
  /** 展示用标签名（由标签表解析）。 */
  tags: string[];
  /** 标签 ID（写入时用）。 */
  tagIds: string[];
  syncState: "local" | "synced" | "conflict";
  isConflict: boolean;
}

export interface TrashItemDto {
  id: string;
  title: string;
  deletedAt: string;
}

export interface UploadedAssetDto {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface SyncResultDto {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  completedAt: string;
}

export interface SyncStatusDto {
  phase: "idle" | "syncing" | "success" | "error";
  message: string;
  lastSyncedAt: string | null;
}

// ===== 服务契约 =====

export interface NoteService {
  /** 目录树（notebook/group/note）。 */
  listTree(): Promise<TreeNodeDto[]>;
  readNote(id: string): Promise<NoteDto>;
  /** 父目录语义：parentId=null 建在兜底父笔记本（无默认笔记本：存在的笔记本 → 无则自动创建"未分类"）。 */
  createNote(parentId: string | null, title: string): Promise<NoteDto>;
  /** 保存正文（标题随正文一并保存）。 */
  saveNoteContent(id: string, title: string, content: string): Promise<NoteDto>;
  /** 仅改标题（不动正文）。 */
  renameNote(id: string, title: string): Promise<TreeNodeDto>;
  moveNote(id: string, parentId: string | null, sortOrder: number): Promise<TreeNodeDto>;
  deleteNote(id: string): Promise<void>;
  getNoteDigest(id: string): Promise<NoteDigestDto | null>;
}

/** 小记保存输入：draftId 为平台 staging 会话（桌面 = staging 目录会话；移动端 = 对应 staging 机制）。 */
export interface SaveQuickNoteInputDto {
  text: string;
  /** 本次会话已 staging 的图片 id 列表。 */
  stagedImageIds: string[];
  /** 更新时保留的既有图片 id 列表（缺省 = 全部保留）。 */
  retainedImageIds?: string[];
  /** staging 会话 id（桌面必填，isSafeSegment 校验非空）。 */
  draftId: string;
  /** 标签 ID（顺序 = 最近添加在前）。 */
  tagIds?: string[];
}

export interface QuickNoteService {
  list(): Promise<QuickNoteDto[]>;
  create(input: SaveQuickNoteInputDto): Promise<QuickNoteDto>;
  update(id: string, input: SaveQuickNoteInputDto): Promise<QuickNoteDto>;
  delete(id: string): Promise<void>;
}

export interface TrashService {
  list(): Promise<TrashItemDto[]>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  empty(): Promise<void>;
}

export interface AssetService {
  /** 上传图片资源（参数顺序：noteId → filename → bytes）。 */
  upload(noteId: string, filename: string, bytes: Uint8Array): Promise<UploadedAssetDto>;
  /** 下载远程图片资源（SSRF 防护在主进程传输层）。 */
  downloadRemote(url: string, noteId: string): Promise<UploadedAssetDto>;
}

export interface SyncService {
  syncNow(): Promise<SyncResultDto>;
  getStatus(): Promise<SyncStatusDto>;
  onProgress(callback: (phase: string, message: string) => void): () => void;
}

/** 五服务聚合（移动端页面入口）。 */
export interface AppServices {
  notes: NoteService;
  quickNotes: QuickNoteService;
  trash: TrashService;
  assets: AssetService;
  sync: SyncService;
}
