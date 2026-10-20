/** 小记列表的本地搜索（桌面列表视图 / 可复用）。
 *
 * 只查**已加载的轻量字段**（纯文本镜像 / 预览文本 / 标签），不读正文文件、不建索引；
 * 与「搜索单独立项」的全局 FTS 搜索是两件事（README 设计先决条件 §6）。
 */

export interface QuickNoteSearchable {
  previewText?: string;
  content?: {
    text?: string;
    tags?: readonly string[];
  };
}

export function normalizeQuickNoteQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function quickNoteMatchesQuery(note: QuickNoteSearchable, query: string): boolean {
  const needle = normalizeQuickNoteQuery(query);
  if (!needle) return true;
  const haystack = [note.previewText ?? "", note.content?.text ?? "", ...(note.content?.tags ?? [])]
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(needle);
}

export function filterQuickNotesByQuery<T extends QuickNoteSearchable>(notes: readonly T[], query: string): T[] {
  const needle = normalizeQuickNoteQuery(query);
  if (!needle) return [...notes];
  return notes.filter((note) => quickNoteMatchesQuery(note, needle));
}
