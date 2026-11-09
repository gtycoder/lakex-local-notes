/**
 * `diary_open_date` 的**渲染层端口**（契约见 docs/DIARY.md §IPC 契约）。
 *
 * 归属：IPC 三处（`electron/main.ts` handle + `preload.cjs` invoke + `src/lib/native.ts` 类型）
 * 由存储/片A 实现，本文件**不碰**它们 —— 只按契约读 `window.lakeNative.diaryOpenDate`：
 * - 缺失 ⇒ 明确回 `ipc-missing`（UI 要出声，不静默）；
 * - 存在 ⇒ 直接透传并校验返回形状（主进程重新 plan，渲染层不传 nodeId、不信本地树）。
 *
 * 为什么不在渲染层自己建文档：ensure（笔记本 → 年组 → 月组 → 文档）必须在主进程**单事务**里做
 * （连点只产生一篇，见 DIARY.md §IPC）。渲染层只负责"打开"这一个动作的两种结果。
 */
import { parseDiaryDateKey } from "../../core/diary";

/** 契约返回（docs/DIARY.md §IPC 契约，逐字段同义）。 */
export interface DiaryOpenDateResult {
  noteId: string;
  created: boolean;
  notebookId: string;
  duplicates: string[];
}

export type DiaryOpenOutcome =
  | { ok: true; result: DiaryOpenDateResult }
  | { ok: false; reason: "invalid-date" | "ipc-missing" | "failed"; message: string };

/** preload 侧命名按既有约定是 camelCase（`read_note` ⇒ `readNote`）；两个键都认，避免命名漂移。 */
interface DiaryOpenPort {
  diaryOpenDate?: (dateKey: string) => Promise<DiaryOpenDateResult>;
  diary_open_date?: (dateKey: string) => Promise<DiaryOpenDateResult>;
}

/** 取 IPC 端口；未接线返回 null（不抛错、不假装成功）。 */
export function diaryOpenDatePort(): ((dateKey: string) => Promise<DiaryOpenDateResult>) | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { lakeNative?: DiaryOpenPort }).lakeNative;
  const call = bridge?.diaryOpenDate ?? bridge?.diary_open_date;
  return typeof call === "function" ? call.bind(bridge) : null;
}

function assertResult(value: unknown): value is DiaryOpenDateResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<DiaryOpenDateResult>;
  return typeof result.noteId === "string" && result.noteId.length > 0
    && typeof result.notebookId === "string"
    && Array.isArray(result.duplicates);
}

export function diaryOpenErrorMessage(outcome: Extract<DiaryOpenOutcome, { ok: false }>): string {
  if (outcome.reason === "invalid-date") return outcome.message;
  if (outcome.reason === "ipc-missing") return "打开日记还差主进程接线（diary_open_date），本次没有新建文档";
  return outcome.message;
}

/** 幂等打开某一天：日期键非法直接拒绝（硬规则 3：不许猜日期）。 */
export async function requestDiaryOpenDate(dateKey: string): Promise<DiaryOpenOutcome> {
  const normalized = parseDiaryDateKey(dateKey);
  if (!normalized) {
    return { ok: false, reason: "invalid-date", message: "日期格式无效：日记只认 YYYY-MM-DD，且必须是真实存在的本地日期" };
  }
  const call = diaryOpenDatePort();
  if (!call) return { ok: false, reason: "ipc-missing", message: "diary_open_date 未接线" };
  try {
    const result = await call(normalized);
    if (!assertResult(result)) return { ok: false, reason: "failed", message: "主进程返回的日记结果格式不对（缺 noteId）" };
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "failed", message: `打开日记失败：${message}` };
  }
}
