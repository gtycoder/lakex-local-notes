import { useEffect, useRef, useState } from "react";
import { Dialog } from "./ui/Overlay";
import { File, Search, X } from "lucide-react";
import { native } from "../lib/native";
import { createRequestVersion } from "../core/requestVersion";
import { initialSearchIndex, nextSearchIndex } from "./searchNavigation";

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  matchType: "title" | "body";
  updatedAt?: string;
  parentTitle?: string | null;
}

function formatUpdatedAt(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function SearchPanel({ open, initialQuery, onOpenNote, onClose }: {
  open: boolean;
  initialQuery: string;
  onOpenNote: (id: string, query: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const requestVersionRef = useRef(createRequestVersion());

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setActiveIndex(-1);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    const version = requestVersionRef.current.next();
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
          setResults(nextResults);
          setActiveIndex(initialSearchIndex(nextResults.length));
        }
      } catch {
        if (requestVersionRef.current.isCurrent(version)) { setResults([]); setActiveIndex(-1); }
      } finally {
        if (requestVersionRef.current.isCurrent(version)) setSearching(false);
      }
    }, 120);
    return () => {
      if (timerRef.current !== undefined) { window.clearTimeout(timerRef.current); timerRef.current = undefined; }
      requestVersionRef.current.invalidate();
    };
  }, [query, open]);

  if (!open) return null;
  const openActive = () => {
    const result = results[activeIndex];
    if (!result) return;
    onOpenNote(result.id, result.matchType === "body" ? query.trim() : "");
    onClose();
  };

  return (
    <Dialog open onDismiss={onClose} label="搜索标题和正文" surfaceClassName="search-panel search-command-panel" scrimClassName="ln-scrim--top" initialFocus={inputRef}>
        <div className="search-panel-input-row">
          <Search size={16} className="search-panel-search-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") { onClose(); return; }
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => nextSearchIndex(index < 0 ? 0 : index, 1, results.length)); return; }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => nextSearchIndex(index < 0 ? 0 : index, -1, results.length)); return; }
              if (event.key === "Enter") { event.preventDefault(); openActive(); }
            }}
            placeholder="搜索标题和正文（⌘K）"
            aria-describedby="search-panel-help"
          />
          {searching && <span className="search-panel-spinner" aria-label="搜索中" />}
          <button className="search-panel-close" onClick={onClose} title="关闭（Esc）" aria-label="关闭搜索"><X size={15} /></button>
        </div>
        <div id="search-panel-help" className="search-panel-help">标题优先 · 正文命中后自动定位 · ↑↓ 选择 · Enter 打开</div>
        <div className="search-panel-results b3-list b3-list--background" role="listbox" aria-label="搜索结果">
          {results.length === 0 && query.trim() && !searching && (
            <div className="ln-empty"><strong>没有匹配结果</strong><span>试试文档标题或正文关键词</span></div>
          )}
          {!query.trim() && (
            <div className="ln-empty ln-empty--idle"><Search size={18} /><small>只搜索文档，不含小记</small></div>
          )}
          {results.map((result, index) => (
            <button
              key={result.id}
              className={`b3-list-item ln-row2${index === activeIndex ? " b3-list-item--focus" : ""}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => { setActiveIndex(index); onOpenNote(result.id, result.matchType === "body" ? query.trim() : ""); onClose(); }}
            >
              <span className="b3-list-item__graphic"><File size={14} /></span>
              <span className="b3-list-item__text ln-row2__main">
                <span className="ln-row2__title">{result.title || "无标题"}</span>
                {/* snippet 由 buildSnippet 全量 HTML 转义、只含 <mark>（W-10：不需要 dompurify，见 snippet.test.ts） */}
                {result.snippet && <span className="search-snippet" dangerouslySetInnerHTML={{ __html: result.snippet }} />}
                <span className="ln-row2__meta">{result.parentTitle || "个人笔记"}{formatUpdatedAt(result.updatedAt) ? ` · ${formatUpdatedAt(result.updatedAt)}` : ""}</span>
              </span>
              <span className={`badge ${result.matchType === "body" ? "badge--accent" : "badge--muted"}`}>{result.matchType === "body" ? "正文" : "标题"}</span>
            </button>
          ))}
        </div>
    </Dialog>
  );
}
