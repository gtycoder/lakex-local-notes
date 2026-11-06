import type { SearchResult } from "../../core/searchTypes";

/**
 * 移动端搜索结果：在桌面同形的 SearchResult 上补「命中的标签名」。
 *
 * 为什么加在移动端自己的类型上：core 的 SearchResult 是两端共享契约（不许为移动端视图扩字段）；
 * 标签命中只用于移动端搜索的「标签」范围与结果行摘要，**不参与同步、不进正文**。
 */
export type MobileSearchResult = SearchResult & {
  /** 命中的标签名（按标签目录顺序；非标签命中时缺省）。 */
  matchedTags?: string[];
};
