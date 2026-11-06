/**
 * 标签详情里的**小记卡**（261106 task-76 重设计；task-77 修「展开」判定）：
 *  · 内容 = 首页同一套富预览（TagQuickNotePreview → QuickNotePreview）；
 *  · **限高 180px**（超出渐隐，见 quick-notes.css 的 .tag-quick-card），内容更高时在裁切区**外**出现「展开 / 收起」；
 *  · × 放在 .mb-set-item__ctl **右侧独立列**（44 命中），不与正文重叠；× 只触发「移除该条关联」确认；
 *  · 点卡片正文进小记（与首页卡片同语义）；卡内勾选框只读、点它不打开（预览内部 stopPropagation）。
 *
 * 判定（task-77 修正）：要测的是**被限高那个元素自己**的 scrollHeight（overflow:hidden 的元素 scrollHeight
 * 仍然是内容真实高度）；此前测的是它的父容器（高度恒 ≤180 ⇒ 永远判不出溢出，按钮因此不出现）。
 * 正文是异步读的（readQuickNote）⇒ ResizeObserver 观察**卡片里的内容子节点**（内容长高会触发），外加一帧 rAF 复测。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { formatListTime } from "../../core/dateFormat";
import { TagQuickNotePreview } from "./TagQuickNotePreview";

/** 判定余量：溢出比较时给 2px 余量，避免亚像素/滚动条误差让按钮忽隐忽现。 */
const OVERFLOW_SLACK_PX = 2;

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
  /** true = 内容被 max-height 真裁到（此时才画渐隐、才给「展开」）。 */
  const [clipped, setClipped] = useState(false);
  /** 被限高的卡片本体（scrollHeight 才是内容真实高度）。 */
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** 卡片里的内容根节点（预览异步长高时由它触发 ResizeObserver）。 */
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setExpanded(false);
    setClipped(false);
    let alive = true;
    /**
     * 溢出判据 = **实际裁切比较**：overflow:hidden + max-height 时 clientHeight 就是被夹住后的高度，
     * scrollHeight 是内容真实高度 ⇒ scrollHeight > clientHeight + 2 才是「真的被裁了」。
     * 展开态 clientHeight 也变成内容高度（比较恒 false）⇒ 展开期间不再复测，保住「收起」按钮。
     */
    const measure = (): void => {
      if (!alive) return;
      const el = cardRef.current;
      if (!el) return;
      if (el.classList.contains("is-expanded")) return;
      setClipped(el.scrollHeight > el.clientHeight + OVERFLOW_SLACK_PX);
    };
    measure();
    // 异步正文到达后（同一帧内的布局变化 ResizeObserver 可能还没回调）再复测一次。
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(measure) : 0;
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    // 观察内容子节点：它长高 = 正文/图片到达（卡片本体被 max-height 钉住，观察它不会有回调）。
    if (contentRef.current) ro?.observe(contentRef.current);
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
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
        <div ref={contentRef}>
          <div ref={cardRef} className={"tag-quick-card" + (clipped && !expanded ? " is-clipped" : "") + (expanded ? " is-expanded" : "")}>
            <TagQuickNotePreview noteId={noteId} fallbackText={title} />
          </div>
        </div>
        {/* 按钮在裁切区外：卡片被 max-height 裁掉时「展开」仍可见可点。 */}
        {(clipped || expanded) && (
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
