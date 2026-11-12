/**
 * 手写板「页面」面板（261104 二十六批；用户第二轮修正：左侧悬浮覆盖，不移动编辑区）。
 *
 * 口径（用户 261104 定稿）：一个入口、左侧悬浮**覆盖**编辑区（覆盖才叫悬浮，不移动画布、不可固定）。
 *  - 缩略图 = 纯预览 + 页编辑（删除 / 新建页；无筛选、无摘要），预览更大（2 列）；
 *  - 大纲   = 列表 + 筛选（全部/批注/页签）+ 查找（只搜页签文字与页码）；
 *            页签编辑不在这里，走底栏「页签」独立按钮（InkPageTabButton）。
 * 跳页控件在头部（与视图 tab 同一行）；滚动 + 页码直跳，不做分页条。
 *
 * 面板宽度可拖（右侧边缘 8px 手柄，min 280 / max 560），宽度记在设备本地 localStorage（不写正文）。
 *
 * 桌面专属控件，单独成文件：跨端样式护栏（crossEndClassCoverage）要求共享组件发出的类名两端都有样式，
 * 而移动端没有这个面板（底部坞 7 键定稿）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { LayoutGrid, ListTree, Plus, Trash2, X } from "lucide-react";
import type { InkPage } from "../../core/inkDoc.js";
import { PageThumb } from "./InkPageStrip.js";
import { INK_OUTLINE_MODES, INK_OUTLINE_MODE_LABELS, buildInkOutline, filterInkOutline, inkOutlineSummary, type InkOutlineMode } from "./inkOutline.js";
import { createLongPressTimer, type LongPressTimer } from "../../lib/longPressTimer";

export type InkPagesView = "thumbs" | "list";

/** 面板宽度：设备本地视图状态（与 inkNav / 表格导航同口径：不进正文、不标脏、不进 S3）。 */
export const INK_PAGES_PANEL_WIDTH_KEY = "lakex-local-notes-v3.ink-pages-panel";
export const INK_PAGES_PANEL_WIDTH_DEFAULT = 360;
export const INK_PAGES_PANEL_WIDTH_MIN = 320; // 顶栏刚好一行 + 2 列预览，向上取整
export const INK_PAGES_PANEL_WIDTH_MAX = 560;

/** 把拖出来的宽度夹进 [min, max] 且不超出视口（留 80px 给画布）。 */
export function clampPagesPanelWidth(width: number, viewportWidth: number): number {
  const maxByViewport = Math.max(INK_PAGES_PANEL_WIDTH_MIN, viewportWidth - 80);
  const max = Math.min(INK_PAGES_PANEL_WIDTH_MAX, maxByViewport);
  const value = Number.isFinite(width) ? width : INK_PAGES_PANEL_WIDTH_DEFAULT;
  return Math.round(Math.min(max, Math.max(INK_PAGES_PANEL_WIDTH_MIN, value)));
}

/** 读设备本地记住的宽度（坏值/无存储回退默认值，绝不抛错）。 */
export function readPagesPanelWidth(storage?: Pick<Storage, "getItem">): number {
  try {
    const store = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    const raw = store?.getItem(INK_PAGES_PANEL_WIDTH_KEY);
    const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return clampPagesPanelWidth(value, typeof window === "undefined" ? 1280 : window.innerWidth);
  } catch {
    return INK_PAGES_PANEL_WIDTH_DEFAULT;
  }
}

/** 记住宽度（失败静默：存储不可用不影响面板使用）。 */
export function writePagesPanelWidth(width: number, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? (typeof localStorage === "undefined" ? undefined : localStorage))?.setItem(INK_PAGES_PANEL_WIDTH_KEY, String(width));
  } catch {
    /* 忽略 */
  }
}

export interface InkPagesPanelProps {
  open: boolean;
  view: InkPagesView;
  onViewChange: (view: InkPagesView) => void;
  pages: readonly InkPage[];
  currentPageId?: string;
  readOnly: boolean;
  pendingDeleteId: string | null;
  onJump: (pageId: string) => void;
  onAdd: () => void;
  /** 长按拖拽排序：把 pageId 移到 toIndex（= 移除后数组下标）。 */
  onReorder: (pageId: string, toIndex: number) => void;
  onRequestDelete: (pageId: string) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onClose: () => void;
}


