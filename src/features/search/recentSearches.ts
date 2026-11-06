/**
 * 「最近搜索」= 纯设备本地视图（localStorage；不进设置、不进正文、不参与同步）。
 *
 * 口径：去空白/合并空格后入库；**去重**（不区分大小写，保留最新一次书写形式）；上限 8 条；可一键清空。
 * 读写全部 try/catch：隐私模式/配额满时退化成「本次会话可用、下次没了」，绝不影响搜索本身。
 */

export const RECENT_SEARCH_STORAGE_KEY = "lakex-local-notes-v3.recent-searches";
export const RECENT_SEARCH_LIMIT = 8;

export interface RecentSearchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): RecentSearchStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 归一化一次查询：trim + 合并连续空白 + 截断（防极端长串占满存储）。 */
export function normalizeRecentQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").slice(0, 120);
}

/**
 * 压入一条最近搜索：空查询忽略；同一条（不区分大小写）先去重再置顶；超过上限截断。
 * 纯函数 —— 不碰存储，便于单测与「只在提交时记录」的调用点复用。
 */
export function pushRecentSearch(list: readonly string[], query: string, limit = RECENT_SEARCH_LIMIT): string[] {
  const value = normalizeRecentQuery(query);
  if (!value) return [...list];
  const key = value.toLowerCase();
  const rest = list.map(normalizeRecentQuery).filter((item) => item && item.toLowerCase() !== key);
  return [value, ...rest].slice(0, Math.max(0, limit));
}

/** 解析存储值：只接受字符串数组；逐条归一化、去重（不区分大小写）、截断。坏数据一律当空。 */
export function parseRecentSearches(raw: unknown, limit = RECENT_SEARCH_LIMIT): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = normalizeRecentQuery(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

export function readRecentSearches(storage: RecentSearchStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_SEARCH_STORAGE_KEY);
    if (!raw) return [];
    return parseRecentSearches(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeRecentSearches(list: readonly string[], storage: RecentSearchStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(RECENT_SEARCH_STORAGE_KEY, JSON.stringify(parseRecentSearches(list)));
    return true;
  } catch {
    return false;
  }
}

export function clearRecentSearches(storage: RecentSearchStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(RECENT_SEARCH_STORAGE_KEY);
  } catch {
    /* 隐私模式/配额：清不掉也不影响本次会话（面板内存态已清空） */
  }
}
