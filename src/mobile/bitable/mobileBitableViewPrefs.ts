/**
 * 移动端多维表「记录展示方式」偏好的设备本地存储（用户 261030 定：仅展示类配置一律本地）。
 *
 * 与 `bitableNavStore` 同一口径：**只写 localStorage、不进正文、不标脏、不进 S3**；
 * 换设备各记各的，云端数据与桌面视图配置都不受影响。
 * 存储形状 = 按 noteId 一份 map：{ [tableId]: { [viewId]: BitableRecordLayoutPrefs } }。
 */
import { normalizeRecordLayoutPrefs, type BitableRecordLayoutPrefs } from "../../core/bitableRecordLayout";
import { writeLocalStorage } from "../../lib/localStorageSafe";

export const MOBILE_BITABLE_LAYOUT_KEY_PREFIX = "lakex-local-notes-mobile.bitable-layout.";

type LayoutMap = Record<string, Record<string, BitableRecordLayoutPrefs>>;

function readMap(noteId: string): LayoutMap {
  try {
    const raw = localStorage.getItem(MOBILE_BITABLE_LAYOUT_KEY_PREFIX + noteId);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: LayoutMap = {};
    for (const [tableId, views] of Object.entries(parsed as Record<string, unknown>)) {
      if (!views || typeof views !== "object") continue;
      const perView: Record<string, BitableRecordLayoutPrefs> = {};
      for (const [viewId, prefs] of Object.entries(views as Record<string, unknown>)) {
        perView[viewId] = normalizeRecordLayoutPrefs(prefs);
      }
      out[tableId] = perView;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读某张表的某个视图的布局偏好；没存过/坏了都回落空对象（= 走 resolveRecordLayout 的缺省值）。 */
export function readBitableRecordLayout(noteId: string, tableId: string, viewId: string): BitableRecordLayoutPrefs {
  return readMap(noteId)[tableId]?.[viewId] ?? {};
}

/** 写布局偏好（空对象视为「恢复缺省」，直接把该视图的条目删掉，避免残留旧快照）。 */
export function writeBitableRecordLayout(noteId: string, tableId: string, viewId: string, prefs: BitableRecordLayoutPrefs): void {
  const map = readMap(noteId);
  const perView = { ...(map[tableId] ?? {}) };
  const normalized = normalizeRecordLayoutPrefs(prefs);
  if (Object.keys(normalized).length === 0) delete perView[viewId];
  else perView[viewId] = normalized;
  const next: LayoutMap = { ...map };
  if (Object.keys(perView).length === 0) delete next[tableId];
  else next[tableId] = perView;
  const key = MOBILE_BITABLE_LAYOUT_KEY_PREFIX + noteId;
  if (Object.keys(next).length === 0) {
    // 全部恢复缺省：删键（不留 "{}" 空壳，便于排查与清理）。
    try { localStorage.removeItem(key); } catch { /* 存储不可用：本来也没写进去 */ }
    return;
  }
  writeLocalStorage(key, JSON.stringify(next));
}
