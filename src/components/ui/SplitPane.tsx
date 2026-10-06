/**
 * 左右分栏（可拖动）：回收站 / 历史版本 / 资源 三处的「列表 | 预览」共用这一套实现。
 *
 * 视觉与行为**复用资料库侧栏的把手**（`.ln-split-handle`，见 kit.css）：零布局占位 + 绝对定位的
 * 10px 命中带 + 居中 2px 药丸（hover / 键盘聚焦时变强调色）。行为：指针拖拽（pointer capture）·
 * ←/→ 微调（Shift 加大步长）· Home/End 到两端 · 双击复位 · 键盘可达（role=separator）。
 *
 * 宽度**设备本地**：存 `lake-notes-v3.split.<key>`（与「表格本机视图 / 多维表导航」同族：纯展示，
 * 不进正文、不进 S3）。没拖过时**不给内联变量** ⇒ 各站点用自己 CSS 里的默认宽度。
 */
import { Children, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

const KEY_PREFIX = "lake-notes-v3.split.";
const STEP = 16;
const STEP_LARGE = 64;

function readStored(key: string): number | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

export interface SplitPaneProps {
  /** 分隔条的可访问名（如「调整资源列表宽度」）。 */
  ariaLabel: string;
  /** 设备本地的记住键（`lake-notes-v3.split.<key>`）。 */
  storageKey: string;
  minWidth?: number;
  maxWidth?: number;
  /** 右栏最小宽度：拖拽时用它夹取，避免把预览压到没边。 */
  minRight?: number;
  /** 整个分栏暂时隐藏（回收站按页签切换用）。 */
  hidden?: boolean;
  /** 容器类名，默认 `history-split`（既有分栏原语）。 */
  className?: string;
  children: ReactNode;
}

export function SplitPane({ ariaLabel, storageKey, minWidth = 240, maxWidth = 960, minRight = 240, hidden = false, className = "history-split", children }: SplitPaneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(() => readStored(storageKey));
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; current: number } | null>(null);

  /** 左栏当前宽度：拖过的用存值，没拖过就按 CSS 默认量一次真实几何（比例默认也能量准）。 */
  const leftWidth = useCallback(() => {
    if (width != null) return width;
    const first = ref.current?.querySelector<HTMLElement>(":scope > *");
    return first ? first.getBoundingClientRect().width : minWidth;
  }, [width, minWidth]);

  const clamp = useCallback((w: number, containerWidth: number) => {
    const upper = Math.min(maxWidth, containerWidth > 0 ? containerWidth - minRight : maxWidth);
    return Math.max(minWidth, Math.min(Math.max(minWidth, upper), w));
  }, [minWidth, maxWidth, minRight]);

  // 容器变窄（窗口缩放 / 切空间）时把存量宽度重新夹回合法区间：拖出来的宽度不能反过来把预览挤没。
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setWidth((prev) => (prev == null ? prev : clamp(prev, el.getBoundingClientRect().width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [clamp]);

  const commit = useCallback((next: number | null) => {
    setWidth(next);
    try {
      if (next == null) localStorage.removeItem(KEY_PREFIX + storageKey);
      else localStorage.setItem(KEY_PREFIX + storageKey, String(Math.round(next)));
    } catch { /* 配额/隐私模式：记不住也不影响本次会话 */ }
  }, [storageKey]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = leftWidth();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: start, current: start };
    setResizing(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clamp(drag.startWidth + (event.clientX - drag.startX), ref.current?.getBoundingClientRect().width ?? 0);
    drag.current = next;
    setWidth(next);
  };
  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setResizing(false);
    commit(drag.current);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? STEP_LARGE : STEP;
    const container = ref.current?.getBoundingClientRect().width ?? 0;
    const current = leftWidth();
    let next: number;
    if (event.key === "ArrowLeft") next = clamp(current - step, container);
    else if (event.key === "ArrowRight") next = clamp(current + step, container);
    else if (event.key === "Home") next = clamp(minWidth, container);
    else if (event.key === "End") next = clamp(maxWidth, container);
    else return;
    event.preventDefault();
    commit(next);
  };

  const style = (hidden || width != null)
    ? ({ display: hidden ? "none" : undefined, "--split-left": width != null ? width + "px" : undefined } as CSSProperties)
    : undefined;

  // ⚠️ 把手必须**夹在两个面板之间**（零宽 flex 项）：挂在末尾会被排到行尾（实测落在容器右缘，根本拖不到）。
  const [leftPane, rightPane] = Children.toArray(children);
  const handle = (
    <div className="ln-split-handle" role="separator" aria-label={ariaLabel} aria-orientation="vertical"
      aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={width != null ? Math.round(width) : undefined}
      tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishResize}
      onPointerCancel={finishResize} onKeyDown={onKeyDown} onDoubleClick={() => commit(null)} />
  );

  return (
    <div ref={ref} className={className + (resizing ? " is-resizing" : "")} style={style}>
      {leftPane}
      {handle}
      {rightPane}
    </div>
  );
}
