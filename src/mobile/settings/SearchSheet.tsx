/**
 * 搜索 Sheet（Phase 3b；261105 增强：范围筛选 + 最近搜索 + 空态引导）。
 *
 * 与桌面同语义（FTS/摘要/小记合并都在 bridge.searchNotes 里，见 data/noteRepository），
 * UI 用移动端语汇：MobileSheet 外壳 + mb-segment 分段控件 + mb-chip 最近搜索 + mb-empty 空态。
 *
 * 范围筛选 = **设备本地视图**（只影响本次召回的字段，不写库、不进同步）：
 * 全部 / 标题 / 正文 / 标签 —— 定义与纯逻辑在 src/mobile/search/searchScope.ts。
 * 最近搜索 = localStorage 里「真正执行过」的查询（回车 / 点结果 / 点最近项），最多 8 条，可清空。
 *
 * 键盘与触摸不回归：
 * - 返回键/右滑/遮罩关闭仍由 MobileSheet 统一处理（本文件不手写 scrim/返回栈）；
 * - 输入框内 Esc 也直接关闭（桌面 SearchPanel 同口径）；Enter = 立即搜索并记入最近搜索；
 * - 结果行整行可点（旧行为不变），点完关闭面板并交给宿主打开文档/小记。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { MobileSearchResult } from "../search/searchTypes";
import {
  DEFAULT_SEARCH_SCOPE,
  SEARCH_SCOPES,
  searchEmptyState,
  searchScopeHint,
  type SearchScope,
} from "../search/searchScope";
import { clearRecentSearches, readRecentSearches, recordRecentSearch } from "../search/recentSearches";
import { bridge } from "../bridge";
import { MobileSheet } from "../ui/MobileSheet";
import { reportMobileActionError } from "../lib/reportMobileActionError";
import { getNativeErrorMessage } from "../../lib/nativeErrors";

export interface SearchSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  onOpenQuickNote: (id: string) => void;
}

export function SearchSheet(props: SearchSheetProps) {
  const { open, onClose, onOpenNote, onOpenQuickNote } = props;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>(DEFAULT_SEARCH_SCOPE);
  const [results, setResults] = useState<MobileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  // 请求版本守卫：快速输入/切范围时旧响应不得覆盖新结果（防竞态）
  const requestSeq = useRef(0);

  const run = useCallback(async (text: string, nextScope: SearchScope) => {
    const trimmed = text.trim();
    if (!trimmed) { setResults([]); setSearching(false); return; }
    const seq = ++requestSeq.current;
    setSearching(true);
    try {
      const hits = await bridge.searchNotes(trimmed, nextScope);
      if (seq !== requestSeq.current) return; // 已有更新请求，丢弃旧响应
      setResults(hits);
    } catch (error) {
      reportMobileActionError("搜索", error);
      if (seq === requestSeq.current) {
        setResults([]); setSearchError(getNativeErrorMessage(error) || "无法完成搜索");
      }
    } finally {
      if (seq === requestSeq.current) setSearching(false);
    }
  }, []);

  // 打开时读一次最近搜索：输入过程中不再碰存储（每次按键都读会白耗 IO）。
  useEffect(() => {
    if (!open) return;
    setRecent(readRecentSearches());
  }, [open]);

  useEffect(() => {
    ++requestSeq.current;
    setSearchError(null);
    if (!open) { setQuery(""); setResults([]); setSearching(false); setScope(DEFAULT_SEARCH_SCOPE); return; }
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const timer = window.setTimeout(() => { void run(query, scope); }, 200);
    return () => { window.clearTimeout(timer); ++requestSeq.current; };
    // run 是稳定引用；scope 变化要按新范围重搜，故进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, scope, retry]);

  if (!open) return null;

  /** 真正「执行过」才算一次最近搜索（回车/点结果/点最近项），不记输入中间态。 */
  const commitRecent = (text: string): void => {
    if (!text.trim()) return;
    setRecent(recordRecentSearch(text));
  };

  const applyRecent = (text: string): void => {
    setQuery(text);
    commitRecent(text);
  };

  const openResult = (result: MobileSearchResult): void => {
    commitRecent(query);
    if (result.kind === "quick-note") onOpenQuickNote(result.id);
    else onOpenNote(result.id);
    onClose();
  };

  // 空态（纯逻辑在 searchEmptyState）：错误态优先，不叠加空态文案。
  const empty = searchError ? null : searchEmptyState({ query, scope, hasResults: results.length > 0, searching });
  const showIdleEmpty = empty?.kind === "idle" && recent.length === 0;
  const showNoResults = empty?.kind === "no-results";

  // MOB-11：scrim / 右滑 / 返回栈 / 焦点与滚动锁统一由 MobileSheet 负责；
  // 类名与 DOM 结构沿用原手写版（.mb-scrim + .mb-sheet，视觉快照不变）。
  return (
    <MobileSheet open title="搜索" className="mb-sheet--search" onClose={onClose}>
      <div className="mobile-search-input-row">
        <Search size={17} />
        <input
          className="mobile-search-input"
          placeholder="搜索文档、小记与标签"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
            if (event.key === "Enter") {
              event.preventDefault();
              commitRecent(query);
              if (query.trim()) void run(query, scope);
            }
          }}
        />
      </div>
      {/* 范围筛选：设备本地视图（仅本次召回范围），切换后 effect 按新范围重搜。 */}
      <div className="mobile-search-scope">
        <div className="mb-segment" role="group" aria-label="搜索范围">
          {SEARCH_SCOPES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={"mb-segment__item" + (scope === option.id ? " is-active" : "")}
              aria-pressed={scope === option.id}
              onClick={() => setScope(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mobile-search-hint">{searchScopeHint(scope)}</p>
      <div className="mobile-search-results" aria-busy={searching}>
        {searching && <div className="mb-empty" role="status">搜索中…</div>}
        {searchError && <div className="mb-empty" role="alert">
          <div>搜索失败：{searchError}</div>
          <button className="mb-btn mb-btn--secondary" onClick={() => setRetry((value) => value + 1)}>重试搜索</button>
        </div>}
        {/* 空查询：最近搜索（可直接执行）或引导文案（只显示其中一个，避免两段提示叠着）。 */}
        {!query.trim() && recent.length > 0 && (
          <div className="mobile-search-recent">
            <div className="mobile-search-recent__head">
              <span>最近搜索</span>
              <button
                type="button"
                className="mb-btn mb-btn--ghost mb-btn--sm"
                onClick={() => { clearRecentSearches(); setRecent([]); }}
              >清空</button>
            </div>
            <div className="mb-chip-row">
              {recent.map((text) => (
                <button type="button" key={text} className="mb-chip" onClick={() => applyRecent(text)}>{text}</button>
              ))}
            </div>
          </div>
        )}
        {showIdleEmpty && <div className="mb-empty">{empty!.message}</div>}
        {/* 无结果引导：非「全部」范围给「放宽/清空标签筛选」的直接动作（移动端没有 hover，行动要可见可点）。 */}
        {showNoResults && (
          <div className="mb-empty">
            <div>{empty!.message}</div>
            {empty!.action && (
              <button
                type="button"
                className="mb-btn mb-btn--secondary"
                onClick={() => setScope(empty!.action!.nextScope)}
              >{empty!.action!.label}</button>
            )}
          </div>
        )}
        {results.map((r) => (
          <button type="button" key={`${r.kind ?? "note"}:${r.id}`} className="mobile-doc-row" onClick={() => openResult(r)}>
            <span className="mobile-search-main">
              <span className="mobile-search-title mb-ellipsis">{r.title || (r.kind === "quick-note" ? "小记" : "")}</span>
              {/* snippet 由 buildSnippet 全量转义、只含 <mark>（W-10；同桌面 SearchPanel） */}
              {r.snippet && <span className="mobile-search-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />}
            </span>
            {r.matchedTags && r.matchedTags.length > 0
              ? <span className="mobile-search-parent">标签：{r.matchedTags.join("、")}</span>
              : r.kind === "quick-note"
                ? <span className="mobile-search-parent">小记</span>
                : r.parentTitle && <span className="mobile-search-parent">{r.parentTitle}</span>}
          </button>
        ))}
      </div>
    </MobileSheet>
  );
}
