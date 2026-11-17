/**
 * 视频卡片布局桥（桌面/移动端共用）。
 *
 * - `__videoWidth`：正文可用宽度百分比（10–100，缺省 100；保留 1 位小数 —— 拖拽预览即最终几何，
 *   松手不跳变（261117 重构；旧整数值照常读写）。
 * - `__videoAlign`：left / center / right，缺省 left。
 * - 新插入视频在上传完成后归一为 `done`，并清掉 UploadObserver 中残留的已完成任务；
 *   否则卡片会持续处于 uploaded/upload-task 生命周期，宽度变化时视频层会明显闪烁。
 */

export const VIDEO_CARD_SELECTOR = 'ne-card[data-card-name="video"]';
export const VIDEO_WIDTH_PRESETS = [25, 50, 75, 100] as const;

export type VideoAlignment = "left" | "center" | "right";
export interface VideoLayout { widthPercent: number; alignment: VideoAlignment; }
export const DEFAULT_VIDEO_LAYOUT: VideoLayout = { widthPercent: 100, alignment: "left" };

interface VideoCardData {
  getCardValue?: () => Record<string, unknown>;
  resetCardValue?: (value: Record<string, unknown>) => void;
  sync?: (force?: boolean) => unknown;
  getStatus?: () => string;
  getUrl?: () => string;
  getTaskId?: () => string;
  setStatus?: (status: string) => void;
}
interface VideoCardRef { _virtualNode?: { _instance?: unknown }; _instance?: unknown; }
interface UploadTaskThread { _taskIds?: string[]; _runningTasks?: unknown[] | Set<unknown>; _pendingTasks?: unknown[] | Set<unknown>; }
interface UploadTaskManager { reset?: () => void; _thread?: UploadTaskThread; }
interface VideoCardInstance {
  cardData?: VideoCardData;
  _task?: unknown;
  _ui?: { _updateObserver?: { _taskManager?: UploadTaskManager } };
}

function videoCardData(cardEl: HTMLElement): VideoCardData | null {
  const ref = (cardEl as unknown as { _neRef?: VideoCardRef })._neRef;
  const inst = (ref?._virtualNode?._instance ?? ref?._instance) as { cardData?: VideoCardData; _cardData?: VideoCardData } | undefined;
  return inst?.cardData ?? inst?._cardData ?? null;
}
function videoCardInstance(cardEl: HTMLElement): VideoCardInstance | null {
  const ref = (cardEl as unknown as { _neRef?: VideoCardRef })._neRef;
  return (ref?._virtualNode?._instance ?? ref?._instance ?? null) as VideoCardInstance | null;
}
function collectionSize(value: unknown[] | Set<unknown> | undefined): number {
  if (Array.isArray(value)) return value.length;
  return value instanceof Set ? value.size : 0;
}

function taskThreadIsIdle(thread: UploadTaskThread | null | undefined): boolean {
  return collectionSize(thread?._runningTasks) === 0 && collectionSize(thread?._pendingTasks) === 0;
}

function taskThreadHasVideoTask(thread: UploadTaskThread | null | undefined, taskIds: Set<string>): boolean {
  return thread?._taskIds?.some((id) => taskIds.has(id)) === true;
}

/** 上传成功后把新卡对齐到“重开文档后”的 done + 无任务状态，避免残留上传观察链。 */
function finalizeUploadedVideoCards(host: HTMLElement): void {
  const instances = [...host.querySelectorAll<HTMLElement>(VIDEO_CARD_SELECTOR)]
    .map((cardEl) => videoCardInstance(cardEl))
    .filter((inst): inst is VideoCardInstance => inst !== null);
  const finalizedInstances = new Set<VideoCardInstance>();
  const videoTaskIds = new Set<string>();
  const managers = new Set<UploadTaskManager>();
  for (const inst of instances) {
    const cd = inst.cardData;
    if (!cd) continue;
    const status = cd?.getStatus?.();
    const hasUrl = Boolean(cd?.getUrl?.());
    const taskId = cd?.getTaskId?.();
    if (status !== "done" && !(status === "uploaded" && hasUrl)) continue;
    finalizedInstances.add(inst);
    if (typeof taskId === "string" && taskId) videoTaskIds.add(taskId);
    if (status === "uploaded") {
      cd.setStatus?.("done");
      cd.sync?.(false);
    }
    const manager = inst._ui?._updateObserver?._taskManager;
    if (manager) managers.add(manager);
  }
  if (finalizedInstances.size === 0) return;
  window.setTimeout(() => {
    // 上传线程正常结束时会先把自己置为 null；这时 manager 已无可清理内容，但卡实例上的
    // `_task` 仍可能残留。先按最终态清实例引用，再只在仍存活的空闲线程上归还 manager。
    for (const inst of finalizedInstances) {
      const thread = inst._ui?._updateObserver?._taskManager?._thread;
      if (taskThreadIsIdle(thread)) inst._task = null;
    }
    for (const manager of managers) {
      const thread = manager._thread;
      if (!taskThreadHasVideoTask(thread, videoTaskIds) || !taskThreadIsIdle(thread)) continue;
      manager.reset?.();
    }
  }, 0);
}

