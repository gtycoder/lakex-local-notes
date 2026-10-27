/**
 * AI 资料选择器（261023 P1）：会话开始前多选 Lake 文档。
 * 表面复用浮层原语 .mb-sheet（floating.css 唯一来源），行复用 .mb-row / .mb-input / .mb-btn。
 */
import { useEffect, useRef, useState } from "react";
import { pushBackHandler } from "../ui/backStack";
import { useSwipeToClose } from "../ui/useSwipeToClose";
import { AI_CORPUS_MAX_CHARS, AI_CORPUS_MAX_DOCS } from "./aiSession";

export interface CorpusCandidate {
  id: string;
  title: string;
  /** 已读到的字数；null = 正在读正文 / 尚未读取。 */
  chars: number | null;
  /** 正在读正文（行右侧显示「读取中…」）。 */
  loading?: boolean;
  /** 不具备资料资格（非 Lake 文档 / 空文档）的原因；有值时置灰。 */
  disabledReason?: string;
}

export interface AiCorpusSheetProps {
  open: boolean;
  candidates: CorpusCandidate[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onStart: () => void;
  onClose: () => void;
}

export function AiCorpusSheet({ open, candidates, selectedIds, onToggle, onStart, onClose }: AiCorpusSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  useSwipeToClose(sheetRef, onClose, open);
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, onClose]);
  if (!open) return null;

  const kw = query.trim();
  const rows = candidates.filter((doc) => !kw || doc.title.includes(kw));
  const selected = candidates.filter((doc) => selectedIds.includes(doc.id));
  const used = selected.reduce((sum, doc) => sum + (doc.chars ?? 0), 0);

  return (
    <>
      <div className="mb-scrim" data-prevent-swipe onClick={onClose} aria-hidden="true" />
      <div ref={sheetRef} className="mb-sheet ai-sheet" role="dialog" aria-modal="true" aria-label="选择资料" data-prevent-swipe>
        <div className="mb-sheet__head">
          <span className="mb-sheet__title">选择资料</span>
          <button type="button" className="mb-btn mb-btn--ghost mb-btn--sm" onClick={onClose}>取消</button>
        </div>
        <div className="ai-sheet__search">
          <span className="mb-input">
            <input aria-label="搜索文档" placeholder="搜索文档…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </span>
        </div>
        <div className="mb-sheet__body ai-sheet__body">
          {rows.length === 0 && <div className="mb-empty mb-empty--inset">没有匹配的文档</div>}
          {rows.map((doc) => {
            const on = selectedIds.includes(doc.id);
            const disabled = Boolean(doc.disabledReason);
            return (
              <button
                key={doc.id}
                type="button"
                className={"mb-row mb-row--two-line" + (on ? " is-selected" : "") + (disabled ? " ai-row--disabled" : "")}
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onToggle(doc.id)}
              >
                <span className={"ai-check" + (on ? " is-on" : "")} aria-hidden="true">{on ? "✓" : ""}</span>
                <span className="mb-row__main">
                  <span className="mb-row__title">《{doc.title}》</span>
                  <span className="mb-row__sub">{doc.disabledReason ?? (doc.loading ? "读取中…" : doc.chars === null ? "尚未读取" : doc.chars + " 字")}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="ai-sheet__foot">
          <span className={"ai-budget" + (used > AI_CORPUS_MAX_CHARS ? " is-warn" : "")}>
            已选 <b>{selected.length}</b> / {AI_CORPUS_MAX_DOCS} 篇 · {used.toLocaleString("en-US")} / {AI_CORPUS_MAX_CHARS.toLocaleString("en-US")} 字
            {used > AI_CORPUS_MAX_CHARS ? " · 超预算按顺序截断" : ""}
          </span>
          <button type="button" className="mb-btn mb-btn--primary" disabled={selected.length === 0} onClick={onStart}>开始对话</button>
        </div>
      </div>
    </>
  );
}
