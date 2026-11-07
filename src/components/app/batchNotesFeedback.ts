/**
 * 批量操作的结果 → 用户可见文案（261107 收口到 core/batchNotesReport）。
 * 契约来源：src/core/batchNotes.ts 的 BatchNotesResult；本文件只保留桌面导出名。
 */
import type { BatchNotesActionShape, BatchNotesReasonShape, BatchNotesResultShape } from "../../lib/types";
import {
  BATCH_NOTES_ACTION_TEXT,
  BATCH_NOTES_REASON_TEXT,
  batchNotesReasonText,
  batchNotesResultNotice,
  type BatchNotesNotice,
} from "../../core/batchNotesReport";

export { BATCH_NOTES_ACTION_TEXT, BATCH_NOTES_REASON_TEXT, batchNotesReasonText, batchNotesResultNotice, type BatchNotesNotice };

/** 桌面历史调用点仍用 ActionShape/ReasonShape；与 core 形状结构一致。 */
export function batchNotesResultNoticeFor(result: BatchNotesResultShape, action: BatchNotesActionShape): BatchNotesNotice {
  return batchNotesResultNotice(result as never, action as never);
}

export type { BatchNotesReasonShape };
