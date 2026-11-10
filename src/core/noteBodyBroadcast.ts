/**
 * 正文变更广播的**判据单一来源**（261110）。
 *
 * 场景：桌面窗口 / 浏览器端（同一工作区的两个客户端）都可能写同一篇正文。主进程在 save_note
 * 成功后广播 `note-body-changed { noteId, contentHash }`（**只带 id + hash，不带正文**），
 * 各客户端收到后自己判断要不要重读：
 * - 这篇没打开 ⇒ **不读盘**（用户说的"没打开的不用通知"，省资源）；
 * - 本地有未保存编辑（dirty）⇒ **不覆盖**（交给保存守卫冲突流程，用户选择）；
 * - 已经是最新（tab.baseHash === contentHash）⇒ 跳过（自己写入的回声）。
 */
export interface NoteBodyChangedDetail {
  noteId: string;
  /** 保存后的正文 sha256；老主进程可能不带 ⇒ 保守按"需要重读"处理。 */
  contentHash?: string;
  title?: string;
  updatedAt?: string;
}

/** 判断某 tab 是否需要因广播而重读正文（只读判据，零 IO，便于单测）。 */
export function shouldReloadOnNoteBodyChanged(
  tab: { noteId: string; dirty?: boolean; deleted?: boolean; baseHash?: string },
  detail: NoteBodyChangedDetail,
): boolean {
  if (tab.noteId !== detail.noteId) return false;
  if (tab.deleted) return false;
  if (tab.dirty) return false;
  if (detail.contentHash && tab.baseHash === detail.contentHash) return false;
  return true;
}
