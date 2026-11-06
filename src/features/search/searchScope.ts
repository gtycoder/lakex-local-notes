/**
 * 桌面全局搜索的「范围筛选」与「标签命中」（纯逻辑，供 SearchPanel 与单测共用）。
 *
 * 为什么标签命中在**渲染层**做：主进程的 `search_notes` 只返回标题/正文命中（matchType），
 * 没有标签维度；而标签目录 + 文档关系本来就有现成的 IPC（tags 空间在用）⇒ 这里只做拼接，
 * **不新增索引**、不动 electron/core。
 *
 * 设备本地视图：范围是纯视图状态（localStorage 记忆），不写设置、不进正文/同步。
 */

export type SearchScope = "all" | "title" | "body" | "tag";

export const SEARCH_SCOPE_STORAGE_KEY = "lakex-local-notes-v3.search-scope";
export const DEFAULT_SEARCH_SCOPE: SearchScope = "all";

/** 范围页签（单一来源：顺序 = UI 顺序）。 */
export const SEARCH_SCOPES: ReadonlyArray<{ id: SearchScope; label: string }> = [
  { id: "all", label: "全部" },
  { id: "title", label: "标题" },
  { id: "body", label: "正文" },
  { id: "tag", label: "标签" },
];

export function parseSearchScope(value: unknown): SearchScope {
  return SEARCH_SCOPES.some((item) => item.id === value) ? (value as SearchScope) : DEFAULT_SEARCH_SCOPE;
}

/** 一条搜索结果（主进程命中 或 渲染层拼出来的标签命中）。 */
export interface SearchHit {
  id: string;
  kind?: "note" | "quick-note";
  title: string;
  snippet: string;
  matchType: "title" | "body" | "tag";
  updatedAt?: string;
  parentTitle?: string | null;
  /** 标签命中时，命中的标签名（用于徽标/说明）；标题/正文命中不带。 */
  tagNames?: string[];
}

export function hitKey(hit: Pick<SearchHit, "id" | "kind">): string {
  return (hit.kind ?? "note") + ":" + hit.id;
}

/**
 * 按范围过滤。`all` 原样返回；标题/正文只看主进程给的 matchType；标签只看渲染层拼的命中。
 * 纯函数：不排序、不改字段（排序口径在各自来源里）。
 */
export function filterByScope<T extends Pick<SearchHit, "matchType">>(hits: readonly T[], scope: SearchScope): T[] {
  if (scope === "all") return [...hits];
  return hits.filter((hit) => hit.matchType === scope);
}

/** 标签命中所需的最小数据（全部来自既有 IPC，不含索引）。 */
export interface TagSearchIndex {
  tags: Array<{ id: string; name: string }>;
  /** noteId → tagIds（主库 tag_links，tags 空间同一来源）。 */
  noteLinks: Record<string, string[]>;
  notes: Array<{ id: string; title: string; kind?: string; updatedAt?: string; parentTitle?: string | null }>;
  quickNotes: Array<{ id: string; previewText: string; updatedAt?: string; tagIds?: string[] }>;
}

/** 标签命中的单次上限（与主进程搜索同为 50，避免标签把列表撑爆）。 */
export const TAG_SEARCH_LIMIT = 30;

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * 关键词 → 标签命中：标签名包含关键词（不区分大小写）⇒ 该标签下的文档 + 小记。
 * 空关键词 / 标签数据为空 ⇒ []。标题取文档标题（小记取预览文本），排序 = 更新时间倒序。
 */
export function matchTagSearch(index: TagSearchIndex | null | undefined, query: string): SearchHit[] {
  if (!index) return [];
  const needle = normalized(query);
  if (!needle) return [];
  const tags = index.tags.filter((tag) => tag.name && normalized(tag.name).includes(needle));
  if (tags.length === 0) return [];
  const matchedIds = new Set(tags.map((tag) => tag.id));
  const namesById = new Map(tags.map((tag) => [tag.id, tag.name]));
  const notesById = new Map(index.notes.map((note) => [note.id, note]));
  const hits: SearchHit[] = [];
  for (const [noteId, tagIds] of Object.entries(index.noteLinks)) {
    const note = notesById.get(noteId);
    if (!note) continue;
    const hitTags = (tagIds ?? []).filter((id) => matchedIds.has(id));
    if (hitTags.length === 0) continue;
    hits.push({
      kind: "note",
      id: note.id,
      title: note.title || "无标题",
      snippet: "",
      matchType: "tag",
      updatedAt: note.updatedAt,
      parentTitle: note.parentTitle ?? null,
      tagNames: hitTags.map((id) => namesById.get(id)).filter((name): name is string => !!name),
    });
  }
  for (const note of index.quickNotes) {
    const hitTags = (note.tagIds ?? []).filter((id) => matchedIds.has(id));
    if (hitTags.length === 0) continue;
    hits.push({
      kind: "quick-note",
      id: note.id,
      title: note.previewText || "小记",
      snippet: "",
      matchType: "tag",
      updatedAt: note.updatedAt,
      tagNames: hitTags.map((id) => namesById.get(id)).filter((name): name is string => !!name),
    });
  }
  hits.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return hits.slice(0, TAG_SEARCH_LIMIT);
}

/**
 * 合并主进程命中 + 标签命中：主进程结果在前（顺序不动），标签命中只补**未出现过**的条目（按 kind:id 去重），
 * 避免同一篇文档出现两行。
 */
export function mergeSearchHits(nativeHits: readonly SearchHit[], tagHits: readonly SearchHit[]): SearchHit[] {
  if (tagHits.length === 0) return [...nativeHits];
  const seen = new Set(nativeHits.map(hitKey));
  const merged = [...nativeHits];
  for (const hit of tagHits) {
    const key = hitKey(hit);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }
  return merged;
}

/** 空闲态引导（无关键词）。 */
export function searchIdleHint(): { title: string; detail: string } {
  return {
    title: "搜索标题、正文、标签",
    detail: "也可以搜小记；⌘K 随时唤起，↑↓ 选择，Enter 打开",
  };
}

/** 无结果引导：当前范围不是「全部」时给出「放宽范围」出口。 */
export function searchNoResultHint(scope: SearchScope): { title: string; detail: string; broadenToAll: boolean } {
  if (scope === "tag") {
    return {
      title: "没有匹配结果",
      detail: "标签按名称匹配；换个标签名试试，或放宽到全部范围",
      broadenToAll: true,
    };
  }
  if (scope !== "all") {
    const label = SEARCH_SCOPES.find((item) => item.id === scope)?.label ?? "";
    return {
      title: "没有匹配结果",
      detail: "当前只搜「" + label + "」；可以放宽到全部范围再试",
      broadenToAll: true,
    };
  }
  return {
    title: "没有匹配结果",
    detail: "试试更短的关键词；标签搜索按标签名称匹配",
    broadenToAll: false,
  };
}
