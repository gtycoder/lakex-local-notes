/**
 * 移动端搜索「范围筛选」判据（纯逻辑，零 IO；261105 搜索增强）。
 *
 * 语义与数据层的 scoped 查询一一对应（改范围定义必须同步 searchIndex / quickNotesSearch）：
 * - 全部 all ：不限字段 = 文档标题 + 文档正文 + 文档标签、小记正文 + 小记标签；
 * - 标题 title：只搜**文档标题**（小记没有标题字段 —— 列表里显示的是正文首行预览，不参与）；
 * - 正文 body ：文档正文 + 小记正文（**不含**标题与标签）；
 * - 标签 tags ：文档标签 + 小记标签的**标签名**（标签目录单一来源，关系在 tag_links）。
 * 范围是**设备本地视图**：只影响这一次搜索的召回，不写库、不进同步。
 */
export type SearchScope = "all" | "title" | "body" | "tags";

/** 范围选项（顺序 = UI 分段控件的顺序；「全部」在最前）。 */
export const SEARCH_SCOPES: ReadonlyArray<{ id: SearchScope; label: string }> = [
  { id: "all", label: "全部" },
  { id: "title", label: "标题" },
  { id: "body", label: "正文" },
  { id: "tags", label: "标签" },
];

export const DEFAULT_SEARCH_SCOPE: SearchScope = "all";

/** 任意输入（桥参数 / 旧版本调用 / 测试桩）→ 合法范围；未知一律回落「全部」（不抛，搜索不失效）。 */
export function normalizeSearchScope(raw: unknown): SearchScope {
  return SEARCH_SCOPES.some((option) => option.id === raw) ? (raw as SearchScope) : DEFAULT_SEARCH_SCOPE;
}

export function searchScopeLabel(scope: SearchScope): string {
  return SEARCH_SCOPES.find((option) => option.id === scope)?.label ?? "全部";
}

/** 范围说明（搜索框下方一行小字）。移动端没有 hover，用途必须**常驻可见**。 */
export function searchScopeHint(scope: SearchScope): string {
  switch (scope) {
    case "title": return "只搜文档标题";
    case "body": return "只搜正文，不含标题与标签";
    case "tags": return "只搜文档与小记的标签名";
    default: return "搜文档标题、正文、标签与小记";
  }
}

export interface SearchEmptyState {
  /** idle = 还没输入（可展示最近搜索）；no-results = 搜过了但当前范围没有匹配。 */
  kind: "idle" | "no-results";
  message: string;
  /** 可执行动作：非「全部」范围无结果时给「放宽」入口（标签范围文案 = 清空标签筛选）。 */
  action: { label: string; nextScope: SearchScope } | null;
}

/**
 * 空态判据（纯函数）：返回 null = 有结果或正在搜索（由「搜索中」占位/结果列表承接）。
 * 无结果引导两档（AGENTS「移动端没有 hover，行动要直接给」）：
 * - 非「全部」范围 ⇒ 直接给「放宽到全部」（标签范围说「清空标签筛选」，与用户心智一致）；
 * - 已是「全部」⇒ 只提示换关键词，不给假动作。
 */
export function searchEmptyState(input: {
  query: string;
  scope: SearchScope;
  hasResults: boolean;
  searching?: boolean;
}): SearchEmptyState | null {
  if (input.searching) return null;
  const query = input.query.trim();
  if (!query) return { kind: "idle", message: searchScopeHint(input.scope), action: null };
  if (input.hasResults) return null;
  if (input.scope === "all") return { kind: "no-results", message: "没有匹配结果，试试更短的关键词", action: null };
  return {
    kind: "no-results",
    message: `当前范围（${searchScopeLabel(input.scope)}）没有匹配`,
    action: input.scope === "tags"
      ? { label: "清空标签筛选", nextScope: "all" }
      : { label: "在全部范围搜索", nextScope: "all" },
  };
}
