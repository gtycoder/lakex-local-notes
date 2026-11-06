/**
 * 批量「打标签」选择器（261106 task-82）：只做**选择器**，不复用标签页的拖拽/管理模式。
 * - 支持搜索（按名称筛选）；
 * - 多选（行 aria-pressed）；确认按钮显示将影响的条数（「确认（N 条）」）；
 * - 与 MobileQuickNoteTagSheet 同一套 mb-* / qn-tag-sheet 视觉；新建标签不在批量里做（避免在批量流程里分裂目录）。
 */
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";
import { MobileSheet } from "./MobileSheet";

export interface BatchTagPickerSheetProps {
  open: boolean;
  /** 标签目录（含计数）。 */
  options: readonly QuickNoteTagSummary[];
  /** 将影响的条目条数（确认按钮显示「确认（N 条）」）。 */
  count: number;
  busy?: boolean;
  error?: string | null;
  onConfirm(tagIds: readonly string[]): void;
  onClose(): void;
}

export function BatchTagPickerSheet({ open, options, count, busy, error, onConfirm, onClose }: BatchTagPickerSheetProps) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked([]);
  }, [open]);

  const needle = query.trim().toLocaleLowerCase();
  const visible = useMemo(
    () => (needle ? options.filter((option) => option.name.toLocaleLowerCase().includes(needle)) : options),
    [options, needle],
  );

  const toggle = (tagId: string): void => {
    setPicked((current) => (current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]));
  };

  return (
    <MobileSheet
      open={open}
      title="打标签"
      onClose={() => { if (!busy) onClose(); }}
      className="qn-tag-sheet"
      bodyClassName="qn-tag-sheet__body mb-sheet__body--form"
      footer={<div className="mb-sheet__foot">
        <button type="button" className="mb-btn mb-btn--secondary" disabled={busy} onClick={onClose}>取消</button>
        <button
          type="button"
          className="mb-btn mb-btn--primary"
          disabled={busy || picked.length === 0 || count === 0}
          onClick={() => onConfirm(picked)}
        >{busy ? "处理中…" : "确认（" + count + " 条）"}</button>
      </div>}
    >
      <span className="mb-input qn-tag-sheet__input">
        <input
          value={query}
          aria-label="搜索标签"
          placeholder="搜索标签…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </span>
      <div className="qn-tag-sheet__section"><span>选择标签（已选 {picked.length}）</span></div>
      {error && <div className="qn-tag-sheet__error" role="alert">{error}</div>}
      {visible.length === 0 && <div className="qn-tag-sheet__empty">{options.length === 0 ? "还没有标签：先到「标签」页新建" : "没有匹配的标签"}</div>}
      <div className="qn-tag-sheet__list">
        {visible.map((option) => {
          const checked = picked.includes(option.id);
          return (
            <button
              type="button"
              key={option.id}
              className={"qn-tag-sheet__item" + (checked ? " is-selected" : "")}
              aria-pressed={checked}
              disabled={busy}
              onClick={() => toggle(option.id)}
            >
              <span className="mb-ellipsis">{option.name}</span>
              {checked && <Check size={17} />}
            </button>
          );
        })}
      </div>
    </MobileSheet>
  );
}
