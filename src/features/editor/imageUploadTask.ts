/**
 * 可恢复的图片上传任务（261114）。
 *
 * 内核 image 插件支持 `createUploadTask` 扩展点：解析 HTML 时同步拿到任务对象，把 `task.id`
 * 写进卡片（落盘后仍保留），随后由内核 uploadManager 调 `run()`。我们用自己的任务实现替代
 * `createUploadPromise`，好处：
 * 1. **taskId 在任务创建时即确定** ⇒ 可以把「taskId → 原 URL / 资产结果」写进
 *    uploadJournal，卡片与上传任务之间有了持久、精确的对应关系（不靠尺寸/顺序猜）；
 * 2. 上传 Promise 归我们所有：编辑器实例被销毁后任务继续跑完并写日志，不会像内核
 *    uploadManager 的 task 一样随实例消失；
 * 3. 任务完成/失败写回日志，EditorTab 打开文档时把结果回填到对应卡片（见 uploadCardRepair），
 *    因此「下载成功但卡片显示失败」不会再成为永久状态，失败也带真实原因。
 *
 * 任务对象必须满足内核 WY 约定：`id` / `run()` / `getStatus()` / `on(event, cb)` /
 * `destroy()`（manager 在完成后 10s 调用）/ `getResourceURL()` / `abort()`。
 */
import type { ResourceUploadOutput } from "../../lib/types";
import {
  getUploadEntry,
  recordUploadDone,
  recordUploadError,
  recordUploadPending,
  type UploadJournalType,
} from "./uploadJournal";

export type UploadTaskStatus = "pending" | "running" | "success" | "error" | "aborted";
export type ImageUploadPerform = (request: { type: UploadJournalType; data: unknown }) => Promise<ResourceUploadOutput>;

export interface ImageUploadTaskOptions {
  taskId: string;
  noteId: string;
  type: UploadJournalType;
  data: unknown;
  perform: ImageUploadPerform;
  /** 是否写持久日志（仅文档编辑器的 URL 上传；小记 staging/导入临时内核为 false）。 */
  journal?: boolean;
  /** 上传成功后的旁路回调（图片缩略放行等）。 */
  onOutput?: (output: ResourceUploadOutput) => void;
}

type Listener = (payload?: unknown) => void;

const activeTasks = new Map<string, ImageUploadTask>();
const MAX_ACTIVE_TASKS = 400;

