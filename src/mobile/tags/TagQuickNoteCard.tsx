/**
 * 标签详情里的**小记卡**（261106 task-76 重设计）：
 *  · 内容 = 首页同一套富预览（TagQuickNotePreview → QuickNotePreview）；
 *  · **限高 180px**（超出渐隐，见 quick-notes.css 的 .tag-quick-card），内容更高时卡内出现「展开 / 收起」；
 *  · × 放在 .mb-set-item__ctl **右侧独立列**（44 命中），不与正文重叠；× 只触发「移除该条关联」确认；
 *  · 点卡片正文进小记（与首页卡片同语义）；卡内勾选框只读、点它不打开（预览内部 stopPropagation）。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { formatListTime } from "../../core/dateFormat";
import { TagQuickNotePreview } from "./TagQuickNotePreview";

/** 与 quick-notes.css 的 .tag-quick-card max-height 保持一致（判定是否给「展开」）。 */
const COLLAPSED_MAX_PX = 180;

export interface TagQuickNoteCardProps {
  noteId: string;
  /** 列表投影里的标题/摘要（预览没加载时的回落，也是 × 的 aria 主体）。 */
  title: string;
  updatedAt: string;
  busy?: boolean;
  onOpen(): void;
  onRemove(): void;
}

const fmtTime = (iso: string): string => {
  try { return formatListTime(new Date(iso), new Date()); } catch { return iso; }
};

export function TagQuickNoteCard({ noteId, title, updatedAt, busy, onOpen, onRemove }: TagQuickNoteCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setExpanded(false);
    const measure = (): void => {
      const el = innerRef.current;
      if (el) setOverflowing(el.scrollHeight > COLLAPSED_MAX_PX + 8);
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (innerRef.current) ro?.observe(innerRef.current);
    return () => { ro?.disconnect(); };
  }, [noteId]);

  return (
    <div className="mb-set-item">
      <div
        className="mb-set-item__main"
        role="button"
        tabIndex={0}
        aria-label={"打开小记 " + title}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); }
        }}
      >
        <div ref={innerRef}>
          <div className={"tag-quick-card" + (expanded ? " is-expanded" : "")}>
            <TagQuickNotePreview noteId={noteId} fallbackText={title} />
          </div>
        </div>
        {overflowing && (
          <button
            type="button"
            className="quick-note-preview-toggle"
            aria-expanded={expanded}
            onClick={(event) => { event.stopPropagation(); setExpanded(!expanded); }}
          >{expanded ? "收起" : "展开"}</button>
        )}
        <div className="mb-set-item__desc">小记　{fmtTime(updatedAt)}</div>
      </div>
      <div className="mb-set-item__ctl">
        <button
          type="button"
          className="mb-iconbtn"
          disabled={busy}
          aria-label={"移除标签「" + title + "」"}
          onClick={(event) => { event.stopPropagation(); onRemove(); }}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
