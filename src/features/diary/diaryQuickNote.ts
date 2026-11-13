/**
 * 日记「转为小记」的**提示文案**（261112 task-92 起）。
 *
 * 真正的转换在主进程（electron/diaryQuickNoteConversion.ts：正文原样承载 + 媒体复制到小记作用域 + 原文软删）；
 * 261113 用户裁决 = 卡片零剥离 ⇒ `droppedKinds` 恒空，提示只剩「有没有媒体」这一层事实。
 */
export function diaryToQuickNoteNotice(result: { carriedMediaCount: number }): string {
  // 本篇没有媒体就别说「含图片/附件」（task-105 P3-8：文案与事实一致）。
  return (result.carriedMediaCount > 0 ? "已转为小记（含图片/附件）" : "已转为小记") + "；日记已移入回收站，可恢复";
}
