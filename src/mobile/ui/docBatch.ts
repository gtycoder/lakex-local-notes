/**
 * 文档批量操作（多选）的共享判据（261107 架构整理）。
 *
 * 两处多选入口 —— 工作区目录树（useTreeSelection）与编辑器文档列表（DocListSheet）——
 * 各自维护了一份「payload → verb → 汇总 → 失败文案」「移动目标容器 / 当前位置计算」「标签目录 → 选择器 options」，
 * 之前是复制粘贴；这里收口成纯函数/薄封装，行为与文案完全不变。
 *
 * 不做的事：不统一两处的动作条顺序与文案（树=「移动/删除」短文案 + 置顶；列表=「移入回收站」长文案），
 * 也不统一两者的成功副作用（树刷新目录、列表就地增删行）——那些是入口语义差异，不是重复。
 */
import { bridge } from "../bridge";
import type { BatchNotesResult } from "../../core/batchNotes";
import { moveTargetCandidates } from "../../core/diary";
import type { QuickNoteTag, QuickNoteTagSummary } from "../../core/quickNoteTags";
import { confirmMobile } from "./ConfirmDialog";
import { summarizeBatchResult } from "./batchNotesResult";
import type { MoveTargetNode } from "./MoveTargetTreeSheet";

export type DocBatchPayload =
  | { action: "trash" }
  | { action: "move"; parentId: string | null }
  | { action: "tag-add"; tagIds: string[] };

type Snapshot = Awaited<ReturnType<typeof bridge.getHomeSnapshot>>;

/** 动作 → 成功汇总动词（与旧文案逐字一致，测试按此断言）。 */
export function docBatchVerb(action: DocBatchPayload["action"]): string {
  return action === "trash" ? "已移入回收站" : action === "move" ? "已移动" : "已加标签";
}

/** 调 bridge.batchNotes 并给出统一汇总；失败项数量由调用方决定是否保留选择。 */
export async function runDocBatch(
  ids: readonly string[],
  payload: DocBatchPayload,
): Promise<{ result: BatchNotesResult; text: string; detail: string; failed: number }> {
  const result = await bridge.batchNotes({ ...payload, ids: [...ids], space: "lake" });
  return {
    result,
    text: summarizeBatchResult(result, docBatchVerb(payload.action)),
    detail: summarizeBatchResult(result, ""),
    failed: result.summary.failed,
  };
}

/** 移动目标 = 快照里的容器节点（组件只展示笔记本；分组仍保留在数据里，由组件过滤）。
 *  日记本不作移动目标（261112 §3#25）：过滤日记子树（日记本 + 年/月组），判据单一来源 = core。 */
export function moveTargetsFromSnapshot(snapshot: Snapshot): MoveTargetNode[] {
  return moveTargetCandidates(snapshot.treeNodes)
    .filter((node) => node.nodeType === "notebook" || node.nodeType === "group")
    .map((node) => ({ id: node.id, title: node.title || "未命名", parentId: node.parentId, nodeType: node.nodeType }));
}

/** 当前位置：选中文档全在同一父级才高亮（混父级返回 null）。 */
export function moveParentFromSnapshot(snapshot: Snapshot, ids: readonly string[]): string | null {
  const parents = [...new Set(ids.map((id) => snapshot.notes.find((note) => note.id === id)?.parentId ?? null))];
  return parents.length === 1 ? parents[0] : null;
}

/** 标签目录 → 选择器 options（count 只影响按钮禁用，组件按选中条数显示）。 */
export function tagOptionsFromTags(tags: readonly QuickNoteTag[]): QuickNoteTagSummary[] {
  return tags.map((tag) => ({ ...tag, count: 0 }));
}

/** 批量移入回收站二次确认（文案单一来源）。 */
export function confirmTrashDocs(count: number): Promise<boolean> {
  return confirmMobile({
    title: "移入回收站？",
    body: "将把选中的 " + count + " 篇文档移入回收站（可恢复，不会彻底删除）。",
    confirmText: "移入回收站",
    danger: true,
  });
}
