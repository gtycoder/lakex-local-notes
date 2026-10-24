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
  /** 已选标签 ID。 */
  selected: readonly string[];
  onAdd: (tagId: string) => void;
  /** 新建标签（写标签表后返回 ID）。 */
  onCreate: (name: string) => Promise<string>;
  onClose: () => void;
}

/** 桌面小记标签选择器：只负责搜索/创建/选择，不拥有持久化语义。 */
export function QuickNoteTagPicker({ anchor, options, selected, onAdd, onCreate, onClose }: QuickNoteTagPickerProps) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { surfaceRef, style, placed } = usePopoverPosition({ open: true, anchor, width: 320, gap: 6 });
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedNames = useMemo(
    () => new Set(options.filter((option) => selectedSet.has(option.id)).map((option) => option.name)),
    [options, selectedSet],
  );

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
  const existing = options.find((option) => option.name === candidate);
  const exactExists = !!existing || selectedNames.has(candidate);

  useEffect(() => {
    if (placed) inputRef.current?.focus();
  }, [placed]);

  const addExisting = (tagId: string) => {
    onAdd(tagId);
    onClose();
  };

  const create = async () => {
    if (!candidate || candidateError || creating) return;
    setCreating(true);
    try {
      const tagId = await onCreate(candidate);
      onAdd(tagId);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加标签失败");
    } finally { setCreating(false); }
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
              if (existing && !selectedSet.has(existing.id)) addExisting(existing.id);
              else if (!exactExists) void create();
            }
          }}
          placeholder="输入标签名..."
          aria-label="标签名"
        />
      </span>
      {(candidateError || error) && <div className="quick-note-tag-picker__error">{error || candidateError}</div>}
      {candidate && !candidateError && !exactExists && (
        <button className="quick-note-tag-picker__create" disabled={creating} onClick={() => void create()}>
          <Plus size={13} /><span>创建标签 “{candidate}”</span>
        </button>
      )}
      <div className="quick-note-tag-picker__section">已有标签（{options.length}）</div>
      <div className="quick-note-tag-picker__list">
        {visibleOptions.map((option) => {
          const checked = selectedSet.has(option.id);
          return (
            <button
              key={option.id}
              className={"quick-note-tag-picker__item" + (checked ? " is-selected" : "")}
              disabled={checked}
              onClick={() => addExisting(option.id)}
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
