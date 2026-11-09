/**
 * 日记内搜索的**收窄判据**（纯函数，供以后给 SearchPanel 接一个可选入参用）。
 *
 * 现状（v1，用户 261109 定稿）：日记 = 普通 Lake 文档 ⇒ 天然在主进程 FTS 里，
 * `search_notes` 已覆盖；日记空间的搜索入口**直接打开现有全局搜索面板**（全库范围，不新增索引）。
 * 本文件只提供「拿到 SearchHit[] 之后按日记条目集合过滤」这一步，免得将来接线时
 * 在 SearchPanel 里现写一套集合判断（那样又会多一处判据来源）。
 *
 * 范围口径：`diaryEntryIds(treeNodes)`（= 日记条目的**文档 id** 集合，来自 core/diary）；
 * 小记命中（`kind === "quick-note"`）永远不属于日记。
 */

/** 与 features/search/searchScope.ts 的 SearchHit 结构兼容（只要求这两个字段）。 */
interface SearchHitLike {
  id: string;
  kind?: "note" | "quick-note";
}

/** 只留日记条目命中（保持原顺序；不改字段、不排序）。 */
export function filterDiarySearchHits<T extends SearchHitLike>(hits: readonly T[], diaryDocumentIds: ReadonlySet<string>): T[] {
  return hits.filter((hit) => (hit.kind ?? "note") === "note" && diaryDocumentIds.has(hit.id));
}
