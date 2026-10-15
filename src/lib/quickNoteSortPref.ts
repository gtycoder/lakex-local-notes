/**
 * 小记排序偏好的**本机读写**（两端共用）。
 *
 * 为什么单独一层：`src/core` 是纯逻辑层（**禁 DOM / electron / node**，见 `check:core`），
 * 而偏好读写要摸 `localStorage` ⇒ 语义（档位/比较器/迁移）留在 `core/quickNoteSort`，
 * 存储访问放这里，两端 import 同一份（桌面 `../lib/quickNoteSortPref`、移动 `../../lib/quickNoteSortPref`）。
 *
 * 分层（docs/STORAGE-LAYERS.md §5「L3 纯本机/派生层」）：**纯展示偏好，只存本机，不进 S3 / manifest**。
 */
import { writeLocalStorage } from "./localStorageSafe";
import { QUICK_NOTE_SORT_DEFAULT, QUICK_NOTE_SORT_KEY, normalizeQuickNoteSort, type QuickNoteSort } from "../core/quickNoteSort";

/** 读本机偏好（隐私模式/无存储 ⇒ 默认档）。 */
export function readQuickNoteSort(): QuickNoteSort {
  try {
    return normalizeQuickNoteSort(localStorage.getItem(QUICK_NOTE_SORT_KEY));
  } catch {
    return QUICK_NOTE_SORT_DEFAULT;
  }
}

/** 写本机偏好（走 localStorageSafe：配额满/隐私模式只 warn，不炸 UI）。 */
export function writeQuickNoteSort(value: QuickNoteSort): void {
  writeLocalStorage(QUICK_NOTE_SORT_KEY, value);
}
