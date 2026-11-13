/**
 * 日记「转为小记」的**提示文案**（261112 task-92 起）。
 *
 * 真正的转换在主进程（electron/diaryQuickNoteConversion.ts：正文原样承载 + 媒体搬到小记作用域 + 原文软删）；
 * 渲染层只负责把 `droppedKinds` 变成人话，**不静默丢内容**。
 */

/** 卡片类型 → 中文名（未列出的原样展示，宁可露出内部名也不要吞掉）。 */
const CARD_KIND_LABELS: Record<string, string> = {
  board: "画板",
  customBlock: "自定义块",
  toc: "大纲",
  materialLibrary: "素材库",
};

/** 日记→小记完成提示：按**实际搬运**说媒体 + 未搬运类型明说（去重、保持出现顺序）。 */
export function diaryToQuickNoteNotice(result: { droppedKinds: readonly string[]; carriedMediaCount: number }): string {
  // 本篇没有媒体就别说「含图片/附件」（task-105 P3-8：文案与事实一致）。
  const base = (result.carriedMediaCount > 0 ? "已转为小记（含图片/附件）" : "已转为小记") + "；日记已移入回收站，可恢复";
  const kinds = [...new Set(result.droppedKinds)].filter(Boolean);
  if (kinds.length === 0) return base;
  const labels = kinds.map((kind) => CARD_KIND_LABELS[kind] ?? kind);
  return base + "；" + labels.join("、") + "未搬运（日记原稿仍在回收站，可恢复）";
}
