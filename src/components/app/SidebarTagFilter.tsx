import { useRef, useState } from "react";
import { Check, Tag as TagIcon, X } from "lucide-react";
import { Popover } from "../ui/Overlay";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";
import {
  EMPTY_TAG_SELECTION,
  isTagSelectionActive,
  toggleTagSelection,
  type TagSelection,
} from "../../features/tags/tagsModel";
import "./sidebarTagFilter.css";

/**
 * 侧栏文档列表的「按标签筛选」（P1）：chips + 多选包含 / 排除。
 *
 * 交互语汇复用小记筛选（QuickNoteFilterDialog 的「必须同时包含 / 排除」两段），
 * 但这里是**侧栏常驻条**：生效中的选择直接以 chip 显示（可单个移除），点标签图标展开选择面板。
 * 组件只吃 props（选择状态由 App 持有），可单测。
 */
export interface SidebarTagFilterProps {
  tags: readonly QuickNoteTagSummary[];
  selection: TagSelection;
  onChange(next: TagSelection): void;
}

export function SidebarTagFilter({ tags, selection, onChange }: SidebarTagFilterProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { surfaceRef, style } = usePopoverPosition({ open, anchor: buttonRef.current, width: 260, gap: 6 });
  const active = isTagSelectionActive(selection);
  const nameOf = (tagId: string) => tags.find((tag) => tag.id === tagId)?.name ?? tagId;

  return (
    <div className="sidebar-tag-filter" role="group" aria-label="按标签筛选文档">
      <button ref={buttonRef} type="button"
        className={"dock-icon-btn ln-iconbtn ln-iconbtn--compact ln-iconbtn--accent" + (active ? " is-active" : "")}
        aria-label="按标签筛选" aria-pressed={open} title="按标签筛选"
        onClick={() => setOpen((value) => !value)}>
        <TagIcon size={14} />
      </button>
      {selection.include.map((tagId) => (
        <span key={"i" + tagId} className="quick-note-tag is-selected sidebar-tag-filter__chip">
          <span className="ln-ellipsis">{nameOf(tagId)}</span>
          <button type="button" className="sidebar-tag-filter__remove" aria-label={"移除包含标签 " + nameOf(tagId)}
            onClick={() => onChange(toggleTagSelection(selection, tagId, "include"))}><X size={10} /></button>
        </span>
      ))}
      {selection.exclude.map((tagId) => (
        <span key={"e" + tagId} className="quick-note-tag quick-note-tag--exclude is-selected sidebar-tag-filter__chip">
          <span className="ln-ellipsis">非 {nameOf(tagId)}</span>
          <button type="button" className="sidebar-tag-filter__remove" aria-label={"移除排除标签 " + nameOf(tagId)}
            onClick={() => onChange(toggleTagSelection(selection, tagId, "exclude"))}><X size={10} /></button>
        </span>
      ))}
      {active && (
        <button type="button" className="sidebar-tag-filter__clear" onClick={() => onChange(EMPTY_TAG_SELECTION)}>清除</button>
      )}
      {open && (
        <Popover open onDismiss={() => setOpen(false)} label="按标签筛选" surfaceRef={surfaceRef}
          style={style ?? { visibility: "hidden" }} className="sidebar-tag-filter__panel">
          {tags.length === 0 ? (
            <p className="sidebar-tag-filter__empty">还没有标签。</p>
          ) : (
            <>
              <div className="sidebar-tag-filter__label">必须同时包含（可多选）</div>
              <div className="sidebar-tag-filter__chips">
                {tags.map((tag) => (
                  <button key={tag.id} type="button"
                    className={"quick-note-tag" + (selection.include.includes(tag.id) ? " is-selected" : "")}
                    onClick={() => onChange(toggleTagSelection(selection, tag.id, "include"))}>
                    {selection.include.includes(tag.id) && <Check size={11} aria-hidden="true" />}
                    <span className="ln-ellipsis">{tag.name}</span>
                  </button>
                ))}
              </div>
              <div className="sidebar-tag-filter__label">排除</div>
              <div className="sidebar-tag-filter__chips">
                {tags.map((tag) => (
                  <button key={tag.id} type="button"
                    className={"quick-note-tag quick-note-tag--exclude" + (selection.exclude.includes(tag.id) ? " is-selected" : "")}
                    onClick={() => onChange(toggleTagSelection(selection, tag.id, "exclude"))}>
                    {selection.exclude.includes(tag.id) && <Check size={11} aria-hidden="true" />}
                    <span className="ln-ellipsis">{tag.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Popover>
      )}
    </div>
  );
}
