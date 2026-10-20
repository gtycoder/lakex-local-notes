export interface SearchResult {
  id: string;
  /** 结果域：缺省/note = 文档；quick-note = 小记（全局搜索合并后由 UI 分组/图标区分）。 */
  kind?: "note" | "quick-note";
  title: string;
  snippet: string;
  matchType: "title" | "body";
  updatedAt: string;
  parentTitle: string | null;
}