/** 长按拖拽的落点换算：slot = 悬停格的插入槽位（0..total），返回「移除 drag 项之后」的目标下标。 */
export function dropTargetIndex(fromIndex: number, slot: number, total: number): number {
  const n = Math.max(0, total);
  const from = Math.max(0, Math.min(n - 1, fromIndex));
  const clamped = Math.max(0, Math.min(n, slot));
  return Math.max(0, Math.min(n - 1, clamped > from ? clamped - 1 : clamped));
}
function PageJump({ total, onJump }: { total: number; onJump: (pageNumber: number) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="ink-pages-panel__jump"
      onSubmit={(event) => {
        event.preventDefault();
        const value = Number.parseInt(draft, 10);
        if (!Number.isFinite(value)) return;
        onJump(Math.min(total, Math.max(1, value)));
        setDraft("");
      }}
    >
      <label htmlFor="ink-pages-jump">跳至</label>
      <input
        id="ink-pages-jump"
        className="ink-pages-panel__jump-input"
        inputMode="numeric"
        value={draft}
        placeholder={String(total)}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
        aria-label="跳至第几页（回车确认）"
      />
      <span>页</span>
    </form>
  );
}

export function InkPagesPanel(props: InkPagesPanelProps) {
  const {
    open, view, onViewChange, pages, currentPageId, readOnly, pendingDeleteId,
    onJump, onAdd, onReorder, onRequestDelete, onConfirmDelete, onCancelDelete, onClose,
  } = props;
  const [mode, setMode] = useState<InkOutlineMode>("all");
  const [width, setWidth] = useState<number>(() => readPagesPanelWidth());
  const [query, setQuery] = useState("");
  const [drag, setDrag] = useState<{ id: string; from: number; slot: number } | null>(null);
  /** 本格子所属页（长按到点后据此进入拖拽；计时本身交给唯一实现 lib/longPressTimer）。 */
  const pressMetaRef = useRef<{ pageId: string; index: number } | null>(null);
  const pressTimerRef = useRef<LongPressTimer | null>(null);
  const firePress = useCallback(() => {
    const meta = pressMetaRef.current;
    pressMetaRef.current = null;
    if (!meta) return;
    setDrag({ id: meta.pageId, from: meta.index, slot: meta.index });
  }, []);
  /** 300ms / 8px 与旧手写实现参数一致；到点只置拖拽态，随后的一次 click 由 consumeClickSuppression 吞掉。 */
  const pressTimer = useCallback(
    () => (pressTimerRef.current ??= createLongPressTimer({ ms: 300, moveCancelPx: 8, onFire: firePress })),
    [firePress],
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const outlinePages = useMemo(() => pages.map((page) => ({
    id: page.id,
    strokeCount: page.strokes.length,
    hasBackgroundImage: Boolean(page.backgroundImage),
    ...(page.note !== undefined ? { note: page.note } : {}),
  })), [pages]);
  const entries = useMemo(() => filterInkOutline(buildInkOutline(outlinePages, mode), query), [outlinePages, mode, query]);
  const summary = useMemo(() => inkOutlineSummary(outlinePages), [outlinePages]);

  /** 缩略图长按 300ms 进入拖拽（移动 8px 内取消，避免和点击跳页打架；取消/抬手/卸载由 lib/longPressTimer 收口）。 */
  const onCellPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, pageId: string, index: number) => {
    if (readOnly) return;
    if ((event.target as Element | null)?.closest?.('.ink-pages-panel__cell-del')) return;
    pressMetaRef.current = { pageId, index };
    pressTimer().start({ clientX: event.clientX, clientY: event.clientY }, event.target);
  }, [pressTimer, readOnly]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => pressTimer().move({ clientX: event.clientX, clientY: event.clientY });
    const onUp = () => pressTimer().end();
    const onCancel = () => pressTimer().cancel();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [pressTimer]);

  /** 卸载即 dispose（长按计时器不跨实例复用）。 */
  useEffect(() => () => {
    pressTimerRef.current?.dispose();
    pressTimerRef.current = null;
  }, []);

  // 拖拽中：跟着指针找悬停格，算出插入槽位；松手提交一次（不进正文之外的状态）。 */
  useEffect(() => {
    if (!drag || view !== 'thumbs') return;
    const onMove = (event: PointerEvent) => {
      const hit = typeof document.elementFromPoint === "function" ? document.elementFromPoint(event.clientX, event.clientY) : null;
      const el = hit?.closest?.('[data-page-id]') as HTMLElement | null;
      const id = el?.getAttribute('data-page-id');
      if (!id) return;
      const hovered = pages.findIndex((page) => page.id === id);
      if (hovered < 0) return;
      const rect = el!.getBoundingClientRect();
      const slot = hovered + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
      setDrag((current) => (current ? { ...current, slot } : current));
    };
    const onUp = () => {
      setDrag((current) => {
        if (current) {
          const toIndex = dropTargetIndex(current.from, current.slot, pages.length);
          if (toIndex !== current.from) onReorder(current.id, toIndex);
        }
        return null;
      });
      // 没被 click 消费掉的「已触发」标记在下一轮事件后清掉（与旧实现同时序）；
      // 用 ref 直取：卸载后这个 0ms 回调仍可能跑，不能在此重新创建计时器。
      window.setTimeout(() => { pressTimerRef.current?.consumeClickSuppression(); }, 0);
    };
    const onCancel = () => { setDrag(null); pressTimer().consumeClickSuppression(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [drag, onReorder, pages, pressTimer, view]);

  const dropIndex = drag ? dropTargetIndex(drag.from, drag.slot, pages.length) : -1;
  const pendingIndex = pendingDeleteId ? pages.findIndex((page) => page.id === pendingDeleteId) : -1;

  useEffect(() => {
    if (!open || !currentPageId) return;
    const container = view === "list" ? listRef.current : gridRef.current;
    const node = container?.querySelector<HTMLElement>('[data-page-id="' + currentPageId + '"]');
    if (!container || !node) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const above = nodeRect.top - containerRect.top;
    const below = nodeRect.bottom - containerRect.bottom;
    if (above < 0) container.scrollTop = Math.max(0, container.scrollTop + above - 8);
    else if (below > 0) container.scrollTop = container.scrollTop + below + 8;
  }, [open, view, currentPageId, entries.length]);

  /** 右侧边缘拖宽：拖动只改内存 + 松手落盘（设备本地），不写正文、不标脏。 */
  const startResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: PointerEvent) => {
      setWidth(clampPagesPanelWidth(startWidth + (moveEvent.clientX - startX), window.innerWidth));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setWidth((value) => { writePagesPanelWidth(value); return value; });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [width]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const jumpToNumber = (pageNumber: number) => {
    const target = pages[pageNumber - 1];
    if (target) onJump(target.id);
  };

  return (
    <div className="ink-pages-panel" role="dialog" aria-label="页面" data-ink-pages-panel style={{ width: width + "px" }}>
      <div className="ink-pages-panel__head">
        <div className="ink-pages-panel__tabs" role="tablist" aria-label="视图">
          <button
            role="tab"
            aria-selected={view === "thumbs"}
            className={["ink-pages-panel__tab", view === "thumbs" ? "is-active" : ""].join(" ")}
            onClick={() => onViewChange("thumbs")}
          ><LayoutGrid size={15} />缩略图</button>
          <button
            role="tab"
            aria-selected={view === "list"}
            className={["ink-pages-panel__tab", view === "list" ? "is-active" : ""].join(" ")}
            onClick={() => onViewChange("list")}
          ><ListTree size={15} />大纲</button>
        </div>
        <div className="ink-pages-panel__head-right">
          <PageJump total={pages.length} onJump={jumpToNumber} />
          <button className="ink-pages-panel__close" onClick={onClose} aria-label="关闭页面" title="关闭"><X size={16} /></button>
        </div>
      </div>

      {view === "list" && (
        <>
          <div className="ink-pages-panel__filters">
            <div className="ink-pages-panel__chips" role="group" aria-label="筛选">
              {INK_OUTLINE_MODES.map((value) => (
                <button
                  key={value}
                  className={["ink-pages-panel__chip", mode === value ? "is-active" : ""].join(" ")}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >{INK_OUTLINE_MODE_LABELS[value]}</button>
              ))}
            </div>
            <span className="ink-pages-panel__summary" data-ink-pages-summary>{summary}</span>
          </div>
          <div className="ink-pages-panel__search">
            <input
              className="ink-pages-panel__search-input"
              value={query}
              placeholder="查找页签文字或页码"
              aria-label="查找页签文字或页码"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="ink-pages-panel__list" role="list" ref={listRef}>
            {entries.length === 0 && (
              <p className="ink-pages-panel__empty">
                {query.trim()
                  ? "没有匹配的页签或页码"
                  : mode === "tabbed"
                    ? "还没有页签：点底栏「页签」按钮，可以写一句说明或直接打标记"
                    : "还没有批注，翻页画几笔就会出现"}
              </p>
            )}
            {entries.map((entry) => (
              <button
                key={entry.pageId}
                role="listitem"
                data-page-id={entry.pageId}
                className={["ink-pages-panel__row", entry.pageId === currentPageId ? "is-current" : ""].join(" ")}
                onClick={() => onJump(entry.pageId)}
              >
                <span className="ink-pages-panel__row-page">第 {entry.pageNumber} 页</span>
                <span className="ink-pages-panel__row-meta">
                  {entry.strokeCount > 0 ? entry.strokeCount + " 笔" : entry.hasBackgroundImage ? "页图" : "空白"}
                </span>
                {entry.hasTab ? (
                  <span className="ink-pages-panel__row-tab" title={entry.note ?? "纯标记"}>
                    {entry.note ? entry.note : "页签"}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      )}

      {view === "thumbs" && (
        <div className="ink-pages-panel__grid" ref={gridRef} data-dragging={drag ? "true" : undefined} onClickCapture={(event) => { if (!pressTimer().consumeClickSuppression()) return; event.preventDefault(); event.stopPropagation(); }}>
          {pages.map((page, index) => {
            const tab = page.note !== undefined;
            return (
              <div
                key={page.id}
                data-page-id={page.id}
                onPointerDown={(event) => onCellPointerDown(event, page.id, index)}
                className={["ink-pages-panel__cell", page.id === currentPageId ? "is-current" : "", drag?.id === page.id ? "is-dragging" : "", drag && dropIndex === index && drag.id !== page.id ? "is-drop-target" : ""].join(" ")}
              >
                <button
                  className="ink-pages-panel__cell-paper"
                  data-background={page.background}
                  onClick={() => onJump(page.id)}
                  aria-label={"打开第 " + (index + 1) + " 页"}
                  aria-current={page.id === currentPageId ? "page" : undefined}
                >
                  <PageThumb page={page} />
                  <span className="ink-pages-panel__cell-index">{index + 1}</span>
                  {tab ? <span className="ink-pages-panel__cell-tab" aria-label={page.note ? "有页签" : "有页签（纯标记）"} /> : null}
                </button>
                <button
                  className="ink-pages-panel__cell-del"
                  onClick={() => onRequestDelete(page.id)}
                  disabled={readOnly || pages.length <= 1}
                  aria-label={"删除第 " + (index + 1) + " 页"}
                  title="删除页"
                ><Trash2 size={13} /></button>
              </div>
            );
          })}
          <button className="ink-pages-panel__add" onClick={onAdd} disabled={readOnly} aria-label="新建页" title="新建页"><Plus size={16} />新建页</button>
        </div>
      )}

      {/* 右侧 8px 拖宽手柄（动态几何只能内联；拖动期间不落盘，松手记一次） */}
      <span
        className="ink-pages-panel__resize"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整页面面板宽度"
        title="拖动调整宽度"
      />

      {pendingDeleteId && pendingIndex >= 0 && (
        <div className="ink-pages-panel__confirm" role="alertdialog" aria-label={"确认删除第 " + (pendingIndex + 1) + " 页"}>
          <span>删除第 {pendingIndex + 1} 页？</span>
          <button onClick={onCancelDelete}>取消</button>
          <button className="is-danger" onClick={onConfirmDelete}>删除</button>
        </div>
      )}
    </div>
  );
}

export default InkPagesPanel;
