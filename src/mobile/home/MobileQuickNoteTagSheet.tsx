import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Tag, X } from "lucide-react";
import { normalizeQuickNoteTag, type QuickNoteTagSummary } from "../../core/quickNoteTags";

export interface MobileQuickNoteTagSheetProps {
  open: boolean;
  options: readonly QuickNoteTagSummary[];
  selected: readonly string[];
  onAdd: (tag: string) => void;
  onClose: () => void;
}

/** 移动端小记标签选择：候选集合来自全部有效小记，当前小记已有标签置灰。 */
export function MobileQuickNoteTagSheet({ open, options, selected, onAdd, onClose }: MobileQuickNoteTagSheetProps) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setError(null);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  let candidate = "";
  let candidateError = "";
  if (query.trim()) {
    try { candidate = normalizeQuickNoteTag(query); }
    catch (reason) { candidateError = reason instanceof Error ? reason.message : "标签名无效"; }
  }
  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? options.filter((option) => option.name.toLocaleLowerCase().includes(needle))
    : options;
  const exactExists = visible.some((option) => option.name === candidate) || selectedSet.has(candidate);

  const add = (name: string) => {
    try {
      onAdd(name);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加标签失败");
    }
  };

  return (
    <div className="mb-scrim" data-prevent-swipe onClick={onClose}>
      <div className="mb-sheet qn-tag-sheet" data-prevent-swipe onClick={(event) => event.stopPropagation()}>
        <div className="mb-sheet__grab" />
        <div className="mb-sheet__head">
          <span className="mb-sheet__title">添加标签</span>
          <button type="button" className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="mb-sheet__body qn-tag-sheet__body">
          <div className="qn-tag-sheet__input-row">
            <span className="mb-input qn-tag-sheet__input">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setError(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && candidate && !candidateError && !selectedSet.has(candidate)) {
                    event.preventDefault();
                    add(candidate);
                  }
                }}
                placeholder="输入标签名..."
                aria-label="标签名"
              />
            </span>
            <button type="button" disabled={!candidate || !!candidateError || exactExists} onClick={() => candidate && add(candidate)}>添加</button>
          </div>
          {(candidateError || error) && <div className="qn-tag-sheet__error">{error || candidateError}</div>}
          {candidate && !candidateError && !exactExists && (
            <button type="button" className="qn-tag-sheet__create" onClick={() => add(candidate)}>
              <Plus size={16} /><span>创建标签 “{candidate}”</span>
            </button>
          )}
          <div className="qn-tag-sheet__section"><Tag size={14} /><span>已有标签（{options.length}）</span></div>
          <div className="qn-tag-sheet__list">
            {visible.map((option) => {
              const checked = selectedSet.has(option.name);
              return (
                <button
                  type="button"
                  key={option.name}
                  className={"qn-tag-sheet__item" + (checked ? " is-selected" : "")}
                  disabled={checked}
                  onClick={() => add(option.name)}
                >
                  <span className="mb-ellipsis">{option.name}</span>
                  {checked ? <Check size={17} /> : <span className="qn-tag-sheet__count">{option.count}</span>}
                </button>
              );
            })}
            {visible.length === 0 && !candidate && <div className="qn-tag-sheet__empty">暂无已有标签</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
