/**
 * 目录树共享规则（Phase 0B：两端一致的校验/排序纯函数）。
 * 抽取自桌面 electron/noteMetadataRepository.ts + store.ts 的 nextSortOrder/ensureParent/assertParentCompatible。
 * 移动端 folders CRUD 与桌面 tree_nodes 写事务必须使用同一套规则，防止目录语义漂移。
 */

/** 下一个排序值：MAX(sort_order),-1)+1（桌面 store.ts nextSortOrder 语义；空父级下首个节点为 0）。 */
export function nextSortOrder(currentMax: number | null): number {
  return (currentMax ?? -1) + 1;
}

/** 名称校验：trim 后非空（两端一致；不修改原值，由调用方落库 trim 后的值）。 */
export function assertTreeNodeTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("名称不能为空");
  return trimmed;
}

/** 图标校验：null 或 1..16 字符（对齐桌面 noteMetadataRepository.setNodeIcon）。 */
export function assertNodeIcon(icon: string | null): void {
  if (icon !== null && (typeof icon !== "string" || icon.length > 16)) throw new Error("无效的图标");
}

/** 根层约束：notebook 必须根层；group/note 必须有父节点（对齐桌面 moveTreeNode 边界保护）。 */
export function assertRootConstraint(nodeType: string, parentId: string | null): void {
  if (nodeType !== "notebook" && parentId === null) throw new Error("note/group 必须位于目录节点下");
  if (nodeType === "notebook" && parentId !== null) throw new Error("notebook 必须位于根层");
}
