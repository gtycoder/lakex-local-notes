/**
 * 最近搜索（设备本地视图，261105）。
 *
 * 存的是**真正执行过**的查询（回车 / 点结果 / 点最近项），不是输入过程中的每个中间态；
 * 落 localStorage（前缀沿用移动端 lakex-local-notes-mobile.*），隐私模式/配额满时静默失败，
 * 绝不因为历史存不下而阻断搜索。
 */
import { writeLocalStorage } from "../../lib/localStorageSafe";

export const RECENT_SEARCHES_KEY = "lakex-local-notes-mobile.recentSearches";
/** 最多保留 8 条（412px 宽下两行 chip 放得下，再多就要滚动，失去"一眼可见"的意义）。 */
export const MAX_RECENT_SEARCHES = 8;

function storageOrNull(): Storage | null {
  try {
    // 隐私模式下访问 localStorage 本身就可能抛（Safari 旧版）；测试环境可能没有它。
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 解析存储值：只收字符串数组，逐条 trim/去空、大小写不敏感去重（保留最新写法）、限长。 */
export function parseRecentSearches(raw: string | null, max = MAX_RECENT_SEARCHES): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= Math.max(1, max)) break;
  }
  return out;
}

/** 把一条查询插到最前（去空、去重、限长）；空查询原样返回（不产生空历史）。 */
export function pushRecentSearch(current: readonly string[], query: string, max = MAX_RECENT_SEARCHES): string[] {
  const value = query.trim();
  if (!value) return [...current];
  const key = value.toLocaleLowerCase();
  const rest = current.filter((item) => item.toLocaleLowerCase() !== key);
  return [value, ...rest].slice(0, Math.max(1, max));
}

export function readRecentSearches(): string[] {
  const storage = storageOrNull();
  if (!storage) return [];
  try { return parseRecentSearches(storage.getItem(RECENT_SEARCHES_KEY)); } catch { return []; }
}

/** 记录一条并返回新列表（写失败只丢历史，不影响本次搜索）。 */
export function recordRecentSearch(query: string): string[] {
  const next = pushRecentSearch(readRecentSearches(), query);
  if (next.length > 0) writeLocalStorage(RECENT_SEARCHES_KEY, JSON.stringify(next));
  return next;
}

/** 清空最近搜索（只删本机这一项，不碰其它偏好）。 */
export function clearRecentSearches(): void {
  const storage = storageOrNull();
  if (!storage) return;
  try { storage.removeItem(RECENT_SEARCHES_KEY); } catch { /* 存储不可用：本来也读不到 */ }
}
