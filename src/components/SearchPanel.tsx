import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Search, X } from "lucide-react";
import { native } from "../lib/native";

interface SearchResult { id: string; title: string; snippet: string }

/** 把 highlight() 输出的 <mark> 保留、其余 HTML 转义（防文档内容注入） */
function sanitizeSnippet(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

export function SearchPanel({ open, initialQuery, onOpenNote, onClose }: {
  open: boolean;
  initialQuery: string;
  onOpenNote: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      try {
        setResults(await native.searchNotes(q, 50));
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 300);
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, [query, open]);

  if (!open) return null;
  return createPortal(
    <div className="search-panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="search-panel" role="dialog" aria-modal="true">
        <div className="search-panel-input-row">
          <Search size={16} className="search-panel-search-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder="全文搜索（3 字及以上命中正文，短词匹配标题）"
          />
          {searching && <span className="search-panel-spinner" aria-label="搜索中" />}
          <button className="search-panel-close" onClick={onClose} title="关闭（Esc）" aria-label="关闭搜索"><X size={15} /></button>
        </div>
        <div className="search-panel-results">
          {results.length === 0 && query.trim() && !searching && (
            <div className="search-panel-empty">没有匹配结果</div>
          )}
          {results.map((r) => (
            <button key={r.id} className="search-result" onClick={() => { onOpenNote(r.id); onClose(); }}>
              <span className="search-result-title"><FileText size={14} />{r.title || "无标题"}</span>
              {r.snippet && <span className="search-result-snippet" dangerouslySetInnerHTML={{ __html: sanitizeSnippet(r.snippet) }} />}
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body
  );
}
