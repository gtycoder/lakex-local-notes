import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Tag } from "lucide-react";
import { Popover } from "../../components/ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import {
  normalizeQuickNoteTag,
  type QuickNoteTagSummary,
} from "../../core/quickNoteTags";

export interface QuickNoteTagPickerProps {
  anchor: HTMLElement;
  options: readonly QuickNoteTagSummary[];
  selected: readonly string[];
  onAdd: (tag: string) => void;
  onClose: () => void;
}

/** 桌面小记标签选择器：只负责搜索/创建/选择，不拥有持久化语义。 */
export function QuickNoteTagPicker({ anchor, options, selected, onAdd, onClose }: QuickNoteTagPickerProps) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { surfaceRef, style, placed } = usePopoverPosition({ open: true, anchor, width: 320, gap: 6 });
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  let candidate = "";
  let candidateError = "";
  if (query.trim()) {
    try { candidate = normalizeQuickNoteTag(query); }
    catch (reason) { candidateError = reason instanceof Error ? reason.message : "标签名无效"; }
  }

  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.name.toLocaleLowerCase().includes(needle));
  }, [options, query]);
  const exactExists = visibleOptions.some((option) => option.name === candidate) || selectedSet.has(candidate);

  useEffect(() => {
    if (placed) inputRef.current?.focus();
  }, [placed]);

  const add = (name: string) => {
    try {
      onAdd(name);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加标签失败");
    }
  };

  return (
    <Popover
      open
      onDismiss={onClose}
      label="添加标签"
      surfaceRef={surfaceRef}
      style={style ?? { visibility: "hidden" }}
      className="quick-note-tag-picker"
    >
      <div className="quick-note-tag-picker__head"><Tag size={14} /><strong>添加标签</strong></div>
      <span className="ln-input quick-note-tag-picker__input">
        <input
          ref={inputRef}
          className="ln-input__field"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && candidate && !candidateError) {
              event.preventDefault();
              if (!selectedSet.has(candidate)) add(candidate);
            }
          }}
          placeholder="输入标签名..."
          aria-label="标签名"
        />
      </span>
      {(candidateError || error) && <div className="quick-note-tag-picker__error">{error || candidateError}</div>}
      {candidate && !candidateError && !exactExists && (
        <button className="quick-note-tag-picker__create" onClick={() => add(candidate)}>
          <Plus size={13} /><span>创建标签 “{candidate}”</span>
        </button>
      )}
      <div className="quick-note-tag-picker__section">已有标签（{options.length}）</div>
      <div className="quick-note-tag-picker__list">
        {visibleOptions.map((option) => {
          const checked = selectedSet.has(option.name);
          return (
            <button
              key={option.name}
              className={"quick-note-tag-picker__item" + (checked ? " is-selected" : "")}
              disabled={checked}
              onClick={() => add(option.name)}
            >
              <span className="ln-ellipsis">{option.name}</span>
              {checked ? <Check size={13} /> : <span className="quick-note-tag-picker__count">{option.count}</span>}
            </button>
          );
        })}
        {visibleOptions.length === 0 && !candidate && <div className="quick-note-tag-picker__empty">暂无已有标签</div>}
      </div>
    </Popover>
  );
}
