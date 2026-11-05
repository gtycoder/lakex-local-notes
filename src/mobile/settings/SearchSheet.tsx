/** 搜索 Sheet（Phase 3b）：bridge.searchNotes LIKE fallback。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { SearchResult } from "../../core/searchTypes";
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
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // 请求版本守卫：快速输入时旧响应不得覆盖新结果（防竞态）
  const requestSeq = useRef(0);

  const run = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); setSearching(false); return; }
    const seq = ++requestSeq.current;
    setSearching(true);
    try {
      const hits = await bridge.searchNotes(trimmed);
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

  useEffect(() => {
    ++requestSeq.current;
    setSearchError(null);
    if (!open) { setQuery(""); setResults([]); setSearching(false); return; }
    if (!query.trim()) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = window.setTimeout(() => run(query), 200);
    return () => { window.clearTimeout(t); ++requestSeq.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, retry]);

  if (!open) return null;

  // MOB-11：scrim / 右滑 / 返回栈 / 焦点与滚动锁统一由 MobileSheet 负责；
  // 类名与 DOM 结构沿用原手写版（.mb-scrim + .mb-sheet，视觉快照不变）。
  return (
    <MobileSheet open title="搜索" className="mb-sheet--search" onClose={onClose}>
      <div className="mobile-search-input-row">
        <Search size={17} />
        <input
          className="mobile-search-input"
          placeholder="搜索文档和小记"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="mobile-search-results" aria-busy={searching}>
        {searching && <div className="mb-empty" role="status">搜索中…</div>}
        {searchError && <div className="mb-empty" role="alert">
          <div>搜索失败：{searchError}</div>
          <button className="mb-btn mb-btn--secondary" onClick={() => setRetry((value) => value + 1)}>重试搜索</button>
        </div>}
        {!searching && !searchError && query.trim() && results.length === 0 && <div className="mb-empty">无匹配结果</div>}
        {results.map((r) => (
          <div key={`${r.kind ?? "note"}:${r.id}`} className="mobile-doc-row" onClick={() => { if (r.kind === "quick-note") onOpenQuickNote(r.id); else onOpenNote(r.id); onClose(); }}>
            <span className="mobile-search-main">
              <span className="mobile-search-title mb-ellipsis">{r.title || (r.kind === "quick-note" ? "小记" : "")}</span>
              {/* snippet 由 buildSnippet 全量转义、只含 <mark>（W-10；同桌面 SearchPanel） */}
              {r.snippet && <span className="mobile-search-snippet" dangerouslySetInnerHTML={{ __html: r.snippet }} />}
            </span>
            {r.kind === "quick-note" && <span className="mobile-search-parent">小记</span>}
            {r.kind !== "quick-note" && r.parentTitle && <span className="mobile-search-parent">{r.parentTitle}</span>}
          </div>
        ))}
      </div>
    </MobileSheet>
  );
}
