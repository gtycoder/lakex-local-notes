/**
 * 日记「转为小记」的**提示文案**（261112 task-92 起；261113 改为移动语义）。
 *
 * 真正的转换在主进程（electron/diaryQuickNoteConversion.ts：同一份正文/资产**移动**到小记空间 +
 * 作用域改写 + Lake 侧行/正文/历史移除）。渲染层只负责如实说明后果：
 * **没有可恢复副本**（原「复制 + 原稿进回收站可恢复」口径已作废），也不再有「未搬运的卡片类型」；
 * 原文档历史快照被删除（小记没有历史快照，迁移后也没有入口能读）——有删除时在文案里明说。
 */

/** 日记→小记完成提示：按**实际移动**说媒体 + 明确无副本不可恢复（+ 历史已删）。 */
export function diaryToQuickNoteNotice(result: { movedMediaCount: number; removedHistoryCount?: number }): string {
  // 本篇没有媒体就别说「含图片/附件」（文案与事实一致）。
  const base = result.movedMediaCount > 0 ? "已转为小记（含图片/附件）" : "已转为小记";
  const history = (result.removedHistoryCount ?? 0) > 0 ? "（原文档历史快照已删除）" : "";
  return base + "；原日记已移出日记本，无副本、不可恢复" + history;
}
