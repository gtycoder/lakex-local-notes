/**
 * 移动端崩溃/异常环形缓冲（设备本地，261105）。
 *
 * 背景（261105 容错审计）：移动端原来**没有任何全局异常兜底**（桌面 src/main.tsx:18-23 有），
 * 未捕获异常/未处理 Promise 拒绝只进 DevTools/Logcat，用户与排障都拿不到信号。
 * 这里在 localStorage 存最近 20 条（不含正文/密钥），供：
 *  - 启动失败页 / 坏库页「复制诊断」带出；
 *  - dev 模式 `window.__lakeCrashLog()` 直接取；
 *  - 设置页「同步诊断」旁的复制入口（可选，走同一份）。
 *
 * 边界：写失败（隐私模式/配额满）只 warn，绝不影响交互；读坏数据一律当空（不抛）。
 */
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { rlog } from "../../lib/log";

export interface CrashLogEntry {
  /** ISO 时间。 */
  at: string;
  /** 来源：window / promise / boundary:<scope> / native。 */
  scope: string;
  message: string;
  stack?: string;
}

export const CRASH_LOG_KEY = "lakex-local-notes-mobile.crashLog";
/** 环形缓冲上限：只留最近 20 条，避免把 localStorage 撑爆。 */
export const CRASH_LOG_MAX = 20;
const MESSAGE_MAX = 500;
const STACK_MAX = 2000;

function clip(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** 校验/裁剪一条记录（坏字段直接丢掉，不抛）。 */
export function normalizeCrashEntry(raw: unknown): CrashLogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<CrashLogEntry>;
  if (typeof value.at !== "string" || typeof value.scope !== "string" || typeof value.message !== "string") return null;
  if (!value.at || !value.scope) return null;
  return {
    at: value.at,
    scope: clip(value.scope, 60),
    message: clip(value.message, MESSAGE_MAX),
    ...(typeof value.stack === "string" && value.stack ? { stack: clip(value.stack, STACK_MAX) } : {}),
  };
}

/** 解析 localStorage 原文：坏 JSON / 非数组 / 坏元素 ⇒ 空数组（逐条过滤）。 */
export function parseCrashLog(raw: string | null): CrashLogEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeCrashEntry).filter((entry): entry is CrashLogEntry => entry !== null);
}

/** 追加（保留最近 max 条，新的在后）。纯函数，便于单测。 */
export function appendCrashEntry(list: readonly CrashLogEntry[], entry: CrashLogEntry, max = CRASH_LOG_MAX): CrashLogEntry[] {
  const next = [...list, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 读最近 N 条（默认全部）。 */
export function readCrashLog(limit = CRASH_LOG_MAX): CrashLogEntry[] {
  try {
    const raw = localStorage.getItem(CRASH_LOG_KEY);
    const all = parseCrashLog(raw);
    return limit >= all.length ? all : all.slice(all.length - limit);
  } catch {
    return [];
  }
}

/** 记一条崩溃/异常：落 localStorage + error 日志（日志在正式环境也输出）。 */
export function reportCrash(entry: { scope: string; message: unknown; stack?: unknown; at?: string }): CrashLogEntry {
  const normalized = normalizeCrashEntry({
    at: entry.at ?? new Date().toISOString(),
    scope: entry.scope,
    message: entry.message instanceof Error ? entry.message.message : String(entry.message ?? "未知错误"),
    stack: entry.stack ?? (entry.message instanceof Error ? entry.message.stack : undefined),
  }) ?? { at: new Date().toISOString(), scope: "unknown", message: "无法归一的异常" };
  const next = appendCrashEntry(readCrashLog(), normalized);
  writeLocalStorage(CRASH_LOG_KEY, JSON.stringify(next));
  rlog.error("crash", "[" + normalized.scope + "] " + normalized.message + (normalized.stack ? "\n" + normalized.stack : ""));
  return normalized;
}

/** 清空（测试/设置页「清除诊断记录」用）。 */
export function clearCrashLog(): void {
  try { localStorage.removeItem(CRASH_LOG_KEY); } catch { /* 存储不可用：等同已清空 */ }
}

/** 拼成人读文本（复制诊断用）。 */
export function formatCrashEntries(entries: readonly CrashLogEntry[]): string[] {
  return entries.map((entry) => "[" + entry.at + "][" + entry.scope + "] " + entry.message + (entry.stack ? "\n" + entry.stack : ""));
}
