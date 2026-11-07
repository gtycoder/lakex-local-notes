
/**
 * 批量操作的结果 → 用户可见文案（261106 task-81；桌面多选条 / 移动端批量共用同一套原因口径）。
 *
 * 契约来源：src/core/batchNotes.ts 的 BatchNotesResult（{ ok, results, summary, reason?, message? }）。
 * 这里只做「原因 → 中文」与「成功/部分失败摘要」，不碰 IPC。
 */
import type { BatchNotesActionShape, BatchNotesReasonShape, BatchNotesResultShape } from "../../lib/types";

/** 动作名（界面文案；trash 一律叫「移入回收站」，用户 261106 定稿：删除 = 移入回收站）。 */
export const BATCH_NOTES_ACTION_TEXT: Record<BatchNotesActionShape, string> = {
  move: "移动",
  trash: "删除",
  "tag-add": "添加标签",
};

/** 逐条拒绝原因 → 可读说明（契约取值新增必须同步这里与移动端）。 */
export const BATCH_NOTES_REASON_TEXT: Record<BatchNotesReasonShape, string> = {
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

export function batchNotesReasonText(reason: BatchNotesReasonShape | undefined | null): string {
  return (reason && BATCH_NOTES_REASON_TEXT[reason]) || "未知原因";
}

export interface BatchNotesNotice {
  /** success = 全部成功；partial = 有失败条目；error = 整批未执行。 */
  kind: "success" | "partial" | "error";
  /** 一行可见文案（条数 + 原因摘要）。 */
  text: string;
  /** 失败条目 id（调用方保留它们的选中态）。 */
  failedIds: string[];
}

/**
 * 把批量结果收敛成「成功 N，失败 M：原因」提示；成功时只说结果条数。
 * 部分失败的原因按出现次数归并（最多列 2 类，避免提示条过长）。
 */
export function batchNotesResultNotice(
  result: BatchNotesResultShape,
  action: BatchNotesActionShape,
): BatchNotesNotice {
  const failed = (result.results ?? []).filter((item) => !item.ok);
  const failedIds = failed.map((item) => item.id);
  const done = result.summary?.done ?? 0;
  const actionText = BATCH_NOTES_ACTION_TEXT[action];
  if (result.ok) {
    return { kind: "success", text: "已" + actionText + " " + done + " 项", failedIds };
  }
  if (done > 0) {
    return {
      kind: "partial",
      text: "已" + actionText + " " + done + " 项，失败 " + failed.length + " 项：" + reasonSummary(failed),
      failedIds,
    };
  }
  const overall = result.reason ? batchNotesReasonText(result.reason) : "";
  const detail = failed.length > 0 ? reasonSummary(failed) : overall;
  return { kind: "error", text: "未" + actionText + (detail ? "：" + detail : ""), failedIds };
}

/** 失败原因摘要：按原因计数，「3 项：条目不存在…；1 项：…」。 */
function reasonSummary(failed: ReadonlyArray<{ reason?: BatchNotesReasonShape }>): string {
  const counts = new Map<BatchNotesReasonShape, number>();
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