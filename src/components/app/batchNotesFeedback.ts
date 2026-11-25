/**
 * 批量操作的结果 → 用户可见文案（261107 收口到 core/batchNotesReport）。
 * 契约来源：src/core/batchNotes.ts 的 BatchNotesResult；本文件只保留桌面导出名。
 */
import type { BatchNotesReasonShape } from "../../lib/types";
import {
  BATCH_NOTES_ACTION_TEXT,
  BATCH_NOTES_REASON_TEXT,
  batchNotesReasonText,
  batchNotesResultNotice,
  type BatchNotesNotice,
} from "../../core/batchNotesReport";

export { BATCH_NOTES_ACTION_TEXT, BATCH_NOTES_REASON_TEXT, batchNotesReasonText, batchNotesResultNotice, type BatchNotesNotice };

export type { BatchNotesReasonShape };