function newTaskId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoObject?.randomUUID === "function") return "u" + cryptoObject.randomUUID();
  return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export class ImageUploadTask {
  readonly id: string;
  private readonly noteId: string;
  private readonly type: UploadJournalType;
  private readonly data: unknown;
  private readonly perform: ImageUploadPerform;
  private readonly journalEnabled: boolean;
  private readonly onOutput?: (output: ResourceUploadOutput) => void;
  private statusValue: UploadTaskStatus = "pending";
  private result: ResourceUploadOutput | null = null;
  private failure: Error | null = null;
  private job: Promise<ResourceUploadOutput | { error: Error }> | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private objectUrl: string | null = null;

  constructor(options: ImageUploadTaskOptions) {
    this.id = options.taskId;
    this.noteId = options.noteId;
    this.type = options.type;
    this.data = options.data;
    this.perform = options.perform;
    this.onOutput = options.onOutput;
    this.journalEnabled = options.journal === true && options.type === "url" && typeof options.data === "string";
    if (this.journalEnabled) {
      recordUploadPending({
        taskId: this.id,
        noteId: this.noteId,
        type: this.type,
        url: typeof this.data === "string" ? this.data : undefined,
      });
    }
    activeTasks.set(this.id, this);
    if (activeTasks.size > MAX_ACTIVE_TASKS) {
      for (const [id, task] of activeTasks) {
        if (activeTasks.size <= MAX_ACTIVE_TASKS) break;
        if (task.isTerminal()) activeTasks.delete(id);
      }
    }
  }

  getStatus(): UploadTaskStatus {
    return this.statusValue;
  }

  // 内核卡片 UI/管理器还会调这些 WY 同款判据（缺一个就在 render 里抛 TypeError）。
  isPending(): boolean { return this.statusValue === "pending"; }
  isRunning(): boolean { return this.statusValue === "running"; }
  isSuccess(): boolean { return this.statusValue === "success"; }
  isError(): boolean { return this.statusValue === "error"; }
  isAborted(): boolean { return this.statusValue === "aborted"; }
  isTimeout(): boolean { return false; }
  isCompleted(): boolean { return this.isTerminal(); }

  isTerminal(): boolean {
    return this.statusValue === "success" || this.statusValue === "error" || this.statusValue === "aborted";
  }

  getResourceURL(): string {
    if (this.type === "url" && typeof this.data === "string") return this.data;
    if (this.type === "file" && this.data && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      this.objectUrl ??= URL.createObjectURL(this.data as Blob);
      return this.objectUrl ?? "";
    }
    return "";
  }

  /** 内核 manager 入口；重复调用（新编辑器把同一任务重新加进 manager）不会重复下载。 */
  run(): Promise<ResourceUploadOutput | { error: Error }> {
    if (this.statusValue === "success" && this.result) return Promise.resolve(this.result);
    if (this.statusValue === "error") return Promise.resolve({ error: this.failure ?? new Error("图片下载失败") });
    if (this.job) return this.job;

    this.statusValue = "running";
    this.emit("start");
    this.job = this.perform({ type: this.type, data: this.data }).then(
      (output) => {
        this.result = output;
        this.statusValue = "success";
        if (this.journalEnabled) {
          recordUploadDone(this.id, {
            url: output.url,
            filename: output.filename,
            size: output.size,
            mimeType: output.mimeType,
          });
        }
        try { this.onOutput?.(output); } catch { /* 旁路钩子失败不影响上传结果 */ }
        this.emit("success", output);
        return output;
      },
      (reason: unknown) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        this.failure = error;
        this.statusValue = "error";
        if (this.journalEnabled) recordUploadError(this.id, error.message || "图片下载失败");
        this.emit("error", error);
        // 与内核 ef6 任务同语义：错误通过 status/event 表达，run() 不 reject（否则 manager 静默卡住）。
        return { error };
      },
    );
    return this.job;
  }

  on(event: string, listener: Listener): this {
    if (event === "success" && this.statusValue === "success" && this.result) {
      const output = this.result;
      queueMicrotask(() => listener(output));
      return this;
    }
    if (event === "error" && this.statusValue === "error" && this.failure) {
      const error = this.failure;
      queueMicrotask(() => listener(error));
      return this;
    }
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  private emit(event: string, payload?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try { listener(payload); } catch { /* 单个监听器异常不影响任务状态 */ }
    }
  }

  destroy(): void {
    this.listeners.clear();
    if (this.objectUrl) {
      try { URL.revokeObjectURL(this.objectUrl); } catch { /* ignore */ }
      this.objectUrl = null;
    }
  }

  abort(): void {
    if (this.isTerminal()) return;
    this.statusValue = "aborted";
    this.emit("aborted");
  }
}

/** 创建图片上传任务（内核 image 插件的 createUploadTask 扩展点调用）。 */
export function createImageUploadTask(options: Omit<ImageUploadTaskOptions, "taskId"> & { taskId?: string }): ImageUploadTask {
  const taskId = options.taskId ?? newTaskId();
  const existing = activeTasks.get(taskId);
  if (existing) return existing;
  return new ImageUploadTask({ ...options, taskId });
}

export function getActiveImageUploadTask(taskId: string): ImageUploadTask | undefined {
  return activeTasks.get(taskId);
}

/**
 * 重启后恢复：对日志里仍是 pending、且当前没有活任务的 URL 上传重新下载一次。
 * 结果（成功/失败）写回日志；EditorTab 的日志订阅会据此触发一次正文回填。
 */
export function resumePendingImageUploads(
  noteId: string,
  perform: ImageUploadPerform,
  entries: Array<{ taskId: string; url?: string; type: UploadJournalType; status: string }>,
): ImageUploadTask[] {
  const resumed: ImageUploadTask[] = [];
  for (const entry of entries) {
    if (entry.status !== "pending" || entry.type !== "url" || !entry.url) continue;
    const active = activeTasks.get(entry.taskId);
    if (active && !active.isTerminal()) continue;
    const task = createImageUploadTask({
      taskId: entry.taskId,
      noteId,
      type: "url",
      data: entry.url,
      perform,
      journal: true,
    });
    void task.run();
    resumed.push(task);
  }
  return resumed;
}

/** 测试专用：清空活任务表（避免测试之间串状态）。 */
export function __resetImageUploadTasksForTests(): void {
  for (const task of activeTasks.values()) task.destroy();
  activeTasks.clear();
}

/** 仅日志读取入口，供 EditorTab 决定是否恢复。 */
export function journalEntryForTask(taskId: string) {
  return getUploadEntry(taskId);
}
