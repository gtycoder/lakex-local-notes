/**
 * 表格「本机视图」记忆（用户 261006）：**当前工作表**与**缩放**。
 *
 * 口径与画板视口（boardViewStore）一致：只改展示、且与设备/窗口相关 ⇒ 落 localStorage（L3 纯本机 UI 状态），
 * **不进正文、不进 S3**。此前这两项写在 sheet 正文里（`status` / `zoomRatio`），导致「切工作表 / 改缩放」
 * 也会保存正文 → 下次同步上传（用户 261006 审计：只改展示的操作不得触发 S3）。
 *
 * 默认缩放仍是 1.1（新建 / 没记忆时，见 SheetEditor 的 DEFAULT_SHEET_ZOOM）；多表时按 sheet id 各记各的缩放。
 */
export interface SheetView {
  /** 上次停留的工作表 id（无 = 用正文/默认第一张）。 */
  activeSheetId: string | null;
  /** 工作表 id → 缩放比。 */
  zooms: Record<string, number>;
}

const KEY = "lake-notes-v3.sheet-views";
/** 上限纯属兜底（正常远小于标签上限），避免长开窗口无界增长；超出按最近使用淘汰。 */
const LIMIT = 200;

interface StoredSheetView extends SheetView {
  /** 最近一次写入时间：仅用于 LRU 淘汰。 */
  at: number;
}
type StoredMap = Record<string, StoredSheetView>;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // 隐私模式/被禁用时忽略：视图记不住而已，不影响表格本身
    return null;
  }
}

function readAll(): StoredMap {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: StoredMap): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(map));
  } catch {
    // 配额/被禁用：忽略（视图记不住不是功能故障）
  }
}

/** 取某文档记下的视图（没有 = 默认）。同步读取：宿主要在**首帧之前**拿它决定初始缩放与活动工作表。 */
export function readSheetView(noteId: string): SheetView {
  const found = readAll()[noteId];
  return { activeSheetId: found?.activeSheetId ?? null, zooms: { ...(found?.zooms ?? {}) } };
}

/** 记下某文档的视图（按字段合并：切表只更新 activeSheetId，缩放只更新对应 sheet 的 zooms）。 */
export function writeSheetView(noteId: string, patch: { activeSheetId?: string; zooms?: Record<string, number> }): void {
  const all = readAll();
  const prev = all[noteId];
  const activeSheetId = patch.activeSheetId ?? prev?.activeSheetId ?? null;
  const zooms = { ...(prev?.zooms ?? {}), ...(patch.zooms ?? {}) };
  all[noteId] = { activeSheetId, zooms, at: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > LIMIT) {
    keys
      .sort((a, b) => (all[a]?.at ?? 0) - (all[b]?.at ?? 0))
      .slice(0, keys.length - LIMIT)
      .forEach((stale) => { delete all[stale]; });
  }
  writeAll(all);
}

/** 仅测试用：清空本机记忆。 */
export function resetSheetViews(): void {
  storage()?.removeItem(KEY);
}
