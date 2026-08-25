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


/** 移动校验：不能移动到自身/后代；父节点必须存在（P1-5，对齐桌面 moveTreeNode）。
 * @param nodeId 被移动节点 id
 * @param targetParentId 目标父节点 id（null = 根层）
 * @param descendantIds 被移动节点的后代 id 集合（调用方从完整树计算）
 * @param parentExists 目标父节点是否存在于树中
 */
export function assertMoveTarget(nodeId: string, targetParentId: string | null, descendantIds: ReadonlySet<string>, parentExists: boolean): void {
  if (targetParentId === nodeId) throw new Error("不能移动到自身");
  if (targetParentId !== null && descendantIds.has(targetParentId)) throw new Error("不能移动到子节点");
  if (targetParentId !== null && !parentExists) throw new Error("父节点不存在: " + targetParentId);
}

/** 排序校验（对齐桌面 validateOrder）：orderedIds 不重复、都属于目标父节点（或含被移动节点）、且完整。
 * @param orderedIds 新排序列表
 * @param currentChildren 目标父节点的当前子节点 id 列表（不含被移动节点，若它是跨父移动）
 * @param movingId 被移动节点 id（跨父移动时允许出现在列表中）
 */
export function assertOrderedChildren(orderedIds: string[], currentChildren: string[], movingId: string): void {
  if (new Set(orderedIds).size !== orderedIds.length) throw new Error("重排列表包含重复节点");
  const allowed = new Set(currentChildren.includes(movingId) ? currentChildren : [...currentChildren, movingId]);
  for (const childId of orderedIds) {
    if (!allowed.has(childId)) throw new Error("重排列表包含不属于该父节点的节点: " + childId);
  }
  // 完整性：列表必须等于目标父节点的全部子节点（含被移动节点）
  if (orderedIds.length !== allowed.size) throw new Error("重排列表必须包含该父节点的全部子节点");
}
