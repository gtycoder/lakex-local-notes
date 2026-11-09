/**
 * 多文档选择：快捷组与按笔记本选文档（纯推导，便于单测）。
 *
 * 选择结果一律**落成具体引用**（AiWritingDocRef[]），发送时再读正文 —— 与语雀 chip 语义一致，
 * 且重开会话能原样恢复。快捷组不是动态查询：选择那一刻就把当时的文档固定下来。
 */
import type { QuickNoteListSummary, TreeNode } from "../../lib/types";
import { TRASH_NOTEBOOK_ID } from "../../core/syncDecisions";
import type { AiWritingDocRef } from "../../core/aiWriting";

export type AiWritingQuickGroupId =
  | "today-docs"
  | "today-quick-notes"
  | "week-docs"
  | "week-quick-notes"
  | "month-docs"
  | "month-quick-notes";

export interface AiWritingQuickGroup {
  id: AiWritingQuickGroupId;
  label: string;
  days: number;
  kind: "note" | "quick-note";
}

export const AI_WRITING_QUICK_GROUPS: readonly AiWritingQuickGroup[] = [
  { id: "today-docs", label: "今天我编辑的文档", days: 1, kind: "note" },
  { id: "today-quick-notes", label: "今天我编辑的小记", days: 1, kind: "quick-note" },
  { id: "week-docs", label: "近一周我编辑的文档", days: 7, kind: "note" },
  { id: "week-quick-notes", label: "近一周我编辑的小记", days: 7, kind: "quick-note" },
  { id: "month-docs", label: "近一个月我编辑的文档", days: 30, kind: "note" },
  { id: "month-quick-notes", label: "近一个月我编辑的小记", days: 30, kind: "quick-note" },
];

function withinDays(iso: string, days: number, now: Date): boolean {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return false;
  return time >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

/** 目录树里的「可当资料」的文档（排除回收站、已删除、云端已删；只取 note 节点且落过盘）。 */
export function selectableDocuments(treeNodes: readonly TreeNode[]): TreeNode[] {
  return treeNodes.filter((node) =>
    node.nodeType === "note" &&
    Boolean(node.noteFileId) &&
    !node.isPurged &&
    !node.cloudDeleted &&
    node.parentId !== TRASH_NOTEBOOK_ID,
  );
}

/** 笔记本（知识库）列表：排除回收站。 */
export function selectableNotebooks(treeNodes: readonly TreeNode[]): TreeNode[] {
  return treeNodes.filter((node) => node.nodeType === "notebook" && node.id !== TRASH_NOTEBOOK_ID && !node.isPurged);
}

/** 快捷组 → 具体引用（按 updatedAt 倒序，最多 50 篇，避免一次挂太多资料）。 */
export function refsForQuickGroup(
  group: AiWritingQuickGroup,
  treeNodes: readonly TreeNode[],
  quickNotes: readonly QuickNoteListSummary[],
  now: Date = new Date(),
): AiWritingDocRef[] {
  if (group.kind === "note") {
    return selectableDocuments(treeNodes)
      .filter((node) => withinDays(node.updatedAt, group.days, now))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, 50)
      .map((node) => ({ kind: "note" as const, id: node.noteFileId ?? node.id, title: node.title }));
  }
  return quickNotes
    .filter((note) => withinDays(note.updatedAt, group.days, now))
    .slice(0, 50)
    .map((note) => ({ kind: "quick-note" as const, id: note.id, title: note.previewText.slice(0, 24) || "小记" }));
}

/** 某个笔记本下的全部文档引用。 */
export function refsForNotebook(treeNodes: readonly TreeNode[], notebookId: string): AiWritingDocRef[] {
  return selectableDocuments(treeNodes)
    .filter((node) => node.parentId === notebookId)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((node) => ({ kind: "note" as const, id: node.noteFileId ?? node.id, title: node.title }));
}

/** 切换一条引用（已选 = 取消，未选 = 追加到末尾）。 */
export function toggleDocRef(refs: readonly AiWritingDocRef[], ref: AiWritingDocRef): AiWritingDocRef[] {
  const exists = refs.some((item) => item.id === ref.id && item.kind === ref.kind);
  if (exists) return refs.filter((item) => !(item.id === ref.id && item.kind === ref.kind));
  return [...refs, ref];
}

/** 文档 ref 的稳定 key（chip/勾选态判定）。 */
export function docRefKey(ref: { kind: string; id: string }): string {
  return ref.kind + ":" + ref.id;
}
