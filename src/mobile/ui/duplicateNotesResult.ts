/**
 * 「创建副本」结果 → 移动端可读文案（261107 收口到 core/duplicateNotesReport）。
 * 桌面/移动共用同一套 reason 文案与摘要算法；本文件只保留移动端调用所需的导出名。
 */
import type { DuplicateNotesResultShape } from "../../lib/types";
import { duplicateNotesNotice, duplicateReasonLabel, type DuplicateNotice } from "../../core/duplicateNotesReport";

export type { DuplicateNotice };
export { duplicateReasonLabel };
export { DUPLICATE_NOTES_REASON_LABELS as DUPLICATE_REASON_LABELS } from "../../core/duplicateNotes";

export function duplicateResultNotice(result: DuplicateNotesResultShape): DuplicateNotice {
  return duplicateNotesNotice(result);
}
