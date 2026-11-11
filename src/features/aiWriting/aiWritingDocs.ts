/**
 * 多文档选择：快捷组与按笔记本选文档（纯推导，便于单测）。
 *
 * 选择结果一律**落成具体引用**（AiWritingDocRef[]），发送时再读正文 —— 与语雀 chip 语义一致，
 * 且重开会话能原样恢复。快捷组不是动态查询：选择那一刻就把当时的文档固定下来。
 */
import type { QuickNoteListSummary, TreeNode } from "../../lib/types";
import { TRASH_NOTEBOOK_ID } from "../../core/syncDecisions";
import { diaryNotebooks, diarySubtreeIds } from "../../core/diary";
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

/**
 * 目录树里的「可当资料」的文档（排除回收站、已删除、云端已删；只取 note 节点且落过盘）。
 *
 * **排除日记子树**（261109）：日记是独立空间，把日记正文默认塞进 AI 资料集会超出用户预期
 * （日记正文会被发到第三方供应商）。判据单一来源 = `core.diarySubtreeIds`。
 */
export function selectableDocuments(treeNodes: readonly TreeNode[]): TreeNode[] {
  const diaryIds = diarySubtreeIds(treeNodes);
  return treeNodes.filter((node) =>
    node.nodeType === "note" &&
    Boolean(node.noteFileId) &&
    !node.isPurged &&
    !node.cloudDeleted &&
    node.parentId !== TRASH_NOTEBOOK_ID &&
    !diaryIds.has(node.id),
  );
}

/**
 * 笔记本（知识库）列表：排除回收站，**并排除日记本**。
 *
 * 261109：日记本不能作为「生成文档」的落点 —— 建进去的文档标题不是日期 ⇒ 日记时间线不收录，
 * 而日记本又被文档空间目录树隐藏 ⇒ 用户点完就再也找不到它（与「转为文档」禁止日记本作目标同口径）。
 */
export function selectableNotebooks(treeNodes: readonly TreeNode[]): TreeNode[] {
  const diaryIds = new Set(diaryNotebooks(treeNodes).map((node) => node.id));
  return treeNodes.filter((node) => node.nodeType === "notebook" && node.id !== TRASH_NOTEBOOK_ID && !node.isPurged && !diaryIds.has(node.id));
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

/** 某个笔记本（含其下所有分组）里的全部可当资料的文档（按 updatedAt 倒序）。 */
export function documentsOfNotebook(treeNodes: readonly TreeNode[], notebookId: string): TreeNode[] {
  const byId = new Map(treeNodes.map((node) => [node.id, node]));
  const under = (node: TreeNode): boolean => {
    const seen = new Set<string>();
    let parentId = node.parentId;
    while (parentId) {
      if (parentId === notebookId) return true;
      if (seen.has(parentId)) return false; // 防御坏数据环
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return false;
  };
  return selectableDocuments(treeNodes)
    .filter((node) => under(node))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** 某个笔记本下的全部文档引用（含分组后代）。 */
export function refsForNotebook(treeNodes: readonly TreeNode[], notebookId: string): AiWritingDocRef[] {
  return documentsOfNotebook(treeNodes, notebookId).map((node) => ({ kind: "note" as const, id: node.noteFileId ?? node.id, title: node.title }));
}

/**
 * 某个笔记本在「当前已选」里的覆盖状态（勾选框三态）。
 * 用户 261111：笔记本要能**整本勾选**，且同时选多个笔记本。
 */
export type NotebookSelectionState = "none" | "some" | "all";

export function notebookSelectionState(
  selected: readonly AiWritingDocRef[],
  notebookRefs: readonly AiWritingDocRef[],
): NotebookSelectionState {
  if (notebookRefs.length === 0) return "none";
  const keys = new Set(selected.map(docRefKey));
  const hit = notebookRefs.filter((ref) => keys.has(docRefKey(ref))).length;
  if (hit === 0) return "none";
  return hit === notebookRefs.length ? "all" : "some";
}

/**
 * 整本勾选 / 取消（与原生三态 checkbox 口径一致）：
 * - **已全选** ⇒ 只移除该本的文档（其它笔记本的选择不动 = 多本同时可选）；
 * - 未全选（含半选 / 全未选）⇒ 补齐该本**还缺的**文档（已选的不重复、顺序保持已有在前）。
 * 半选时点一下 = 补成整本，而不是全部取消。
 */
export function toggleNotebookRefs(
  selected: readonly AiWritingDocRef[],
  notebookRefs: readonly AiWritingDocRef[],
): AiWritingDocRef[] {
  const state = notebookSelectionState(selected, notebookRefs);
  const notebookKeys = new Set(notebookRefs.map(docRefKey));
  if (state !== "all") {
    const keys = new Set(selected.map(docRefKey));
    const missing = notebookRefs.filter((ref) => !keys.has(docRefKey(ref)));
    return [...selected, ...missing];
  }
  return selected.filter((ref) => !notebookKeys.has(docRefKey(ref)));
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
