import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../ui/Overlay";
import { Clock, File, Search, StickyNote, X } from "lucide-react";
import { native } from "../../lib/native";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { createRequestVersion } from "../../core/requestVersion";
import { initialSearchIndex, nextSearchIndex } from "../model/searchNavigation";
import { prefetchEditorKernelNow } from "../../features/editor/kernelPrefetch";
import {
  DEFAULT_SEARCH_SCOPE,
  SEARCH_SCOPES,
  SEARCH_SCOPE_STORAGE_KEY,
  filterByScope,
  matchTagSearch,
  mergeSearchHits,
  parseSearchScope,
  searchIdleHint,
  searchNoResultHint,
  type SearchHit,
  type SearchScope,
  type TagSearchIndex,
} from "../../features/search/searchScope";
import { clearRecentSearches, pushRecentSearch, readRecentSearches, writeRecentSearches } from "../../features/search/recentSearches";
import { loadTagSearchIndex } from "../../features/search/tagSearchIndex";
import { filterDiarySearchHits } from "../../features/diary/diarySearch";

function formatUpdatedAt(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/** 范围是设备本地视图：读存储失败/坏值一律回落到「全部」。 */
function readStoredScope(): SearchScope {
  try {
    return parseSearchScope(localStorage.getItem(SEARCH_SCOPE_STORAGE_KEY));
  } catch {
    return DEFAULT_SEARCH_SCOPE;
  }
}

export function SearchPanel({ open, initialQuery, onOpenNote, onOpenQuickNote, onClose, scopeNoteIds }: {
  open: boolean;
  initialQuery: string;
  onOpenNote: (id: string, query: string) => void;
  onOpenQuickNote: (id: string) => void;
  onClose: () => void;
  /**
   * 可选的命中收窄（261109 日记空间用）：给定集合时只保留集合内的**文档**命中。
   * 纯显示层过滤 —— 不改 FTS/索引、不改主进程 search_notes（日记就是普通文档，本来就在索引里）。
   * 空集合 = 一篇都没有（不要当成"不过滤"）。
   */
  scopeNoteIds?: ReadonlySet<string> | null;
}) {
  /** 范围筛选（261106）：设备本地视图，localStorage 记忆，不写设置。 */
  const [scope, setScope] = useState<SearchScope>(() => readStoredScope());
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchHit[]>([]);
  /** 最近搜索（localStorage；空查询时展示，点一下直接执行）。 */
  const [recent, setRecent] = useState<string[]>([]);
  /** 标签命中用索引（既有 IPC 拼接，不新增索引）；null = 不可用/未就绪。 */
  const [tagIndex, setTagIndex] = useState<TagSearchIndex | null>(null);
  const [tagIndexLoading, setTagIndexLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const requestVersionRef = useRef(createRequestVersion());

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setActiveIndex(-1);
      setRecent(readRecentSearches());
    }
  }, [open, initialQuery]);

  // 标签命中索引：每次打开装载一次（用户可能刚改过标签）；不可用 ⇒ null，标签结果为空但搜索照常。
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setTagIndex(null);
    setTagIndexLoading(true);
    void loadTagSearchIndex()
      .then((index) => { if (alive) setTagIndex(index); })
      .finally(() => { if (alive) setTagIndexLoading(false); });
    return () => { alive = false; };
  }, [open]);

  // 范围记忆（设备本地视图）
  useEffect(() => {
    writeLocalStorage(SEARCH_SCOPE_STORAGE_KEY, scope);
  }, [scope]);

  useEffect(() => {
    const version = requestVersionRef.current.next();
    setSearchError(null);
    if (!open) {
      setSearching(false);
      return () => requestVersionRef.current.invalidate();
    }
    const q = query.trim();
    if (!q) {
      setResults([]);
      setActiveIndex(-1);
      setSearching(false);
      return () => requestVersionRef.current.invalidate();
    }
    setSearching(true);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      try {
        const nextResults = await native.searchNotes(q, 50);
        if (requestVersionRef.current.isCurrent(version)) {
          setResults(nextResults as SearchHit[]);
          setActiveIndex(initialSearchIndex(nextResults.length));
        }
      } catch (error) {
        if (requestVersionRef.current.isCurrent(version)) {
          setResults([]); setActiveIndex(-1);
          setSearchError(getNativeErrorMessage(error) || "无法完成搜索");
        }
      } finally {
        if (requestVersionRef.current.isCurrent(version)) setSearching(false);
      }
    }, 120);
    return () => {
      if (timerRef.current !== undefined) { window.clearTimeout(timerRef.current); timerRef.current = undefined; }
      requestVersionRef.current.invalidate();
    };
  }, [query, open, retry]);

  const trimmedQuery = query.trim();
  /** 标签命中（纯函数）：索引未就绪/不可用时为空数组，标题/正文搜索不受影响。 */
  const tagHits = useMemo(
    () => (tagIndex && trimmedQuery ? matchTagSearch(tagIndex, trimmedQuery) : []),
    [tagIndex, trimmedQuery],
  );
  /** 主进程命中 + 标签命中（按 kind:id 去重，主进程顺序不动） */
  const mergedResults = useMemo(() => mergeSearchHits(results, tagHits), [results, tagHits]);
  /** 范围过滤（纯函数） */
  /** 范围收窄（日记空间）：判据单一来源 = features/diary/diarySearch 的 filterDiarySearchHits。 */
  const scopedResults = useMemo(
    () => (scopeNoteIds ? filterDiarySearchHits(mergedResults, scopeNoteIds) : mergedResults),
    [mergedResults, scopeNoteIds],
  );
  const visibleResults = useMemo(() => filterByScope(scopedResults, scope), [scopedResults, scope]);
  /** 键盘导航目标：有关键词 = 结果列表；空查询 = 最近搜索。 */
  const navigable = trimmedQuery ? visibleResults : recent;
  const idleHint = searchIdleHint();
  const noResultHint = searchNoResultHint(scope);
  /** 标签范围下索引还在装载 ⇒ 先不给「没有匹配结果」（避免误导）。 */
  const tagIndexPending = scope === "tag" && tagIndexLoading;

  if (!open) return null;

  const commitQuery = (value: string) => {
    const next = pushRecentSearch(recent, value);
    if (next.length === recent.length && next.every((item, index) => item === recent[index])) return;
    setRecent(next);
    writeRecentSearches(next);
  };
  const openResult = (result: SearchHit) => {
    commitQuery(trimmedQuery);
    if (result.kind === "quick-note") onOpenQuickNote(result.id);
    else onOpenNote(result.id, result.matchType === "body" ? trimmedQuery : "");
    onClose();
  };
  const openActive = () => {
    if (!trimmedQuery) {
      const recentQuery = recent[activeIndex];
      if (recentQuery) { setQuery(recentQuery); setActiveIndex(-1); }
      return;
    }
    const result = visibleResults[activeIndex];
    if (result) openResult(result);
  };
  /** 键盘步进：还没选中时 ↓ 落到第一条、↑ 落到最后一条；其余沿搜索面板原有的环形步进。 */
  const stepSelection = (delta: 1 | -1) => {
    setActiveIndex((index) => {
      if (navigable.length === 0) return -1;
      if (index < 0) return delta > 0 ? 0 : navigable.length - 1;
      return nextSearchIndex(index, delta, navigable.length);
    });
  };
  const changeScope = (next: SearchScope) => {
    setScope(next);
    setActiveIndex(-1);
  };
  const clearRecents = () => {
    clearRecentSearches();
    setRecent([]);
    setActiveIndex(-1);
  };
  const firstQuickIndex = visibleResults.findIndex((result) => result.kind === "quick-note");

  return (
    <Dialog open onDismiss={onClose} label="搜索标题、正文和标签" surfaceClassName="search-panel search-command-panel" scrimClassName="ln-scrim--top" initialFocus={inputRef}>
        <div className="search-panel-input-row">
          <Search size={16} className="search-panel-search-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") { onClose(); return; }
              if (event.key === "ArrowDown") { event.preventDefault(); stepSelection(1); return; }
              if (event.key === "ArrowUp") { event.preventDefault(); stepSelection(-1); return; }
              if (event.key === "Enter") { event.preventDefault(); openActive(); }
            }}
            placeholder="搜索标题、正文、标签和小记（⌘K）"
            aria-describedby="search-panel-help"
          />
          {searching && <span className="search-panel-spinner" aria-label="搜索中" />}
          <button className="search-panel-close" onClick={onClose} title="关闭（Esc）" aria-label="关闭搜索"><X size={15} /></button>
        </div>
        {/* 范围切换走 kit 的 .ln-tabs 原语（与历史/回收站/设置同款墨线页签） */}
        <div className="ln-tabs search-scope-tabs">
          <div className="ln-tabs__track" role="tablist" aria-label="搜索范围">
            {SEARCH_SCOPES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={scope === item.id}
                className={`ln-tabs__item${scope === item.id ? " is-active" : ""}`}
                onClick={() => changeScope(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div id="search-panel-help" className="search-panel-help">标题优先；标签按名称匹配；↑↓ 选择，Enter 打开</div>
        {searchError && <div className="ln-empty" role="alert">
          <strong>搜索失败</strong><span>{searchError}</span>
          <button className="ln-btn ln-btn--secondary" onClick={() => setRetry((value) => value + 1)}>重试搜索</button>
        </div>}
        <div className="search-panel-results ln-list-panel ln-list-panel--background" role="listbox" aria-label={trimmedQuery ? "搜索结果" : "最近搜索"} aria-busy={searching}>
          {!trimmedQuery && (
            <div className="ln-empty ln-empty--idle search-panel-idle">
              <Search size={18} />
              <strong>{idleHint.title}</strong>
              <small>{idleHint.detail}</small>
            </div>
          )}
          {!trimmedQuery && recent.length > 0 && (
            <section className="search-recent" aria-label="最近搜索">
              <div className="search-recent__head">
                <span><Clock size={12} />最近搜索</span>
                <button type="button" className="ln-btn ln-btn--ghost ln-btn--compact search-recent__clear" onClick={clearRecents}>清空</button>
              </div>
              <div className="search-recent__list">
                {recent.map((item, index) => (
                  <button
                    key={item}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`ln-list-item ln-row2 search-recent__item${index === activeIndex ? " ln-list-item--focus" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => { setQuery(item); setActiveIndex(-1); }}
                  >
                    <span className="ln-list-item__graphic"><Clock size={14} /></span>
                    <span className="ln-list-item__text ln-ellipsis">{item}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {trimmedQuery && tagIndexPending && visibleResults.length === 0 && !searchError && (
            <div className="ln-empty"><small>正在载入标签索引…</small></div>
          )}
          {trimmedQuery && visibleResults.length === 0 && !searching && !searchError && !tagIndexPending && (
            <div className="ln-empty search-panel-empty">
              <strong>{noResultHint.title}</strong>
              <span>{noResultHint.detail}</span>
              {noResultHint.broadenToAll && (
                <button type="button" className="ln-btn ln-btn--secondary" onClick={() => changeScope("all")}>搜索全部范围</button>
              )}
            </div>
          )}
          {visibleResults.map((result, index) => (
            <Fragment key={result.kind + ":" + result.id}>
              {index === firstQuickIndex && firstQuickIndex > 0 && <div className="search-panel-section">小记</div>}
              <button
                className={`ln-list-item ln-row2${index === activeIndex ? " ln-list-item--focus" : ""}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => { setActiveIndex(index); if (result.kind !== "quick-note") prefetchEditorKernelNow(); }}
                onFocus={() => { if (result.kind !== "quick-note") prefetchEditorKernelNow(); }}
                onClick={() => { setActiveIndex(index); openResult(result); }}
              >
                <span className="ln-list-item__graphic">{result.kind === "quick-note" ? <StickyNote size={14} /> : <File size={14} />}</span>
                <span className="ln-list-item__text ln-row2__main ln-ellipsis">
                  <span className="ln-row2__title">{result.title || (result.kind === "quick-note" ? "小记" : "无标题")}</span>
                  {/* snippet 由 buildSnippet 全量 HTML 转义、只含 <mark>（W-10：不需要 dompurify，见 snippet.test.ts） */}
                  {result.snippet && <span className="search-snippet" dangerouslySetInnerHTML={{ __html: result.snippet }} />}
                  <span className="ln-row2__meta">
                    {result.matchType === "tag"
                      ? "标签：" + (result.tagNames?.join("、") ?? "")
                      : (result.kind === "quick-note" ? "小记" : result.parentTitle || "个人笔记") + (formatUpdatedAt(result.updatedAt) ? "，" + formatUpdatedAt(result.updatedAt) : "")}
                  </span>
                </span>
                <span className={`badge ${result.kind === "quick-note" || result.matchType !== "title" ? "badge--accent" : "badge--muted"}`}>{result.kind === "quick-note" ? "小记" : result.matchType === "tag" ? "标签" : result.matchType === "body" ? "正文" : "标题"}</span>
              </button>
            </Fragment>
          ))}
        </div>
    </Dialog>
  );
}
