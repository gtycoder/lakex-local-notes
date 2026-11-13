/**
 * 「退出前必须拦下」的脏标签判据（261114 用户裁决）。
 *
 * beforeunload 的唯一目的 = 给**还能保存**的脏内容一次落盘机会。三类标签不构成拦截理由：
 *  - 已进回收站 / 已被他端 purge（deleted）：保存会被主进程守卫拒，永远写不进去；
 *  - 保存已被拒绝（saveStates = "error"）：本次保存已经失败，用户明确被告知「没存进去」，允许丢弃；
 *  - 不脏：无需保存。
 * 旧实现只要 tab.dirty 就 preventDefault ⇒ 一个永远存不进去的标签会把 ⌘Q / 关窗 / 关机永久拦住
 * （261114 用户现场：清空回收站后无法退出，窗口被判 unresponsive）。
 */
export interface UnloadTabLike {
  noteId: string;
  dirty: boolean;
  deleted?: boolean;
}

/** 返回仍应阻止退出的脏标签（= 还能保存的）。 */
export function blockingDirtyTabs<T extends UnloadTabLike>(
  tabs: readonly T[],
  isSaveFailed: (noteId: string) => boolean,
): T[] {
  return tabs.filter((tab) => tab.dirty && tab.deleted !== true && !isSaveFailed(tab.noteId));
}
