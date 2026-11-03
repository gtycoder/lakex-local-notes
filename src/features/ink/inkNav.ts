/**
 * 手写板「当前页」= **设备本地视图**（v3，261103 P6）。
 *
 * 放在 features/ink 而不是 core：要直接读写 localStorage，而 core 边界禁止 DOM 全局
 * （护栏 scripts/check-core-boundaries.mjs）；导航是纯视图，两端共用这一份实现。
 *
 * 与 usheet 当前工作表、bitable 导航同口径（AGENTS §4：本机视图不进正文、不标脏、不进 S3）：
 * 翻页只改这个 key，不产生 contentHash、不触发同步。
 *
 * 为什么 key 前缀是 `lakex-local-notes-v3.`：仓内设备本地键同族
 * （`…v3.bitable-nav.<noteId>` / `…mobile.tabs.*`）；退出清理按前缀整棵删除时天然覆盖。
 * 读不到（隐私模式/配额满/首开）⇒ 回退正文里 v1/v2 的旧 activePageId 或第一页，不影响打开。
 */
export const INK_NAV_KEY_PREFIX = "lakex-local-notes-v3.ink-nav.";

export function inkNavKey(noteId: string): string {
  return INK_NAV_KEY_PREFIX + noteId;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 读设备本地记录的手写板当前页（无记录/坏值返回 null）。 */
export function readInkNavPage(noteId: string | null | undefined): string | null {
  if (!noteId) return null;
  try {
    const value = storage()?.getItem(inkNavKey(noteId));
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** 写设备本地当前页（纯视图：写失败静默，绝不影响正文保存）。 */
export function writeInkNavPage(noteId: string | null | undefined, pageId: string | null | undefined): void {
  if (!noteId || !pageId) return;
  try {
    storage()?.setItem(inkNavKey(noteId), pageId);
  } catch { /* 隐私模式/配额：导航丢了不影响正文 */ }
}

export function clearInkNavPage(noteId: string | null | undefined): void {
  if (!noteId) return;
  try {
    storage()?.removeItem(inkNavKey(noteId));
  } catch { /* 同上 */ }
}
