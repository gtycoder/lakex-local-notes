/**
 * 日记「转为小记」的提示文案（移动端，261113 task-106；261113 改为移动语义）。
 *
 * 桌面同源实现 = src/features/diary/diaryQuickNote.ts（渲染层独立：移动端不 import 桌面 features）。
 * 字段/文案必须与桌面**逐字一致**（测试卡住 base 文案；两处改动需同步）。
 * 语义：同一份正文/资产移动到小记空间，**没有可恢复副本**（旧「复制 + 原文进回收站可恢复」已作废）；
 * 原文档历史快照被删除（小记没有历史快照）——有删除时在文案里明说。
 */

/** 完成提示：按**实际移动**说媒体 + 明确无副本不可恢复（+ 历史已删）。 */
export function diaryToQuickNoteNotice(result: { movedMediaCount: number; removedHistoryCount?: number }): string {
  const base = result.movedMediaCount > 0 ? "已转为小记（含图片/附件）" : "已转为小记";
  const history = (result.removedHistoryCount ?? 0) > 0 ? "（原文档历史快照已删除）" : "";
  return base + "；原日记已移出日记本，无副本、不可恢复" + history;
}
