/**
 * 图片上传任务日志（261114，修「粘贴远程图下载成功但卡片永久显示失败」）。
 *
 * 背景（现场 261114，正式数据【IO】）：粘贴整篇网页时内核为每张远程图建一个上传任务，
 * 卡片先进入「上传中」（src 清空、只留 taskId/clientId，原 URL 被丢弃）。若编辑器实例在下载
 * 完成前被重建（关/重开标签、同步刷新、空间切换…），新实例会把这张卡当成「孤儿任务」，
 * 3 秒后判定 timeout ⇒ status=error / errorMessage="unknown error"，正文保存为失败卡；
 * 而主进程下载其实成功了，字节留在 note-assets 里成为孤立资源（用户看到「图片上传失败」，
 * 但附件目录里文件完好）。
 *
 * 修法：上传任务由我们自己实现（createUploadTask），taskId 在解析时就确定并落进卡片；
 * 任务结果（成功 → 资产 URL；失败 → 真实原因）写进本日志（localStorage，跨重启保留）。
 * 打开文档时按 taskId 把日志结果回填到正文卡片；编辑器重建/重启后也能自愈。
 *
 * 约束：
 * - 只给「文档编辑器」（EditorTab）用；小记写作卡/导入临时内核有各自的上传落盘目标，不走这里。
 * - 只存 URL / 资产元信息，不存图片字节；日志上限 200 条、7 天过期，读时惰性清理。
 * - localStorage 不可用（隐私模式/配额）时**静默降级**：本次会话仍能正常上传，只是不能跨重启自愈。
 */
import { writeLocalStorage } from "../../lib/localStorageSafe";

export type UploadJournalType = "url" | "file" | "base64";
export type UploadJournalStatus = "pending" | "done" | "error";

export interface UploadJournalOutput {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
}

export interface UploadJournalEntry {
  taskId: string;
  noteId: string;
  type: UploadJournalType;
  /** 仅 type=url：原始远程 URL（下载失败后可重试；日志不存字节，file/base64 无法跨重启恢复） */
  url?: string;
  createdAt: number;
  status: UploadJournalStatus;
  output?: UploadJournalOutput;
  error?: string;
}

const STORAGE_KEY = "lakex-local-notes.image-upload-journal.v1";
const MAX_ENTRIES = 200;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

let cache: UploadJournalEntry[] | null = null;
const listeners = new Set<(entry: UploadJournalEntry) => void>();

function isEntry(value: unknown): value is UploadJournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<UploadJournalEntry>;
  return typeof entry.taskId === "string"
    && typeof entry.noteId === "string"
    && typeof entry.createdAt === "number"
    && (entry.type === "url" || entry.type === "file" || entry.type === "base64")
    && (entry.status === "pending" || entry.status === "done" || entry.status === "error");
}

function prune(entries: UploadJournalEntry[], now = Date.now()): UploadJournalEntry[] {
  const fresh = entries.filter((entry) => now - entry.createdAt <= TTL_MS);
  fresh.sort((a, b) => b.createdAt - a.createdAt);
  return fresh.slice(0, MAX_ENTRIES);
}

function readStorage(): UploadJournalEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return prune(parsed.filter(isEntry));
  } catch {
    return [];
  }
}

function load(): UploadJournalEntry[] {
  cache ??= readStorage();
  return cache;
}

function persist(entries: UploadJournalEntry[]): void {
  cache = entries;
  writeLocalStorage(STORAGE_KEY, JSON.stringify(entries));
}

function upsert(entry: UploadJournalEntry): void {
  const entries = load().filter((item) => item.taskId !== entry.taskId);
  entries.push(entry);
  persist(prune(entries));
  for (const listener of [...listeners]) {
    try { listener(entry); } catch { /* 订阅方异常不影响上传主流程 */ }
  }
}

/** 记录「任务已创建、正在上传」（同步落盘：崩溃/重启后仍能按 taskId 找回原 URL）。 */
export function recordUploadPending(input: {
  taskId: string;
  noteId: string;
  type: UploadJournalType;
  url?: string;
  now?: number;
}): UploadJournalEntry {
  const entry: UploadJournalEntry = {
    taskId: input.taskId,
    noteId: input.noteId,
    type: input.type,
    createdAt: input.now ?? Date.now(),
    status: "pending",
    ...(input.type === "url" && input.url ? { url: input.url } : {}),
  };
  upsert(entry);
  return entry;
}

/** 记录上传成功（真实资产 URL / 文件名 / 大小；正文卡片按 taskId 回填这些字段）。 */
export function recordUploadDone(taskId: string, output: UploadJournalOutput): void {
  const current = getUploadEntry(taskId);
  if (!current) return;
  upsert({
    ...current,
    status: "done",
    output: { url: output.url, filename: output.filename, size: output.size, mimeType: output.mimeType },
    error: undefined,
  });
}

/** 记录上传失败（保留原 URL，供重开文档时重试；error 写真实原因，不再出现 unknown error）。 */
export function recordUploadError(taskId: string, error: string): void {
  const current = getUploadEntry(taskId);
  if (!current) return;
  upsert({ ...current, status: "error", error: error || "图片下载失败" });
}

export function getUploadEntry(taskId: string): UploadJournalEntry | undefined {
  return load().find((entry) => entry.taskId === taskId);
}

/** 仍未完成且时间窗内的任务（含可重试的失败项？不——失败项只用于把真实原因回填，不自动无限重试）。 */
export function pendingUploadsForNote(noteId: string): UploadJournalEntry[] {
  const now = Date.now();
  return load().filter((entry) => entry.noteId === noteId
    && entry.status === "pending"
    && entry.type === "url"
    && !!entry.url
    && now - entry.createdAt <= TTL_MS);
}

export function uploadsForNote(noteId: string): UploadJournalEntry[] {
  return load().filter((entry) => entry.noteId === noteId);
}

/** 订阅日志变更（返回退订函数）；用于上传晚到后触发对应编辑器自愈。 */
export function subscribeUploadJournal(listener: (entry: UploadJournalEntry) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 测试专用：清空内存缓存（localStorage 由测试自行清理）。 */
export function __resetUploadJournalCacheForTests(): void {
  cache = null;
}
