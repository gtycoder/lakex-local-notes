/**
 * 日记判据的输入投影：**目录（folders）+ 文档（notes）的混合视图**。
 *
 * 为什么需要它（261109 片 C 的真实缺陷）：`bridge.getHomeSnapshot().treeNodes` 来自
 * `treeRepository.listTreeNodes`，那条 SQL **只查 folders**（移动端 notes 是另一张表）。
 * 只把 folders 喂给 `core/diary.diaryEntries/planDiaryConvert` ⇒ 日记页永远空、日记内搜索恒 0 条。
 *
 * 本文件只做**形状投影**（LocalNoteSummary → TreeNode），不复制任何判据：
 * 「哪些是日记条目 / 日期键 / 分组」全部仍在 `src/core/diary.ts`。
 */
import type { TreeNode } from "../../lib/types";
import type { LocalNoteSummary } from "../data/noteRepository";

/** 文档摘要 → 目录节点形状（只补 diary 判据用得到的字段；排序位无业务含义，统一 0）。 */
function noteToTreeNode(note: LocalNoteSummary): TreeNode {
  return {
    id: note.id,
    workspaceId: "mobile",
    parentId: note.parentId,
    nodeType: "note",
    title: note.title,
    noteFileId: note.id,
    sortOrder: 0,
    createdAt: note.updatedAt,
    updatedAt: note.updatedAt,
    isConflict: false,
    icon: null,
    space: null,
  };
}

/** folders 原样 + notes 投影 ⇒ core/diary 可直接消费的节点数组。 */
export function diaryNodesFrom(folders: readonly TreeNode[], notes: readonly LocalNoteSummary[]): TreeNode[] {
  return [...folders, ...notes.map(noteToTreeNode)];
}
