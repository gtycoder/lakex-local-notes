import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Search, X } from "lucide-react";
import { native } from "../lib/native";
import { createRequestVersion } from "../lib/requestVersion";
import { initialSearchIndex, nextSearchIndex } from "./searchNavigation";

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  matchType: "title" | "body";
  updatedAt?: string;
  parentTitle?: string | null;
}

/** 把 highlight() 输出的 <mark> 保留、其余 HTML 转义（防文档内容注入） */
function sanitizeSnippet(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

function formatUpdatedAt(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function SearchPanel({ open, initialQuery, onOpenNote, onClose }: {
  open: boolean;
  initialQuery: string;
  onOpenNote: (id: string, query: string, newTab: boolean) => void;
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
      window.setTimeout(() => inputRef.current?.focus(), 30);
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
  const openActive = (newTab: boolean) => {
    const result = results[activeIndex];
    if (!result) return;
    onOpenNote(result.id, result.matchType === "body" ? query.trim() : "", newTab);
    onClose();
  };

  return createPortal(
    <div className="search-panel-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="search-panel search-command-panel" role="dialog" aria-modal="true" aria-label="搜索标题和正文">
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
              if (event.key === "Enter") { event.preventDefault(); openActive(event.metaKey); }
            }}
            placeholder="搜索标题和正文（⌘K）"
            aria-describedby="search-panel-help"
          />
          {searching && <span className="search-panel-spinner" aria-label="搜索中" />}
          <button className="search-panel-close" onClick={onClose} title="关闭（Esc）" aria-label="关闭搜索"><X size={15} /></button>
        </div>
        <div id="search-panel-help" className="search-panel-help">不搜索小记 · 1 个字符匹配标题，2 个及以上匹配标题和正文 · ↑↓ 选择 · Enter 打开并定位</div>
        <div className="search-panel-results" role="listbox" aria-label="搜索结果">
          {results.length === 0 && query.trim() && !searching && <div className="search-panel-empty">没有匹配结果<span>试试文档标题，或输入至少 2 个字符搜索正文</span></div>}
          {!query.trim() && <div className="search-panel-empty search-panel-empty--idle"><Search size={18} /><span>搜索你的 Lake 文档</span><small>标题优先，正文命中后会自动定位</small></div>}
          {results.map((result, index) => (
            <button
              key={result.id}
              className={`search-result${index === activeIndex ? " active" : ""}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => { setActiveIndex(index); onOpenNote(result.id, result.matchType === "body" ? query.trim() : "", false); onClose(); }}
            >
              <span className="search-result-title"><FileText size={14} />{result.title || "无标题"}<small>{result.matchType === "body" ? "正文" : "标题"}</small></span>
              {result.snippet && <span className="search-result-snippet" dangerouslySetInnerHTML={{ __html: sanitizeSnippet(result.snippet) }} />}
              <span className="search-result-meta">{result.parentTitle || "个人笔记"}{formatUpdatedAt(result.updatedAt) ? ` · ${formatUpdatedAt(result.updatedAt)}` : ""}</span>
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}
