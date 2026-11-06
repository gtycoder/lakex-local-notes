/**
 * 目录树「多选/选择模式」的**纯判据**（261106 task-8）。
 *
 * 为什么单独成文件：选择态的语义（哪些行可选、全选作用在哪批 id）必须可单测、且与
 * 列表渲染/动作编排解耦；UI 只读这里的结果，不再在组件里各写一份 filter。
 *
 * 约定（用户口径）：**只允许文档（kind=note）**；笔记本在树里不是行，分组/笔记本一律不可选
 * （渲染时给置灰复选框，保持与文档行同样的左缘缩进）。
 */
import type { NotebookTreeItem } from "../data/notebookTreeRepository";
import type { NotebookTreeRow } from "./notebookTreeIndex";

/** 某一行是否可多选：只有文档可选（分组不可选）。 */
export function isTreeRowSelectable(item: Pick<NotebookTreeItem, "kind">): boolean {
  return item.kind === "note";
}

/**
 * 当前**可见**行里可多选的 id（顺序 = 目录显示顺序）。
 * 全选/计数/剪枝都以它为准：折叠分支里的文档不在列表里，不应被全选进去。
 */
export function selectableTreeIds(rows: readonly NotebookTreeRow[]): string[] {
  return rows.filter((row) => isTreeRowSelectable(row.item)).map((row) => row.item.id);
}
