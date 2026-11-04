import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Plus, Trash2, X } from "lucide-react";
import type { InkBackgroundImage, InkPage } from "../../core/inkDoc.js";
import { inkThumbUrl } from "./inkImageImport.js";
import { InkPaper } from "./InkPaper.js";
import { inkStrokeStyle } from "./inkStrokeStyle.js";

export interface InkPageStripProps {
  pages: InkPage[];
  activePageId?: string;
  pendingDeleteId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onAdd: () => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClose: () => void;
  /** 阅读态：页面增删/排序是正文数据，禁用并保持可见（避免"点了没反应"）；切页是纯视图，仍可用。 */
  readOnly?: boolean;
  /** 有页备注的页（v4 正文数据）：缩略图上打一个小标。 */
  notedPageIds?: ReadonlySet<string>;
}

/** 虚拟化窗口：当前滚动位置前后各留 10 页（P5：300 页 PDF 不再一次挂 300 份缩略图 DOM）。 */
export const PAGE_WINDOW_RADIUS = 10;
/** 页数不超过这个数就整条渲染（小文档/单测不需要虚拟化，行为与旧实现逐字一致）。 */
export const PAGE_WINDOW_MAX_ALL = 60;
/** 缩略图项宽（桌面 64 + gap 8）的兜底值；真实值在挂载后从首个缩略图量出来。 */
export const PAGE_WINDOW_FALLBACK_PITCH = 72;

export interface PageWindowInput {
  scrollLeft: number;
  viewportWidth: number;
  /** 单页横向步进（缩略图宽 + gap）。量不到时用 PAGE_WINDOW_FALLBACK_PITCH。 */
  pitch: number;
  total: number;
  activeIndex: number;
}

/**
 * 横向滚动条的可见窗口（纯函数，便于单测）：窗口 = 可见页 ± PAGE_WINDOW_RADIUS，
 * 且**必须包含 active 页**（全局预览打开时 active 可能在第 200 页）。
 */
export function pageWindow(input: PageWindowInput): { start: number; count: number } {
  const total = Math.max(0, Math.floor(input.total));
  if (total <= 0) return { start: 0, count: 0 };
  if (total <= PAGE_WINDOW_MAX_ALL) return { start: 0, count: total };
  const pitch = Number.isFinite(input.pitch) && input.pitch > 0 ? input.pitch : PAGE_WINDOW_FALLBACK_PITCH;
  const viewport = Number.isFinite(input.viewportWidth) ? Math.max(0, input.viewportWidth) : 0;
  const visible = Math.ceil(viewport / pitch) + 2;
  const count = Math.min(total, Math.max(PAGE_WINDOW_RADIUS * 2 + 1, visible + PAGE_WINDOW_RADIUS * 2));
  const firstVisible = Math.max(0, Math.floor(Math.max(0, input.scrollLeft) / pitch));
  let start = Math.max(0, firstVisible - PAGE_WINDOW_RADIUS);
  const active = Math.max(-1, Math.min(total - 1, Math.floor(input.activeIndex)));
  if (active >= 0 && active >= start + count) start = active - count + 1;
  if (active >= 0 && active < start) start = Math.max(0, active - PAGE_WINDOW_RADIUS);
  return { start: Math.min(Math.max(0, start), Math.max(0, total - count)), count };
}

function thumbAspect(image: InkBackgroundImage): string {
  if (image.fit === "cover") return "xMidYMid slice";
  if (image.fit === "stretch") return "none";
  return "xMidYMid meet";
}

