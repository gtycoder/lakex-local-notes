/**
 * 「知识库」列表的笔记本投影（移动端；261109 日记 v1 收尾）。
 *
 * 为什么单独一层：首页「知识库」与工作区「切换笔记本」共用同一份 notebooks，
 * 它必须是**文档空间的笔记本**——不含日记本（日记是独立空间，docs/DIARY.md 硬规则 5）、
 * 也不含「回收站」笔记本（261026 起软删 = parentId 指向它）。
 *
 * 判据全部来自 core（本文件不重写"什么算日记本/回收站"）：
 *  · 日记本 = `core/diary.withoutDiaryNotebook`（只认 `space === "diary"`，不看标题）；
 *  · 回收站 = `core/syncDecisions.TRASH_NOTEBOOK_ID`（持久化契约的单一常量，不写字面量）。
 * 只做**渲染层过滤**：不改存储、不写 wire、不动同步。
 */
import { withoutDiaryNotebook, type DiaryTreeNode } from "../../core/diary.js";
import { TRASH_NOTEBOOK_ID } from "../../core/syncDecisions.js";
import type { TreeNode } from "../../lib/types";

/** 文档空间的笔记本（保持传入顺序；收起区间由调用方决定）。 */
export function libraryNotebooks(nodes: readonly TreeNode[]): TreeNode[] {
  const visible = withoutDiaryNotebook(nodes as unknown as DiaryTreeNode[]) as unknown as TreeNode[];
  return visible.filter((node) => node.nodeType === "notebook" && node.id !== TRASH_NOTEBOOK_ID);
}
