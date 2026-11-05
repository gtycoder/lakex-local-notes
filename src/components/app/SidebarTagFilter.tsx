import { Check, X } from "lucide-react";
import type { QuickNoteTagSummary } from "../../core/quickNoteTags";
import {
  EMPTY_TAG_SELECTION,
  isTagSelectionActive,
  toggleTagSelection,
  type TagSelection,
} from "../../features/tags/tagsModel";
import "./sidebarTagFilter.css";

/**
 * 侧栏「按标签筛选」= **原目录筛选浮层的下段**（261105 P1 三修）。
 *
 * 用户验收反馈：目录顶部曾有独立「标签」图标 + 独立弹层，与名称筛选各占一份，图标太多。
 * ⇒ 现在只有**一个 Filter 按钮**：展开后上段 = DockFilterRow（名称筛选），下段 = 本组件（标签含/排除）。
 * 状态仍由 App 的 tagSelection 持有（这里只渲染/回灌，不新增第二份状态）。
 */
export interface SidebarTagFilterProps {
  tags: readonly QuickNoteTagSummary[];
  selection: TagSelection;
  onChange(next: TagSelection): void;
}

export function SidebarTagFilter({ tags, selection, onChange }: SidebarTagFilterProps) {
  const active = isTagSelectionActive(selection);
  if (tags.length === 0) {
    return (
      <div className="sidebar-tag-filter" role="group" aria-label="按标签筛选文档">
        <p className="sidebar-tag-filter__empty">还没有标签。给文档打标签后可在这里筛选。</p>
      </div>
    );
  }
  return (
    <div className="sidebar-tag-filter" role="group" aria-label="按标签筛选文档">
      <div className="sidebar-tag-filter__head">
        <span className="sidebar-tag-filter__label">标签</span>
      </div>
      <div className="sidebar-tag-filter__row">
        <span className="sidebar-tag-filter__sublabel">包含</span>
        <div className="sidebar-tag-filter__chips">
          {tags.map((tag) => (
            <button key={tag.id} type="button"
              className={"quick-note-tag" + (selection.include.includes(tag.id) ? " is-selected" : "")}
              aria-pressed={selection.include.includes(tag.id)}
              onClick={() => onChange(toggleTagSelection(selection, tag.id, "include"))}>
              {selection.include.includes(tag.id) && <Check size={11} aria-hidden="true" />}
              <span className="ln-ellipsis">{tag.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="sidebar-tag-filter__row">
        <span className="sidebar-tag-filter__sublabel">排除</span>
        <div className="sidebar-tag-filter__chips">
          {tags.map((tag) => (
            <button key={tag.id} type="button"
              className={"quick-note-tag quick-note-tag--exclude" + (selection.exclude.includes(tag.id) ? " is-selected" : "")}
              aria-pressed={selection.exclude.includes(tag.id)}
              onClick={() => onChange(toggleTagSelection(selection, tag.id, "exclude"))}>
              {selection.exclude.includes(tag.id) && <Check size={11} aria-hidden="true" />}
              <span className="ln-ellipsis">{tag.name}</span>
            </button>
          ))}
        </div>
      </div>
      {active && (
        <p className="sidebar-tag-filter__hint" role="status">
          已筛选：{selection.include.length > 0 ? "同时包含 " + selection.include.length + " 个标签" : "不限包含"}
          {selection.exclude.length > 0 ? "，排除 " + selection.exclude.length + " 个" : ""}
          <button type="button" className="sidebar-tag-filter__clear" aria-label="清除标签筛选" onClick={() => onChange(EMPTY_TAG_SELECTION)}><X size={10} />清除</button>
        </p>
      )}
    </div>
  );
}
