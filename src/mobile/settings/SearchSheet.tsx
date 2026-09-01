/** 搜索 Sheet（Phase 3b）：bridge.searchNotes LIKE fallback。 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { SearchResult } from "../../core/searchRepository";
import { bridge } from "../bridge";

export interface SearchSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenNote: (id: string) => void;
}

export function SearchSheet(props: SearchSheetProps) {
  const { open, onClose, onOpenNote } = props;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // 请求版本守卫：快速输入时旧响应不得覆盖新结果（防竞态）
  const requestSeq = useRef(0);

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
    <div className="mobile-sheet-mask" onClick={onClose}>
      <div className="mobile-sheet mobile-sheet-search" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-grab" />
        <div className="mobile-sheet-head">
          <span className="mobile-sheet-title">搜索</span>
          <button className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="mobile-sheet-body">
          <div className="mobile-search-input-row">
            <Search size={17} />
            <input
              className="mobile-search-input"
              placeholder="搜索文档"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="mobile-search-results">
          {searching && <div className="mobile-empty">搜索中…</div>}
          {!searching && query.trim() && results.length === 0 && <div className="mobile-empty">无匹配结果</div>}
          {results.map((r) => (
            <div key={r.id} className="mobile-doc-row" onClick={() => { onOpenNote(r.id); onClose(); }}>
              <span className="mobile-search-title">{r.title}</span>
              {r.parentTitle && <span className="mobile-search-parent">{r.parentTitle}</span>}
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}
