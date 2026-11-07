/**
 * 移动端「置顶」文档（知识库页顶部固定分组；原「常用」261107 改名，逻辑不变）——**只存设备本地**：
 * 仅 localStorage（不同步、不进 S3、不写正文、桌面端零改动）。
 * 判据：AGENTS「编辑器本机视图 = 设备本地」与用户 261019 点单「仅手机端、不需要同步」。
 *
 * 顺序 = 用户加入顺序（追加）；渲染侧只展示仍存在于库里的文档。不参与同步、桌面端完全独立。
 */
import { writeLocalStorage } from "../../lib/localStorageSafe";

const KEY = "lakex-local-notes-mobile.favorites";
const OPEN_KEY = "lakex-local-notes-mobile.favoritesOpen";
const EVENT = "lakex-local-notes-mobile.favorites-change";

/** 读取置顶文档 id（去重、只保留非空字符串；坏值静默回落空表）。 */
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

/** 切换置顶；返回切换后的状态（true = 现在已置顶）。 */
export function toggleFavorite(id: string): boolean {
  const cur = readFavoriteIds();
  const has = cur.includes(id);
  const next = has ? cur.filter((x) => x !== id) : [...cur, id];
  writeLocalStorage(KEY, JSON.stringify(next));
  emitChange();
  return !has;
}

/** 批量加入置顶（目录树多选）：保持原顺序、去重、忽略重复项；返回实际新增数量。 */
export function addFavorites(ids: readonly string[]): number {
  const cur = readFavoriteIds();
  const next = [...cur];
  let added = 0;
  for (const id of ids) {
    if (typeof id !== "string" || !id || next.includes(id)) continue;
    next.push(id);
    added += 1;
  }
  if (added > 0) {
    writeLocalStorage(KEY, JSON.stringify(next));
    emitChange();
  }
  return added;
}

/** 「置顶」分组展开/收起（设备本地偏好；默认展开）。 */
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

/** 订阅置顶变化（工作区里切换、首页同步刷新；同端内存事件，不触网）。 */
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