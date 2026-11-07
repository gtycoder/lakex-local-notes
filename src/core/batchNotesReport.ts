/**
 * 批量操作结果 → 用户可见文案（261107 单一来源）。
 * 桌面 components/app/batchNotesFeedback 与移动 mobile/ui/batchNotesResult 都从这里取原因文案。
 */
import type { BatchNotesAction, BatchNotesReason } from "./batchNotes";

export const BATCH_NOTES_REASON_TEXT: Record<BatchNotesReason, string> = {
  "invalid-input": "参数不合法",
  "invalid-action": "不支持的操作",
  "empty-ids": "没有选中条目",
  "too-many-ids": "单次最多 500 项，请分批处理",
  "invalid-id": "条目 id 无效",
  "not-found": "条目不存在或已彻底删除",
  "notebook-not-batchable": "笔记本不支持批量操作",
  unsupported: "该类型不支持这个操作",
  "already-trashed": "条目已在回收站里",
  "parent-not-found": "目标位置不存在或已删除",
  "parent-not-a-container": "目标位置不是笔记本或分组",
  "parent-in-trash": "目标位置在回收站里",
  "parent-cycle": "不能移动到自己的子项里",
  "tag-unavailable": "标签目录暂不可用",
  "tag-not-found": "标签不存在或已删除",
  failed: "操作失败（已回滚）",
};

export const BATCH_NOTES_ACTION_TEXT: Record<BatchNotesAction, string> = {
  move: "移动",
  trash: "删除",
  "tag-add": "添加标签",
  "tag-remove": "移除标签",
};

export function batchNotesReasonText(reason: BatchNotesReason | undefined | null): string {
  return (reason && BATCH_NOTES_REASON_TEXT[reason]) || "未知原因";
}

export interface BatchNotesNotice {
  kind: "success" | "partial" | "error";
  text: string;
  failedIds: string[];
}

interface BatchResultLike {
  ok: boolean;
  results?: ReadonlyArray<{ id: string; ok: boolean; reason?: BatchNotesReason }>;
  summary?: { done: number };
  reason?: BatchNotesReason;
  message?: string;
}

function reasonSummary(failed: ReadonlyArray<{ reason?: BatchNotesReason }>): string {
  const counts = new Map<BatchNotesReason, number>();
  for (const item of failed) {
    const reason = item.reason ?? "failed";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([reason, count]) => count + " 项：" + batchNotesReasonText(reason))
    .join("；");
}

/** 把批量结果收敛成「已 X N 项 / 部分失败 / 未 X」提示。 */
export function batchNotesResultNotice(result: BatchResultLike, action: BatchNotesAction): BatchNotesNotice {
  const failed = (result.results ?? []).filter((item) => !item.ok);
  const failedIds = failed.map((item) => item.id);
  const done = result.summary?.done ?? 0;
  const actionText = BATCH_NOTES_ACTION_TEXT[action];
  if (result.ok) return { kind: "success", text: "已" + actionText + " " + done + " 项", failedIds };
  if (done > 0) {
    return { kind: "partial", text: "已" + actionText + " " + done + " 项，失败 " + failed.length + " 项：" + reasonSummary(failed), failedIds };
  }
  const overall = result.reason ? batchNotesReasonText(result.reason) : "";
  const detail = failed.length > 0 ? reasonSummary(failed) : overall;
  return { kind: "error", text: "未" + actionText + (detail ? "：" + detail : ""), failedIds };
}
