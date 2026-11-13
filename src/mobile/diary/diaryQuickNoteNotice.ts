/**
 * 日记「转为小记」的提示文案（移动端，261113 task-106）。
 *
 * 桌面同源实现 = src/features/diary/diaryQuickNote.ts（渲染层独立：移动端不 import 桌面 features）。
 * 字段/文案必须与桌面逐字一致（测试卡住 base 文案与 droppedKinds 拼接；
 * 桌面那份由 electron/diaryQuickNoteConversion 测试覆盖——两处改动需同步）。
 */

/** 卡片类型 → 中文名（未列出的原样展示，宁可露出内部名也不要吞掉）。 */
const CARD_KIND_LABELS: Record<string, string> = {
  board: "画板",
  customBlock: "自定义块",
  toc: "大纲",
  materialLibrary: "素材库",
};

/** 完成提示：基础文案 + 未搬运类型明说（去重、保持出现顺序）。 */
export function diaryToQuickNoteNotice(droppedKinds: readonly string[]): string {
  const base = "已转为小记（含图片/附件）；日记已移入回收站，可恢复";
  const kinds = [...new Set(droppedKinds)].filter(Boolean);
  if (kinds.length === 0) return base;
  const labels = kinds.map((kind) => CARD_KIND_LABELS[kind] ?? kind);
  return base + "；" + labels.join("、") + "未搬运（日记原稿仍在回收站，可恢复）";
}
