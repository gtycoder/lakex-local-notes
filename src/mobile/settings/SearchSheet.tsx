/** 搜索 Sheet（Phase 3b）：bridge.searchNotes LIKE fallback。 */
import { useCallback, useEffect, useState } from "react";
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

  const run = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); return; }
    setSearching(true);
    try {
      setResults(await bridge.searchNotes(trimmed));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
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
    <>
      <div className="mobile-sheet-mask" onClick={onClose} />
      <div className="mobile-sheet mobile-sheet-search">
        <div className="mobile-sheet-grab" />
        <div className="mobile-search-input-row">
          <Search size={17} />
          <input
            className="mobile-search-input"
            placeholder="搜索文档"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="mobile-search-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
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
    </>
  );
}
