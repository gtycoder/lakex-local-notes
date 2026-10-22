/**
 * 移动端「常用」文档（知识库页顶部固定分组）——**只存设备本地**：
 * 仅 localStorage（不同步、不进 S3、不写正文、桌面端零改动）。
 * 判据：AGENTS「编辑器本机视图 = 设备本地」与用户 261019 点单「仅手机端、不需要同步」。
 *
 * 顺序 = 用户加入顺序（追加）；渲染侧只展示仍存在于库里的文档。
 */
import { writeLocalStorage } from "../../lib/localStorageSafe";

const KEY = "local-lakex-notes-mobile.favorites";
const OPEN_KEY = "local-lakex-notes-mobile.favoritesOpen";
const EVENT = "local-lakex-notes-mobile.favorites-change";

/** 读取常用文档 id（去重、只保留非空字符串；坏值静默回落空表）。 */
export function readFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((x): x is string => typeof x === "string" && x.length > 0))];
  } catch {
    return [];
  }
}

export function isFavorite(id: string): boolean {
  return readFavoriteIds().includes(id);
}

/** 切换常用；返回切换后的状态（true = 现在是常用）。 */
export function toggleFavorite(id: string): boolean {
  const cur = readFavoriteIds();
  const has = cur.includes(id);
  const next = has ? cur.filter((x) => x !== id) : [...cur, id];
  writeLocalStorage(KEY, JSON.stringify(next));
  emitChange();
  return !has;
}

/** 「常用」分组展开/收起（设备本地偏好；默认展开）。 */
export function readFavoritesOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeFavoritesOpen(open: boolean): void {
  writeLocalStorage(OPEN_KEY, open ? "1" : "0");
}

/** 订阅常用变化（工作区里切换、首页同步刷新；同端内存事件，不触网）。 */
export function subscribeFavorites(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const handler = (): void => cb();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

function emitChange(): void {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(EVENT));
  }
}