export function normalizeVideoWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_VIDEO_LAYOUT.widthPercent;
  return Math.min(100, Math.max(10, Math.round(value * 10) / 10));
}
export function normalizeVideoAlignment(value: unknown): VideoAlignment {
  return value === "center" || value === "right" || value === "left" ? value : DEFAULT_VIDEO_LAYOUT.alignment;
}
export function readVideoLayout(cardEl: HTMLElement): VideoLayout {
  let value: Record<string, unknown> = {};
  try { value = videoCardData(cardEl)?.getCardValue?.() ?? {}; } catch { /* 初始化窗口期回默认值 */ }
  return { widthPercent: normalizeVideoWidth(value.__videoWidth), alignment: normalizeVideoAlignment(value.__videoAlign) };
}

const layoutLocks = new WeakSet<HTMLElement>();

/**
 * 拖动锁：媒体缩放拖动期间禁止把持久化布局重新投影到这张卡上。
 * 无锁时 MutationObserver/contentchange 触发的 applyVideoLayout 会把旧宽度写回，
 * 拖动中整卡跳回原尺寸（261117 用户复核「剧烈闪烁/突变」的根因）。
 */
export function lockVideoLayout(cardEl: HTMLElement, locked: boolean): void {
  if (locked) layoutLocks.add(cardEl);
  else layoutLocks.delete(cardEl);
}
export function isVideoLayoutLocked(cardEl: HTMLElement): boolean {
  return layoutLocks.has(cardEl);
}

/** 把持久化布局投影为 DOM 百分比上限；拖拽手柄由 mediaCardResize 统一挂载。 */
export function applyVideoLayout(cardEl: HTMLElement, layout: VideoLayout): VideoLayout {
  const normalized: VideoLayout = {
    widthPercent: normalizeVideoWidth(layout.widthPercent),
    alignment: normalizeVideoAlignment(layout.alignment),
  };
  if (isVideoLayoutLocked(cardEl)) return readVideoLayout(cardEl);
  cardEl.setAttribute("data-video-width", String(normalized.widthPercent));
  cardEl.setAttribute("data-video-align", normalized.alignment);
  cardEl.style.setProperty("--lake-video-max-width", `${normalized.widthPercent}%`);
  return normalized;
}

/** 写回视频卡片布局；返回 false 表示卡片尚未完成内核实例化，调用方可稍后重试。 */
export function writeVideoLayout(cardEl: HTMLElement, patch: Partial<VideoLayout>): boolean {
  const cd = videoCardData(cardEl);
  if (!cd?.getCardValue || !cd.resetCardValue) return false;
  let current: Record<string, unknown>;
  try { current = cd.getCardValue(); } catch { return false; }
  const next = {
    ...current,
    __videoWidth: normalizeVideoWidth(patch.widthPercent ?? current.__videoWidth),
    __videoAlign: normalizeVideoAlignment(patch.alignment ?? current.__videoAlign),
  };
  try {
    cd.resetCardValue(next);
    const result = cd.sync?.(false);
    applyVideoLayout(cardEl, { widthPercent: next.__videoWidth as number, alignment: next.__videoAlign as VideoAlignment });
    return result !== false;
  } catch {
    return false;
  }
}

/** 布局投影 + 新插入视频上传结束后的生命周期归一。 */
export function mountVideoCardLayoutSync(
  host: HTMLElement,
  editor: { on?: (event: string, listener: () => void) => unknown; off?: (event: string, listener: () => void) => unknown },
  options: { interactive?: boolean } = {},
): () => void {
  const interactive = options.interactive !== false;
  let disposed = false;
  let timer: number | undefined;
  const scan = (): void => {
    timer = undefined;
    if (disposed) return;
    host.querySelectorAll<HTMLElement>(VIDEO_CARD_SELECTOR).forEach((cardEl) => applyVideoLayout(cardEl, readVideoLayout(cardEl)));
    if (interactive) finalizeUploadedVideoCards(host);
  };
  function schedule(): void {
    if (disposed || timer !== undefined) return;
    timer = window.setTimeout(scan, 0);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(host, { childList: true, subtree: true });
  try { editor.on?.("contentchange", schedule); } catch { /* 内核事件不可用时仍由 DOM 观察器兜底 */ }
  scan();
  return () => {
    disposed = true;
    observer.disconnect();
    if (timer !== undefined) window.clearTimeout(timer);
    try { editor.off?.("contentchange", schedule); } catch { /* 忽略销毁期异常 */ }
  };
}
