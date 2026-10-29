import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { EditorCaptureHandler } from "../../core/editorCapture";
import { ChevronLeft, ChevronRight, Eraser, Highlighter, LayoutGrid, Minus, Pen, Plus, Redo2, Undo2 } from "lucide-react";
import { COLOR_BOARD_GROUPS, QUICK_TEXT_COLORS } from "../../core/colorPalette.js";
import {
  createInkPage,
  inkToBody,
  parseInkBody,
  type InkBackground,
  type InkDoc,
  type InkPage,
  type InkPoint,
  type InkStroke,
  type InkTool,
} from "../../core/inkDoc.js";
import { canonicalDocBody } from "../../core/docBaseline.js";
import { hitTestStroke, strokeToSvgPath } from "./inkGeometry.js";
import {
  applyInkPatch,
  inkOrderDelta,
  inkPagePatch,
  pushBoundedHistory,
  type InkHistoryEntry,
  type InkPatch,
} from "./history.js";
import { InkPaper } from "./InkPaper.js";
import InkPageStrip from "./InkPageStrip.js";

export type InkPadMode = InkTool | "eraser";

export interface InkPadProps {
  content: string;
  readOnly?: boolean;
  variant: "desktop" | "mobile";
  active?: boolean;
  paneVisible?: boolean;
  pane?: "left" | "right" | null;
  onChange?: (content: string) => void;
  onDirty?: () => void;
  onEditorCapture?: EditorCaptureHandler;
}

const SAVE_DEBOUNCE_MS = 500;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const COLORS = [COLOR_BOARD_GROUPS[0][1], ...QUICK_TEXT_COLORS] as const;
const WIDTHS = [1.5, 2.5, 4, 6] as const;
const BACKGROUNDS: ReadonlyArray<{ value: InkBackground; label: string }> = [
  { value: "blank", label: "空白" },
  { value: "lined", label: "横线" },
  { value: "grid", label: "网格" },
  { value: "dot", label: "点阵" },
];

function newId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pointFromClient(clientX: number, clientY: number, pointerType: string, pressure: number, rect: DOMRect, page: InkPage): InkPoint {
  const x = rect.width > 0 ? ((clientX - rect.left) / rect.width) * page.width : 0;
  const y = rect.height > 0 ? ((clientY - rect.top) / rect.height) * page.height : 0;
  const rawPressure = pointerType === "pen" ? pressure : 0.5;
  return {
    x: Math.min(page.width, Math.max(0, x)),
    y: Math.min(page.height, Math.max(0, y)),
    pressure: Number.isFinite(rawPressure) && rawPressure > 0 ? Math.min(1, rawPressure) : 0.5,
  };
}

function replacePage(doc: InkDoc, page: InkPage): InkDoc {
  return { ...doc, pages: doc.pages.map((item) => (item.id === page.id ? page : item)) };
}

interface RenderedStrokePath {
  id: string;
  d: string;
  color: string;
  highlighter: boolean;
}

/** 静态笔迹层：只在页面内容变化时重渲染；正在书写时不会 reconcile 全部历史路径。 */
const StaticStrokeLayer = memo(function StaticStrokeLayer({ strokes }: { strokes: RenderedStrokePath[] }) {
  return (
    <>
      {strokes.map((stroke) => (
        <path
          key={stroke.id}
          d={stroke.d}
          fill={stroke.color}
          opacity={stroke.highlighter ? 0.3 : 1}
          style={stroke.highlighter ? { mixBlendMode: "multiply" } : undefined}
        />
      ))}
    </>
  );
});

