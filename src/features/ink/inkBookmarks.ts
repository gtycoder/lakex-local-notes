/**
 * 手写板书签 = **设备本地视图**（261104 十八批）。
 *
 * 与「当前页」(inkNav)、usheet 当前工作表、bitable 导航同口径（AGENTS §4）：
 * 本机视图**不进正文、不标脏、不进 S3**；换设备不同步，删掉也不影响正文。
 * 为什么不做成正文数据：书签是"我这台设备怎么翻这本 300 页的书"，不是文档内容；
 * 做成正文会让每次加书签 = 一次正文改写 + 一次整篇上传。
 *
 * 容量：单篇最多 MAX_BOOKMARKS 条（localStorage 有 5MB 级配额，且书签是低频操作）。
 * 读不到/坏值一律回退空列表（绝不因书签影响打开文档）。
 */
export interface InkBookmark {
  /** 页 id（与正文 pages[].id 对应；页被删掉时这条自然失效，读的时候过滤）。 */
  pageId: string;
  /** 可选备注（默认空 = 显示页码）。 */
  label?: string;
  /** 打书签的时间（ISO 字符串；用于稳定排序与展示）。 */
  at: string;
}

export const INK_BOOKMARK_KEY_PREFIX = "lakex-local-notes-v3.ink-bookmarks.";
/** 单篇上限：超出后新书签不再写入（静默失败比抛错合适：这是纯视图数据）。 */
export const MAX_INK_BOOKMARKS = 200;

export function inkBookmarkKey(noteId: string): string {
  return INK_BOOKMARK_KEY_PREFIX + noteId;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function normalize(raw: unknown): InkBookmark[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: InkBookmark[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const pageId = typeof record.pageId === "string" ? record.pageId.trim() : "";
    if (!pageId || seen.has(pageId)) continue;
    seen.add(pageId);
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined;
    const at = typeof record.at === "string" && record.at.trim() ? record.at : new Date(0).toISOString();
    out.push(label ? { pageId, label, at } : { pageId, at });
    if (out.length >= MAX_INK_BOOKMARKS) break;
  }
  return out;
}

/** 读设备本地书签（无记录/坏值 = 空数组）。 */
export function readInkBookmarks(noteId: string | null | undefined): InkBookmark[] {
  if (!noteId) return [];
  try {
    const value = storage()?.getItem(inkBookmarkKey(noteId));
    return value ? normalize(JSON.parse(value)) : [];
  } catch {
    return [];
  }
}

function writeInkBookmarks(noteId: string, bookmarks: InkBookmark[]): InkBookmark[] {
  try {
    storage()?.setItem(inkBookmarkKey(noteId), JSON.stringify(bookmarks));
  } catch { /* 隐私模式/配额：书签丢了不影响正文 */ }
  return bookmarks;
}

/** 加/取消书签（同页切换）；返回写入后的完整列表。 */
export function toggleInkBookmark(noteId: string | null | undefined, pageId: string | null | undefined): InkBookmark[] {
  if (!noteId || !pageId) return noteId ? readInkBookmarks(noteId) : [];
  const current = readInkBookmarks(noteId);
  const exists = current.some((item) => item.pageId === pageId);
  if (exists) return writeInkBookmarks(noteId, current.filter((item) => item.pageId !== pageId));
  if (current.length >= MAX_INK_BOOKMARKS) return current;
  return writeInkBookmarks(noteId, [...current, { pageId, at: new Date().toISOString() }]);
}

/** 删掉某页的书签（页被删除时顺手清理）。 */
export function removeInkBookmark(noteId: string | null | undefined, pageId: string | null | undefined): InkBookmark[] {
  if (!noteId || !pageId) return noteId ? readInkBookmarks(noteId) : [];
  const current = readInkBookmarks(noteId);
  if (!current.some((item) => item.pageId === pageId)) return current;
  return writeInkBookmarks(noteId, current.filter((item) => item.pageId !== pageId));
}

/** 清空（测试/退出清理用）。 */
export function clearInkBookmarks(noteId: string | null | undefined): void {
  if (!noteId) return;
  try {
    storage()?.removeItem(inkBookmarkKey(noteId));
  } catch { /* 同上 */ }
}

export function isBookmarked(bookmarks: readonly InkBookmark[], pageId: string): boolean {
  return bookmarks.some((item) => item.pageId === pageId);
}