function PageThumb({ page }: { page: InkPage }) {
  return (
    <svg viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {page.backgroundImage ? (
        // 缩略图不直接解码原图（N 张页 × 大图会卡预览）：资产服务 `?w=256` 档，够缩略图清晰度。
        <image
          href={inkThumbUrl(page.backgroundImage.url)}
          x={0}
          y={0}
          width={page.width}
          height={page.height}
          preserveAspectRatio={thumbAspect(page.backgroundImage)}
          pointerEvents="none"
        />
      ) : (
        <InkPaper width={page.width} height={page.height} background={page.background} />
      )}
      {page.strokes.map((stroke) => (
        <polyline
          key={stroke.id}
          points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={stroke.color}
          strokeWidth={Math.max(1.5, stroke.width)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={inkStrokeStyle(stroke.tool).opacity}
        />
      ))}
    </svg>
  );
}

export function InkPageStrip({
  pages,
  activePageId,
  pendingDeleteId,
  onSelect,
  onMove,
  onAdd,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onClose,
  readOnly = false,
  notedPageIds,
}: InkPageStripProps) {
  const pendingIndex = pendingDeleteId ? pages.findIndex((page) => page.id === pendingDeleteId) : -1;
  const activeIndex = pages.findIndex((page) => page.id === activePageId);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState({ scrollLeft: 0, viewportWidth: 0, pitch: PAGE_WINDOW_FALLBACK_PITCH });

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const first = list.querySelector<HTMLElement>(".ink-page-thumb");
    const width = first?.getBoundingClientRect().width ?? 0;
    const pitch = width > 0 ? width + 8 : PAGE_WINDOW_FALLBACK_PITCH;
    setMetrics((previous) => (
      previous.pitch === pitch && previous.viewportWidth === list.clientWidth
        ? previous
        : { ...previous, pitch, viewportWidth: list.clientWidth }
    ));
  }, []);

  useLayoutEffect(() => {
    measure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure, pages.length]);

  const windowRange = useMemo(
    () => pageWindow({ ...metrics, total: pages.length, activeIndex }),
    [metrics, pages.length, activeIndex],
  );
  const windowEnd = windowRange.start + windowRange.count;

  /** 打开预览 / 切页时把 active 滚进可见区（只改 scrollLeft，不用 scrollIntoView 带动外层）。 */
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex < 0 || pages.length <= PAGE_WINDOW_MAX_ALL) return;
    if (activeIndex >= windowRange.start && activeIndex < windowEnd) return;
    const target = Math.max(0, (activeIndex - PAGE_WINDOW_RADIUS) * metrics.pitch);
    list.scrollLeft = target;
    setMetrics((previous) => (previous.scrollLeft === target ? previous : { ...previous, scrollLeft: target }));
  }, [activeIndex, metrics.pitch, pages.length, windowRange.start, windowEnd]);

  const onScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    setMetrics((previous) => (previous.scrollLeft === list.scrollLeft ? previous : { ...previous, scrollLeft: list.scrollLeft }));
  }, []);

  const rendered = pages.slice(windowRange.start, windowEnd);
  // 动态几何只能走内联宽度（AGENTS「组件里不写 style」的例外：虚拟化间距是运行时量出来的，不是设计值）。
  const leadingWidth = windowRange.start > 0 ? Math.max(0, windowRange.start * metrics.pitch - 8) : 0;
  const trailingWidth = windowEnd < pages.length ? Math.max(0, (pages.length - windowEnd) * metrics.pitch - 8) : 0;

  return (
    <div className="ink-page-strip" role="region" aria-label="页面管理">
      <div className="ink-page-strip__list" ref={listRef} onScroll={onScroll}>
        {leadingWidth > 0 && <div className="ink-page-strip__spacer" aria-hidden="true" style={{ width: leadingWidth }} />}
        {rendered.map((page, offset) => {
          const index = windowRange.start + offset;
          return (
            <div key={page.id} className="ink-page-thumb" data-active={page.id === activePageId ? "true" : undefined}>
              <button
                className="ink-page-thumb__paper"
                data-background={page.background}
                onClick={() => onSelect(page.id)}
                aria-label={`打开第 ${index + 1} 页`}
                aria-current={page.id === activePageId ? "page" : undefined}
              >
                <PageThumb page={page} />
                <span className="ink-page-thumb__index">{index + 1}</span>
                {notedPageIds?.has(page.id) ? <span className="ink-page-thumb__note" aria-label="有页备注" /> : null}
              </button>
              <div className="ink-page-thumb__actions">
                <button onClick={() => onMove(page.id, -1)} disabled={readOnly || index === 0} aria-label={`第 ${index + 1} 页前移`} title={readOnly ? "阅读态不能调整页序，点编辑后可改" : "前移"}><ArrowLeft size={14} /></button>
                <button onClick={() => onMove(page.id, 1)} disabled={readOnly || index === pages.length - 1} aria-label={`第 ${index + 1} 页后移`} title={readOnly ? "阅读态不能调整页序，点编辑后可改" : "后移"}><ArrowRight size={14} /></button>
                <button onClick={() => onRequestDelete(page.id)} disabled={readOnly || pages.length <= 1} aria-label={`删除第 ${index + 1} 页`} title={readOnly ? "阅读态不能删除页面，点编辑后可改" : "删除页"}><Trash2 size={14} /></button>
              </div>
            </div>
          );
        })}
        {trailingWidth > 0 && <div className="ink-page-strip__spacer" aria-hidden="true" style={{ width: trailingWidth }} />}
        <button className="ink-page-strip__add" onClick={onAdd} disabled={readOnly} aria-label="新建页" title={readOnly ? "阅读态不能新建页，点编辑后可改" : "新建页"}><Plus size={18} /></button>
      </div>
      {pendingDeleteId && pendingIndex >= 0 ? (
        <div className="ink-page-strip__confirm" role="alertdialog" aria-label={`确认删除第 ${pendingIndex + 1} 页`}>
          <span>删除第 {pendingIndex + 1} 页？</span>
          <button onClick={onCancelDelete}>取消</button>
          <button className="is-danger" onClick={onConfirmDelete}>删除</button>
        </div>
      ) : null}
      <button className="ink-page-strip__close" onClick={onClose} aria-label="关闭页面管理" title="关闭"><X size={16} /></button>
    </div>
  );
}

export default InkPageStrip;