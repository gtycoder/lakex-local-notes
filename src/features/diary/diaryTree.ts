/**
 * 日记空间 ↔ 文档空间的**渲染层**适配（只做类型收窄与 id 映射，不复制判据）。
 *
 * 判据单一来源 = `src/core/diary.ts`（`diaryNotebooks` / `withoutDiaryNotebook` / `diaryEntries`）。
 * 为什么还要这一层，两件事：
 * ① core 的入参/出参是结构类型 `DiaryTreeNode`，桌面侧到处是 `TreeNode` —— `as` 断言收在一处；
 * ② **core 的 `DiaryEntry.noteId` 是「树节点 id」**（它只认树，不碰 `noteFileId`），而桌面打开文档、
 *    标签页、`activeNoteId` 用的都是 **`noteFileId`**。两者不同 ⇒ 打开/选中必须映射，否则会拿树 id
 *    去 `openNote`（打不开，或打开错的文档）。这里给出 `documentId`，组件只认它。
 *
 * 边界：**只读**。不改存储、不建文档、不写 wire（见 docs/DIARY.md 硬规则 5）。
 */
import {
  diaryEntries,
  diaryNotebooks,
  withoutDiaryNotebook,
  type DiaryEntry,
  type DiaryTreeNode,
} from "../../core/diary";
import type { TreeNode } from "../../lib/types";

/** core 条目 + 桌面打开用的文档 id（= 树节点的 `noteFileId`；理论上必有，兜底回落树 id）。 */
export interface DiaryEntryView extends DiaryEntry {
  /** `openNote` / 标签页 / `activeNoteId` 用的 id（`TreeNode.noteFileId`）。 */
  documentId: string;
  /** 树节点 id（= core 的 `DiaryEntry.noteId`，仅用于树内定位，不能拿去打开文档）。 */
  nodeId: string;
}

/** 文档空间目录树 = 全树 − 日记笔记本（表现层过滤，存储不动）。 */
export function documentTreeWithoutDiary(nodes: readonly TreeNode[]): TreeNode[] {
  return withoutDiaryNotebook(nodes as unknown as DiaryTreeNode[]) as unknown as TreeNode[];
}

/** 当前日记笔记本（正常只有 1 个；多个时 core 已按 sortOrder/id 稳定取首个）。 */
export function diaryNotebookOf(nodes: readonly TreeNode[]): TreeNode | null {
  return (diaryNotebooks(nodes as unknown as DiaryTreeNode[])[0] as unknown as TreeNode | undefined) ?? null;
}

/** 树节点 id → 文档 id（打开用）。找不到返回 null（不猜）。 */
export function documentIdOfTreeNode(nodes: readonly TreeNode[], nodeId: string | null): string | null {
  if (!nodeId) return null;
  return nodes.find((node) => node.id === nodeId)?.noteFileId ?? null;
}

/** 日记条目（日期倒序 + 文档 id 映射）。年/月分组**不在这里做** —— 交给 core 的 groupDiaryEntries。 */
export function diaryEntryViews(nodes: readonly TreeNode[]): DiaryEntryView[] {
  const notebook = diaryNotebookOf(nodes);
  const byNodeId = new Map(nodes.map((node) => [node.id, node]));
  return diaryEntries(nodes as unknown as DiaryTreeNode[], notebook?.id ?? null).map((entry) => {
    const node = byNodeId.get(entry.noteId);
    return { ...entry, nodeId: entry.noteId, documentId: node?.noteFileId ?? entry.noteId };
  });
}

/** 日记条目**文档 id** 集合：给「搜索命中按日记过滤」「知识库同篇去重」用。 */
export function diaryEntryIds(nodes: readonly TreeNode[]): Set<string> {
  return new Set(diaryEntryViews(nodes).map((entry) => entry.documentId));
}