export function InkPad({ content, readOnly = false, variant, active, paneVisible, pane, onChange, onDirty, onEditorCapture }: InkPadProps) {
  // 正文只在挂载时解析；父层保存会更新 content，但编辑器不应因此反复解析整份大 JSON。
  // 外部真正需要换正文时由宿主 bump reloadKey 重挂载。
  const [doc, setDoc] = useState<InkDoc | null>(() => parseInkBody(content));
  const docRef = useRef<InkDoc | null>(doc);
  const [mode, setMode] = useState<InkPadMode>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [penWidth, setPenWidth] = useState<number>(WIDTHS[1]);
  const [highlighterWidth, setHighlighterWidth] = useState<number>(18);
  const [zoom, setZoom] = useState(1);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [pendingDeletePageId, setPendingDeletePageId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);
  const [activeStroke, setActiveStroke] = useState<InkStroke | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 撤销/重做只存页级补丁；整篇正文序列化只用于保存。
  const undoRef = useRef<InkHistoryEntry[]>([]);
  const redoRef = useRef<InkHistoryEntry[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveBodyRef = useRef<string | null>(null);
  const activePointerRef = useRef<{ id: number; type: string } | null>(null);
  const penDownRef = useRef(false);
  const activeStrokeRef = useRef<InkStroke | null>(null);
  const eraseBeforeRef = useRef<InkPage | null>(null);
  const erasedIdsRef = useRef<Set<string>>(new Set());
  const lastPointRef = useRef<InkPoint | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const onEditorCaptureRef = useRef(onEditorCapture);
  onEditorCaptureRef.current = onEditorCapture;

  /** 打开时的磁盘原文（CORE-03 基线）：保存/捕获在「与磁盘等价」时原样返回它，不写盘。 */
  const diskBodyRef = useRef(content);
  /** 磁盘原文的规范形态：惰性算一次。 */
  const diskCanonicalRef = useRef<string | null | undefined>(undefined);
  /**
   * 当前正文与磁盘原文是否等价（CORE-03：打开后未动 / 撤销回原样）。
   * body 一律由 inkToBody 产出（同一规范形态）⇒ 与磁盘原文的规范形态逐字节相等即 core 判据的结论；
   * 盘上原文非规范（缺 activePageId / 坐标被 clamp 过）时同样判等价，不为一处格式差异写盘。
   * 缓存磁盘侧的规范形态：正文可达 10 MiB，不能每次保存都把两侧整篇解析一遍（CORE-07）。
   */
  const sameAsDisk = useCallback((body: string): boolean => {
    if (diskCanonicalRef.current === undefined) {
      diskCanonicalRef.current = canonicalDocBody("ink", diskBodyRef.current);
    }
    return diskCanonicalRef.current !== null && diskCanonicalRef.current === body;
  }, []);

  const page = useMemo(() => {
    if (!doc) return null;
    return doc.pages.find((item) => item.id === doc.activePageId) ?? doc.pages[0] ?? null;
  }, [doc]);
  const pageIndex = doc && page ? doc.pages.findIndex((item) => item.id === page.id) : -1;
  const pageWidth = page?.width ?? 0;
  const pageHeight = page?.height ?? 0;

  useLayoutEffect(() => {
    if (pageWidth <= 0 || pageHeight <= 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const style = getComputedStyle(stage);
      const padX = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const padY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
      const availWidth = Math.max(1, stage.clientWidth - padX);
      const availHeight = Math.max(1, stage.clientHeight - padY);
      const ratio = pageWidth / pageHeight;
      const height = Math.min(availHeight, availWidth / ratio);
      setFitSize((previous) => {
        const width = height * ratio;
        if (previous && Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5) return previous;
        return { width, height };
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [pageHeight, pageWidth]);
  const canUndo = historyVersion >= 0 && undoRef.current.length > 0;
  const canRedo = historyVersion >= 0 && redoRef.current.length > 0;
  const zoomIn = useCallback(() => setZoom((value) => Math.min(ZOOM_MAX, Math.round((value + ZOOM_STEP) * 100) / 100)), []);
  const zoomOut = useCallback(() => setZoom((value) => Math.max(ZOOM_MIN, Math.round((value - ZOOM_STEP) * 100) / 100)), []);

  const serializeDoc = useCallback((value: InkDoc): string | null => {
    try {
      const body = inkToBody(value);
      setSaveError(null);
      return body;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "手写板正文无法保存");
      return null;
    }
  }, []);

  const scheduleSaveBody = useCallback((body: string) => {
    // CORE-03：与磁盘原文等价（打开后未动 / 撤销回原样）⇒ 不标脏、不排保存
    // （只丢弃这次待写的规范化差异；绝不丢笔迹 —— 等价 = 正文与磁盘逐字节同内容）。
    if (sameAsDisk(body)) {
      pendingSaveBodyRef.current = null;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      return;
    }
    onDirtyRef.current?.();
    pendingSaveBodyRef.current = body;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingSaveBodyRef.current;
      pendingSaveBodyRef.current = null;
      if (pending !== null) onChangeRef.current?.(pending);
    }, SAVE_DEBOUNCE_MS);
  }, [sameAsDisk]);

  const flushSave = useCallback(() => {
    const hadPending = saveTimerRef.current !== null;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveBodyRef.current;
    pendingSaveBodyRef.current = null;
    // CORE-03：落盘前再判一次等价（撤销回原样 / 打开后没动）⇒ 不写盘。
    if (hadPending && pending !== null && !sameAsDisk(pending)) onChangeRef.current?.(pending);
  }, [sameAsDisk]);

  /** patch=null 表示这次改动不进入撤销栈（没有历史语义）。 */
  const commit = useCallback((next: InkDoc, patch: InkPatch | null) => {
    if (readOnly || !docRef.current) return;
    const nextBody = serializeDoc(next);
    if (nextBody === null) return;
    if (patch) {
      pushBoundedHistory(undoRef.current, patch);
      redoRef.current = [];
    }
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSaveBody(nextBody);
  }, [readOnly, scheduleSaveBody, serializeDoc]);

  const undo = useCallback(() => {
    const entry = undoRef.current[undoRef.current.length - 1];
    if (!entry || !docRef.current) return;
    const next = applyInkPatch(docRef.current, entry.patch, "undo");
    const nextBody = serializeDoc(next);
    if (nextBody === null) return;
    undoRef.current.pop();
    pushBoundedHistory(redoRef.current, entry.patch);
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSaveBody(nextBody);
  }, [scheduleSaveBody, serializeDoc]);

  const redo = useCallback(() => {
    const entry = redoRef.current[redoRef.current.length - 1];
    if (!entry || !docRef.current) return;
    const next = applyInkPatch(docRef.current, entry.patch, "redo");
    const nextBody = serializeDoc(next);
    if (nextBody === null) return;
    redoRef.current.pop();
    pushBoundedHistory(undoRef.current, entry.patch);
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSaveBody(nextBody);
  }, [scheduleSaveBody, serializeDoc]);

  useEffect(() => {
    onEditorCaptureRef.current?.(() => {
      const current = docRef.current;
      if (!current) return null;
      try {
        const body = inkToBody(current);
        // CORE-03：与磁盘原文等价 ⇒ 返回磁盘原文（打开后没动 / 改过又改回原样都不产生写盘）。
        return sameAsDisk(body) ? diskBodyRef.current : body;
      } catch { return null; }
    });
    return () => {
      onEditorCaptureRef.current?.(null);
      flushSave();
    };
  }, [flushSave, sameAsDisk]);

  useEffect(() => {
    if (!doc || !page) return;
    if (doc.activePageId !== page.id) {
      const next = { ...doc, activePageId: page.id };
      docRef.current = next;
      setDoc(next);
    }
  }, [doc, page]);

  const addPage = useCallback(() => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const nextPage = createInkPage(newId("page"), "blank");
    const next = { ...current, pages: [...current.pages, nextPage], activePageId: nextPage.id };
    const patch: InkPatch = inkPagePatch(null, nextPage);
    const order = inkOrderDelta(current.pages, next.pages);
    if (order) patch.order = order;
    commit(next, patch);
  }, [commit, readOnly]);

  const selectPage = useCallback((id: string) => {
    const current = docRef.current;
    if (!current || !current.pages.some((item) => item.id === id)) return;
    // activePageId 是纯视图字段，不进 patch；切页不产生撤销步骤。
    const updated = { ...current, activePageId: id };
    docRef.current = updated;
    setDoc(updated);
    if (!readOnly) {
      const body = serializeDoc(updated);
      if (body !== null) scheduleSaveBody(body);
    }
  }, [readOnly, scheduleSaveBody, serializeDoc]);

  const movePage = useCallback((id: string, delta: -1 | 1) => {
    const current = docRef.current;
    if (!current || readOnly) return;
    const index = current.pages.findIndex((item) => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= current.pages.length) return;
    const pages = [...current.pages];
    const [moved] = pages.splice(index, 1);
    pages.splice(target, 0, moved);
    const order = inkOrderDelta(current.pages, pages);
    commit({ ...current, pages }, order ? { pages: [], order } : null);
  }, [commit, readOnly]);

  const requestDeletePage = useCallback((id: string) => {
    if (readOnly) return;
    setPendingDeletePageId(id);
  }, [readOnly]);

  const confirmDeletePage = useCallback(() => {
    const current = docRef.current;
    const id = pendingDeletePageId;
    if (!current || !id || readOnly || current.pages.length <= 1) return;
    const index = current.pages.findIndex((item) => item.id === id);
    if (index < 0) { setPendingDeletePageId(null); return; }
    const removed = current.pages[index];
    const pages = current.pages.filter((item) => item.id !== id);
    const activePageId = current.activePageId === id
      ? pages[Math.max(0, index - 1)]?.id ?? pages[0]?.id
      : current.activePageId;
    setPendingDeletePageId(null);
    const patch: InkPatch = inkPagePatch(removed, null);
    const order = inkOrderDelta(current.pages, pages);
    if (order) patch.order = order;
    commit({ ...current, pages, activePageId }, patch);
  }, [commit, pendingDeletePageId, readOnly]);

  const switchPage = useCallback((delta: number) => {
    const current = docRef.current;
    if (!current) return;
    const index = current.pages.findIndex((item) => item.id === current.activePageId);
    const next = current.pages[Math.max(0, Math.min(current.pages.length - 1, index + delta))];
    if (!next || next.id === current.activePageId) return;
    selectPage(next.id);
  }, [selectPage]);

  const setBackground = useCallback((background: InkBackground) => {
    const current = docRef.current;
    if (!current || !page || readOnly) return;
    const before = current.pages.find((item) => item.id === page.id);
    if (!before) return;
    const nextPage = { ...before, background };
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, page, readOnly]);

  const finishStroke = useCallback(() => {
    const stroke = activeStrokeRef.current;
    const current = docRef.current;
    if (!stroke || !current || !page) return;
    const before = current.pages.find((item) => item.id === page.id);
    if (!before) return;
    const nextPage = { ...before, strokes: [...before.strokes, stroke] };
    activeStrokeRef.current = null;
    setActiveStroke(null);
    commit(replacePage(current, nextPage), inkPagePatch(before, nextPage));
  }, [commit, page]);

  const eraseAt = useCallback((point: InkPoint) => {
    const current = docRef.current;
    if (!current || !page) return;
    const hits = page.strokes.filter((stroke) => !erasedIdsRef.current.has(stroke.id) && hitTestStroke(stroke, point));
    if (hits.length === 0) return;
    for (const stroke of hits) erasedIdsRef.current.add(stroke.id);
    const nextPage = { ...page, strokes: page.strokes.filter((stroke) => !erasedIdsRef.current.has(stroke.id)) };
    const next = replacePage(current, nextPage);
    docRef.current = next;
    setDoc(next);
  }, [page]);

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || !docRef.current || !page) return;
    if (event.button !== 0) return;
    if (event.pointerType === "pen") {
      penDownRef.current = true;
    } else if (penDownRef.current) {
      return; // 掌托/手指在笔落下期间不参与书写
    }
    if (activePointerRef.current) return;
    activePointerRef.current = { id: event.pointerId, type: event.pointerType };
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromClient(event.clientX, event.clientY, event.pointerType, event.pressure, event.currentTarget.getBoundingClientRect(), page);
    lastPointRef.current = point;
    if (mode === "eraser") {
      eraseBeforeRef.current = page;
      erasedIdsRef.current = new Set();
      eraseAt(point);
      return;
    }
    const stroke: InkStroke = {
      id: newId("stroke"),
      tool: mode,
      color,
      width: mode === "highlighter" ? highlighterWidth : penWidth,
      points: [point],
    };
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  }, [color, eraseAt, highlighterWidth, mode, page, penWidth, readOnly]);

  const appendPoint = useCallback((point: InkPoint) => {
    const current = activeStrokeRef.current;
    if (!current) return;
    const previous = lastPointRef.current;
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.35) return;
    lastPointRef.current = point;
    const next = { ...current, points: [...current.points, point] };
    activeStrokeRef.current = next;
    setActiveStroke(next);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (!page || activePointerRef.current?.id !== event.pointerId) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const source = events.length > 0 ? events : [event.nativeEvent];
    const rect = event.currentTarget.getBoundingClientRect();
    if (mode === "eraser") {
      for (const sourceEvent of source) {
        eraseAt(pointFromClient(sourceEvent.clientX, sourceEvent.clientY, event.pointerType, sourceEvent.pressure, rect, page));
      }
      return;
    }
    for (const sourceEvent of source) {
      appendPoint(pointFromClient(sourceEvent.clientX, sourceEvent.clientY, event.pointerType, sourceEvent.pressure, rect, page));
    }
  }, [appendPoint, eraseAt, mode, page]);

  const finishPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (activePointerRef.current?.id !== event.pointerId) return;
    activePointerRef.current = null;
    if (mode === "eraser") {
      const before = eraseBeforeRef.current;
      const current = docRef.current;
      const erased = erasedIdsRef.current.size > 0;
      eraseBeforeRef.current = null;
      erasedIdsRef.current = new Set();
      const erasedPage = before && current ? current.pages.find((item) => item.id === before.id) : undefined;
      if (before && current && erasedPage && erased) {
        commit(current, inkPagePatch(before, erasedPage));
      }
    } else {
      finishStroke();
    }
    if (event.pointerType === "pen") penDownRef.current = false;
  }, [commit, finishStroke, mode]);

  const cancelPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (activePointerRef.current?.id !== event.pointerId) return;
    activePointerRef.current = null;
    if (event.pointerType === "pen") penDownRef.current = false;
    activeStrokeRef.current = null;
    setActiveStroke(null);
    eraseBeforeRef.current = null;
    erasedIdsRef.current = new Set();
  }, []);

  const activePath = useMemo(() => activeStroke ? strokeToSvgPath(activeStroke, false) : null, [activeStroke]);
  const renderedStrokes = useMemo<RenderedStrokePath[]>(() => {
    if (!page) return [];
    return page.strokes.map((stroke) => ({
      id: stroke.id,
      d: strokeToSvgPath(stroke, true),
      color: stroke.color,
      highlighter: stroke.tool === "highlighter",
    }));
  }, [page]);

  if (!doc || !page) {
    return (
      <div className={"ink-pad ink-pad--invalid"} data-readonly="true">
        <div className="ink-invalid-banner">手写板正文无法解析，已进入只读保护。请从历史版本恢复或重命名/导出后重建。</div>
      </div>
    );
  }

  return (
    <div
      className={"ink-pad ink-pad--" + variant}
      data-readonly={readOnly ? "true" : undefined}
      data-prevent-swipe
      data-active={active ? "true" : undefined}
      data-pane-visible={paneVisible ? "true" : undefined}
      data-pane={pane ?? undefined}
    >
      <div className="ink-toolbar" role="toolbar" aria-label="手写工具">
        <button className={["ink-tool", mode === "pen" ? "is-active" : ""].join(" ")} onClick={() => setMode("pen")} aria-label="画笔" title="画笔" disabled={readOnly}><Pen size={16} /></button>
        <button className={["ink-tool", mode === "highlighter" ? "is-active" : ""].join(" ")} onClick={() => setMode("highlighter")} aria-label="高亮笔" title="高亮笔" disabled={readOnly}><Highlighter size={16} /></button>
        <button className={["ink-tool", mode === "eraser" ? "is-active" : ""].join(" ")} onClick={() => setMode("eraser")} aria-label="整笔橡皮" title="整笔橡皮" disabled={readOnly}><Eraser size={16} /></button>
        <span className="ink-toolbar__sep" />
        {COLORS.map((value) => (
          <button
            key={value}
            className={["ink-color", color === value ? "is-active" : ""].join(" ")}
            style={{ backgroundColor: value }}
            onClick={() => { setColor(value); if (mode === "eraser") setMode("pen"); }}
            aria-label={`颜色 ${value}`}
            title={`颜色 ${value}`}
            disabled={readOnly}
          />
        ))}
        <span className="ink-toolbar__sep" />
        {WIDTHS.map((value) => (
          <button
            key={value}
            className={["ink-width", (mode === "highlighter" ? highlighterWidth : penWidth) === value ? "is-active" : ""].join(" ")}
            onClick={() => mode === "highlighter" ? setHighlighterWidth(value) : setPenWidth(value)}
            aria-label={`笔宽 ${value}`}
            title={`笔宽 ${value}`}
            disabled={readOnly}
          ><span style={{ width: Math.max(4, value * 2), height: Math.max(4, value * 2) }} /></button>
        ))}
        <span className="ink-toolbar__sep" />
        <button className="ink-tool" onClick={undo} aria-label="撤销" title="撤销" disabled={readOnly || !canUndo}><Undo2 size={16} /></button>
        <button className="ink-tool" onClick={redo} aria-label="重做" title="重做" disabled={readOnly || !canRedo}><Redo2 size={16} /></button>
        {variant === "desktop" && (
          <>
            <span className="ink-toolbar__sep" />
            <div className="ink-zoom" role="group" aria-label="缩放">
              <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="缩小"><Minus size={16} /></button>
              <button className="ink-zoom__value" onClick={() => setZoom(1)} title="恢复为适应页面" aria-label="恢复为适应页面">{Math.round(zoom * 100)}%</button>
              <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="放大"><Plus size={16} /></button>
            </div>
          </>
        )}
      </div>

      {saveError && <div className="ink-invalid-banner" role="alert">{saveError}；本次修改未写入。</div>}

      {pagesOpen && (
        <InkPageStrip
          pages={doc.pages}
          activePageId={doc.activePageId}
          pendingDeleteId={pendingDeletePageId}
          onSelect={selectPage}
          onMove={movePage}
          onAdd={addPage}
          onRequestDelete={requestDeletePage}
          onConfirmDelete={confirmDeletePage}
          onCancelDelete={() => setPendingDeletePageId(null)}
          onClose={() => { setPagesOpen(false); setPendingDeletePageId(null); }}
        />
      )}

      <div className="ink-page-stage" ref={stageRef}>
        <div
          className="ink-page-frame"
          data-background={page.background}
          style={fitSize ? ({ width: fitSize.width * zoom, height: fitSize.height * zoom } as CSSProperties) : undefined}
        >
          <svg
            className="ink-page-svg"
            viewBox={`0 0 ${page.width} ${page.height}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishPointer}
            onPointerCancel={cancelPointer}
            onLostPointerCapture={cancelPointer}
            aria-label={`手写板第 ${pageIndex + 1} 页`}
          >
            <InkPaper width={page.width} height={page.height} background={page.background} />
            <StaticStrokeLayer strokes={renderedStrokes} />
            {activeStroke && activePath && (
              <path
                d={activePath}
                fill={activeStroke.color}
                opacity={activeStroke.tool === "highlighter" ? 0.3 : 1}
                style={activeStroke.tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
              />
            )}
          </svg>
        </div>
      </div>

      <div className="ink-footer">
        <div className="ink-pages">
          <button onClick={() => switchPage(-1)} disabled={readOnly || pageIndex <= 0} aria-label="上一页"><ChevronLeft size={16} /></button>
          <span>第 {pageIndex + 1} / {doc.pages.length} 页</span>
          <button onClick={() => switchPage(1)} disabled={readOnly || pageIndex >= doc.pages.length - 1} aria-label="下一页"><ChevronRight size={16} /></button>
          <button onClick={addPage} disabled={readOnly} aria-label="新建页"><Plus size={16} /></button>
          <button onClick={() => { setPagesOpen((open) => !open); setPendingDeletePageId(null); }} aria-label="页面管理" title="页面管理"><LayoutGrid size={16} /></button>
        </div>
        <div className="ink-footer__right">
          <div className="ink-backgrounds">
            {BACKGROUNDS.map((item) => (
              <button key={item.value} className={page.background === item.value ? "is-active" : ""} onClick={() => setBackground(item.value)} disabled={readOnly}>{item.label}</button>
            ))}
          </div>
          {variant === "mobile" && (
            <div className="ink-zoom" role="group" aria-label="缩放">
              <button onClick={zoomOut} disabled={zoom <= ZOOM_MIN} aria-label="缩小"><Minus size={16} /></button>
              <button className="ink-zoom__value" onClick={() => setZoom(1)} title="恢复为适应页面" aria-label="恢复为适应页面">{Math.round(zoom * 100)}%</button>
              <button onClick={zoomIn} disabled={zoom >= ZOOM_MAX} aria-label="放大"><Plus size={16} /></button>
            </div>
          )}
        </div>
      </div>
      {readOnly && <div className="ink-readonly-hint">只读</div>}
    </div>
  );
}

export default InkPad;
