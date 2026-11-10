/**
 * 移动端日记告警环形缓冲（设备本地，261110 wave2）。
 *
 * 背景（HANDOFF §3「日记 v1 残余」④）：桌面 `electron/diaryStore.ts` 的告警走
 * `deps.log` → `logScopes.store.warn`（scope=store），落日志文件，用户在「设置 → 日志」能看到；
 * 移动端同一条告警此前只有 `console.warn`，只进 WebView console / Logcat（打包版没有终端）
 * ⇒ 用户与排障都拿不到。这里在 localStorage 存最近 50 条，由
 * 设置 → 关于 →「数据诊断 · 复制诊断信息」带出（**设备本地，不进 S3**）。
 *
 * 隐私边界：只收**固定 code**，消息一律由本文件的文案表重算 —— 不接收自由文本，
 * 正文/密钥在结构上就落不了盘（护栏见 diaryWarnLog.test.ts）。
 *
 * 边界：写失败（隐私模式/配额满）只走既有 localStorage 保护，绝不影响日记打开；
 * 读坏数据一律当空（不抛）。环上限/格式化口径与 `lib/crashLog.ts` 一致，复制诊断同一段文本。
 */
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { rlog } from "../../lib/log";

/** 告警类型：只增不改（旧版读到未知 code 一律当空，不抛）。 */
export type DiaryWarningCode = "multiple-notebooks";

/** code → 固定文案（**唯一来源**；与桌面 diaryStore.warnMultipleNotebooks 同一句话）。 */
export const DIARY_WARNING_TEXT: Record<DiaryWarningCode, string> = {
  "multiple-notebooks": "存在多个 space='diary' 的笔记本：取第一个为准（不自动修复）",
};

export interface DiaryWarningEntry {
  /** ISO 时间。 */
  at: string;
  code: DiaryWarningCode;
  message: string;
}

export const DIARY_WARN_LOG_KEY = "lakex-local-notes-mobile.diaryWarnings";
/** 环形缓冲上限：只留最近 50 条，避免把 localStorage 撑爆。 */
export const DIARY_WARN_LOG_MAX = 50;
const AT_MAX = 40;

const CODES = Object.keys(DIARY_WARNING_TEXT) as DiaryWarningCode[];

/** code 是否在固定文案表里（坏数据/未来 code 的收敛判据）。 */
export function isDiaryWarningCode(value: unknown): value is DiaryWarningCode {
  return typeof value === "string" && (CODES as string[]).includes(value);
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + "…" : value;
}

/**
 * 校验/归一一条记录：**只认 code**，message 一律按文案表重算
 * （伪造/遗留的自由文本被丢弃 ⇒ 正文/Key 不可能借 message 落盘）。
 */
export function normalizeDiaryWarning(raw: unknown): DiaryWarningEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<DiaryWarningEntry>;
  if (typeof value.at !== "string" || !value.at || !isDiaryWarningCode(value.code)) return null;
  return { at: clip(value.at, AT_MAX), code: value.code, message: DIARY_WARNING_TEXT[value.code] };
}

/** 解析 localStorage 原文：坏 JSON / 非数组 / 坏元素 ⇒ 空数组（逐条过滤，不抛）。 */
export function parseDiaryWarnings(raw: string | null): DiaryWarningEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeDiaryWarning).filter((entry): entry is DiaryWarningEntry => entry !== null);
}

/** 追加（保留最近 max 条，新的在后）。纯函数，便于单测。 */
export function appendDiaryWarning(list: readonly DiaryWarningEntry[], entry: DiaryWarningEntry, max = DIARY_WARN_LOG_MAX): DiaryWarningEntry[] {
  const next = [...list, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 读最近 N 条（默认全部）。 */
export function readDiaryWarnings(limit = DIARY_WARN_LOG_MAX): DiaryWarningEntry[] {
  try {
    const all = parseDiaryWarnings(localStorage.getItem(DIARY_WARN_LOG_KEY));
    return limit >= all.length ? all : all.slice(all.length - limit);
  } catch {
    return [];
  }
}

/** 记一条日记告警：落本地环形缓冲 + warn 日志（正式环境也输出，现场仍可连 Logcat 抓）。 */
export function reportDiaryWarning(code: DiaryWarningCode, at = new Date().toISOString()): DiaryWarningEntry {
  const atIso = at || new Date().toISOString();
  const entry = normalizeDiaryWarning({ at: atIso, code })!;
  writeLocalStorage(DIARY_WARN_LOG_KEY, JSON.stringify(appendDiaryWarning(readDiaryWarnings(), entry)));
  rlog.warn("diary", entry.message);
  return entry;
}

/** 清空（测试/将来设置页「清除诊断记录」用）。 */
export function clearDiaryWarnings(): void {
  try { localStorage.removeItem(DIARY_WARN_LOG_KEY); } catch { /* 存储不可用：等同已清空 */ }
}

/** 拼成人读文本（复制诊断用；格式与 crashLog.formatCrashEntries 一致）。 */
export function formatDiaryWarnings(entries: readonly DiaryWarningEntry[]): string[] {
  return entries.map((entry) => "[" + entry.at + "][diary:" + entry.code + "] " + entry.message);
}
