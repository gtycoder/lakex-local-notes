import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Dialog } from "../../components/ui/Overlay";
import {
  QUICK_NOTE_TIME_OPTIONS,
  type QuickNoteTimeFilter,
} from "../../core/quickNoteFilters";
import type { QuickNoteTagFilter, QuickNoteTagSummary } from "../../core/quickNoteTags";
import { QUICK_NOTE_TYPE_OPTIONS, type QuickNoteTypeFilter } from "../../core/quickNoteTypeFilter";

export interface QuickNoteFilterState {
  time: QuickNoteTimeFilter;
  tagFilter: QuickNoteTagFilter;
  type: QuickNoteTypeFilter;
}

interface QuickNoteFilterDialogProps {
  open: boolean;
  tags: readonly QuickNoteTagSummary[];
  value: QuickNoteFilterState;
  onApply(next: QuickNoteFilterState): void;
  onClose(): void;
}

/** 快捷筛选（261024）：时间档 / 自定日期 / 类型 / 标签包含与排除，一次应用。 */
export function QuickNoteFilterDialog({ open, tags, value, onApply, onClose }: QuickNoteFilterDialogProps) {
  const [time, setTime] = useState<QuickNoteTimeFilter>(value.time);
  const [type, setType] = useState<QuickNoteTypeFilter>(value.type);
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setTime(value.time);
    setType(value.type);
    if (value.tagFilter.kind === "selection") {
      setInclude([...value.tagFilter.include]);
      setExclude([...value.tagFilter.exclude]);
    } else if (value.tagFilter.kind === "tag") {
      setInclude([value.tagFilter.id]);
      setExclude([]);
    } else {
      setInclude([]);
      setExclude([]);
    }
  }, [open, value]);

  const activeName = include.length > 0 || exclude.length > 0
    ? [include.length ? `包含 ${include.length} 个` : "", exclude.length ? `排除 ${exclude.length} 个` : ""].filter(Boolean).join(" · ")
    : "";

  function toggleInclude(id: string): void {
    setInclude((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setExclude((current) => current.filter((value) => value !== id));
  }

  function toggleExclude(id: string): void {
    setExclude((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setInclude((current) => current.filter((value) => value !== id));
  }

  function apply(): void {
    const tagFilter: QuickNoteTagFilter = include.length === 0 && exclude.length === 0
      ? { kind: "all" }
      : { kind: "selection", include, exclude };
    onApply({ time, type, tagFilter });
  }

  function reset(): void {
    setTime({ kind: "any" });
    setType("all");
    setInclude([]);
    setExclude([]);
  }

  return (
    <Dialog open={open} onDismiss={onClose} label="筛选小记" className="quick-note-filter-dialog">
      <div className="ln-dialog__body">
        <header className="quick-note-filter-dialog__head">
          <h3>筛选小记</h3>
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭" onClick={onClose}><X size={15} /></button>
        </header>

        <section className="quick-note-filter-dialog__section">
          <span className="quick-note-filter-dialog__label">时间</span>
          <div className="quick-note-filter-dialog__chips">
            {QUICK_NOTE_TIME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={"quick-note-tag" + (time.kind === option.id ? " is-selected" : "")}
                onClick={() => setTime(option.id === "custom" ? { kind: "custom", from: "", to: "" } : { kind: option.id } as QuickNoteTimeFilter)}
              >{option.label}</button>
            ))}
          </div>
          {time.kind === "custom" && (
            <div className="quick-note-filter-dialog__dates">
              <label className="ln-input"><span>起</span><input className="ln-input__field" type="date" value={time.from} onChange={(event) => setTime({ ...time, from: event.target.value })} aria-label="起始日期" /></label>
              <label className="ln-input"><span>止</span><input className="ln-input__field" type="date" value={time.to} onChange={(event) => setTime({ ...time, to: event.target.value })} aria-label="结束日期" /></label>
            </div>
          )}
        </section>

        <section className="quick-note-filter-dialog__section">
          <span className="quick-note-filter-dialog__label">类型</span>
          <div className="quick-note-filter-dialog__chips">
            {QUICK_NOTE_TYPE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={"quick-note-tag" + (type === option.id ? " is-selected" : "")}
                onClick={() => setType(option.id)}
              >{option.label}</button>
            ))}
          </div>
        </section>

        <section className="quick-note-filter-dialog__section">
          <span className="quick-note-filter-dialog__label">标签</span>
          {tags.length === 0 ? (
            <span className="quick-note-filter-dialog__empty">还没有标签。</span>
          ) : (
            <>
              <div className="quick-note-filter-dialog__sublabel">必须同时包含（可多选）</div>
              <div className="quick-note-filter-dialog__chips">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={"quick-note-tag" + (include.includes(tag.id) ? " is-selected" : "")}
                    onClick={() => toggleInclude(tag.id)}
                  >{include.includes(tag.id) && <Check size={11} />}<span className="ln-ellipsis">{tag.name}</span></button>
                ))}
              </div>
              <div className="quick-note-filter-dialog__sublabel">排除</div>
              <div className="quick-note-filter-dialog__chips">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={"quick-note-tag quick-note-tag--exclude" + (exclude.includes(tag.id) ? " is-selected" : "")}
                    onClick={() => toggleExclude(tag.id)}
                  >{exclude.includes(tag.id) ? <Check size={11} /> : <span className="quick-note-filter-dialog__minus">−</span>}<span className="ln-ellipsis">{tag.name}</span></button>
                ))}
              </div>
            </>
          )}
        </section>

        <footer className="quick-note-filter-dialog__footer">
          <span className="quick-note-filter-dialog__hint">{activeName}</span>
          <button type="button" className="ln-btn ln-btn--ghost" onClick={reset}>重置</button>
          <button type="button" className="ln-btn ln-btn--primary" onClick={apply}>应用</button>
        </footer>
      </div>
    </Dialog>
  );
}
