/**
 * 批量打标的公共纯逻辑（261108）：两端共用，UI 各自实现。
 *
 * 边界：只做选择集合、标签名规范化、选项过滤；不碰 IPC/DB/样式。
 * 桌面 = 右键菜单 + BatchTagDialog；移动 = SelectionActionBar + BatchTagPickerSheet。
 */
import { normalizeQuickNoteTag } from "./quickNoteTags";

export function toggleBatchTagSelection(selected: readonly string[], tagId: string): string[] {
  return selected.includes(tagId) ? selected.filter((id) => id !== tagId) : [...selected, tagId];
}

/** 复用 quick-notes 标签目录的唯一命名规则；非法名抛错，由 UI 转成可见错误。 */
export function normalizeBatchTagName(raw: string): string {
  return normalizeQuickNoteTag(raw);
}

export function isValidBatchTagName(raw: string): boolean {
  try { normalizeQuickNoteTag(raw); return true; } catch { return false; }
}

/** 标签选择器/弹层的搜索过滤（大小写不敏感）。 */
export function filterBatchTagOptions<T extends { name: string }>(options: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? options.filter((option) => option.name.toLocaleLowerCase().includes(needle)) : [...options];
}
