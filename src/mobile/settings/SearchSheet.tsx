/** 搜索 Sheet（Phase 3b）：bridge.searchNotes LIKE fallback。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { SearchResult } from "../../core/searchTypes";
import { bridge } from "../bridge";
import { useSwipeToClose } from "../ui/useSwipeToClose";

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
  // 请求版本守卫：快速输入时旧响应不得覆盖新结果（防竞态）
  const requestSeq = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  useSwipeToClose(sheetRef, onClose, open);

  const run = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); return; }
    const seq = ++requestSeq.current;
    setSearching(true);
    try {
      const hits = await bridge.searchNotes(trimmed);
      if (seq !== requestSeq.current) return; // 已有更新请求，丢弃旧响应
      setResults(hits);
    } catch {
      if (seq === requestSeq.current) setResults([]);
    } finally {
      if (seq === requestSeq.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!open) { setQuery(""); setResults([]); return; }
    const t = window.setTimeout(() => run(query), 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  if (!open) return null;

  return (
    <div className="mb-scrim" data-prevent-swipe onClick={onClose}>
      <div ref={sheetRef} className="mb-sheet mb-sheet--search" data-prevent-swipe onClick={(e) => e.stopPropagation()}>
        <div className="mb-sheet__grab" />
        <div className="mb-sheet__head">
          <span className="mb-sheet__title">搜索</span>
          <button className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="mb-sheet__body">
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
          <div className="mobile-search-results">
          {searching && <div className="mb-empty">搜索中…</div>}
          {!searching && query.trim() && results.length === 0 && <div className="mb-empty">无匹配结果</div>}
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
        </div>
      </div>
    </div>
  );
}
