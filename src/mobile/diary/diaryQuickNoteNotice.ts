/**
 * 日记「转为小记」的提示文案（移动端，261113 task-106）。
 *
 * 桌面同源实现 = src/features/diary/diaryQuickNote.ts（渲染层独立：移动端不 import 桌面 features）。
 * 261113 用户裁决 = 卡片零剥离 ⇒ `droppedKinds` 恒空，提示只剩基础文案（不再有「未搬运」分支）。
 */
export function diaryToQuickNoteNotice(): string {
  return "已转为小记（含图片/附件）；日记已移入回收站，可恢复";
}
