export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  matchType: "title" | "body";
  updatedAt: string;
  parentTitle: string | null;
}
