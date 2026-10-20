import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, Eraser, Highlighter, Pen, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
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
import { hitTestStroke, strokeToSvgPath } from "./inkGeometry.js";

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
  onEditorCapture?: (capture: (() => string | null) | null) => void;
}

const SAVE_DEBOUNCE_MS = 500;
const UNDO_LIMIT = 60;
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

export function InkPad({ content, readOnly = false, variant, active, paneVisible, pane, onChange, onDirty, onEditorCapture }: InkPadProps) {
  const initialDoc = useMemo(() => parseInkBody(content), [content]);
  const [doc, setDoc] = useState<InkDoc | null>(initialDoc);
  const docRef = useRef<InkDoc | null>(initialDoc);
  const [mode, setMode] = useState<InkPadMode>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [penWidth, setPenWidth] = useState<number>(WIDTHS[1]);
  const [highlighterWidth, setHighlighterWidth] = useState<number>(18);
  const [activeStroke, setActiveStroke] = useState<InkStroke | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const activePointerRef = useRef<{ id: number; type: string } | null>(null);
  const penDownRef = useRef(false);
  const activeStrokeRef = useRef<InkStroke | null>(null);
  const eraseBeforeRef = useRef<InkDoc | null>(null);
  const erasedIdsRef = useRef<Set<string>>(new Set());
  const lastPointRef = useRef<InkPoint | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const onEditorCaptureRef = useRef(onEditorCapture);
  onEditorCaptureRef.current = onEditorCapture;

  const page = useMemo(() => {
    if (!doc) return null;
    return doc.pages.find((item) => item.id === doc.activePageId) ?? doc.pages[0] ?? null;
  }, [doc]);
  const pageIndex = doc && page ? doc.pages.findIndex((item) => item.id === page.id) : -1;
  const canUndo = historyVersion >= 0 && undoRef.current.length > 0;
  const canRedo = historyVersion >= 0 && redoRef.current.length > 0;

  const flushSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = docRef.current;
    if (current) onChangeRef.current?.(inkToBody(current));
  }, []);

  const scheduleSave = useCallback(() => {
    onDirtyRef.current?.();
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const current = docRef.current;
      if (current) onChangeRef.current?.(inkToBody(current));
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const commit = useCallback((next: InkDoc, pushHistory = true) => {
    if (readOnly || !docRef.current) return;
    if (pushHistory) {
      undoRef.current.push(inkToBody(docRef.current));
      if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
      redoRef.current = [];
    }
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSave();
  }, [readOnly, scheduleSave]);

  const undo = useCallback(() => {
    const previous = undoRef.current.pop();
    if (!previous || !docRef.current) return;
    redoRef.current.push(inkToBody(docRef.current));
    const next = parseInkBody(previous);
    if (!next) return;
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSave();
  }, [scheduleSave]);

  const redo = useCallback(() => {
    const nextBody = redoRef.current.pop();
    if (!nextBody || !docRef.current) return;
    undoRef.current.push(inkToBody(docRef.current));
    const next = parseInkBody(nextBody);
    if (!next) return;
    docRef.current = next;
    setDoc(next);
    setHistoryVersion((value) => value + 1);
    scheduleSave();
  }, [scheduleSave]);

  useEffect(() => {
    onEditorCaptureRef.current?.(() => {
      const current = docRef.current;
      return current ? inkToBody(current) : null;
    });
    return () => {
      onEditorCaptureRef.current?.(null);
      flushSave();
    };
  }, [flushSave]);

  useEffect(() => {
    if (!doc || !page) return;
    if (doc.activePageId !== page.id) {
      const next = { ...doc, activePageId: page.id };
      docRef.current = next;
      setDoc(next);
    }
  }, [doc, page]);

  const addPage = useCallback(() => {
    if (!docRef.current || readOnly) return;
    const nextPage = createInkPage(newId("page"), "blank");
    commit({ ...docRef.current, pages: [...docRef.current.pages, nextPage], activePageId: nextPage.id });
  }, [commit, readOnly]);

  const deletePage = useCallback(() => {
    const current = docRef.current;
    if (!current || readOnly || current.pages.length <= 1) return;
    const removeIndex = current.pages.findIndex((item) => item.id === current.activePageId);
    const pages = current.pages.filter((item) => item.id !== current.activePageId);
    const activePageId = pages[Math.max(0, removeIndex - 1)]?.id ?? pages[0]?.id;
    commit({ ...current, pages, activePageId });
  }, [commit, readOnly]);

  const switchPage = useCallback((delta: number) => {
    const current = docRef.current;
    if (!current) return;
    const index = current.pages.findIndex((item) => item.id === current.activePageId);
    const next = current.pages[Math.max(0, Math.min(current.pages.length - 1, index + delta))];
    if (!next || next.id === current.activePageId) return;
    const updated = { ...current, activePageId: next.id };
    docRef.current = updated;
    setDoc(updated);
  }, []);

  const setBackground = useCallback((background: InkBackground) => {
    const current = docRef.current;
    if (!current || !page || readOnly) return;
    commit(replacePage(current, { ...page, background }));
  }, [commit, page, readOnly]);

  const finishStroke = useCallback(() => {
    const stroke = activeStrokeRef.current;
    const current = docRef.current;
    if (!stroke || !current || !page) return;
    const nextPage = { ...page, strokes: [...page.strokes, stroke] };
    activeStrokeRef.current = null;
    setActiveStroke(null);
    commit(replacePage(current, nextPage));
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
      eraseBeforeRef.current = docRef.current;
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
      if (before && current && erased) {
        undoRef.current.push(inkToBody(before));
        if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
        redoRef.current = [];
        setHistoryVersion((value) => value + 1);
        scheduleSave();
      }
    } else {
      finishStroke();
    }
    if (event.pointerType === "pen") penDownRef.current = false;
  }, [finishStroke, mode, scheduleSave]);

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
  const renderedStrokes = useMemo(() => {
    if (!page) return [];
    return page.strokes.map((stroke) => ({ stroke, d: strokeToSvgPath(stroke, true) }));
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
      </div>

      <div className="ink-page-stage">
        <div className="ink-page-frame" data-background={page.background}>
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
            <rect x="0" y="0" width={page.width} height={page.height} fill="transparent" />
            {renderedStrokes.map(({ stroke, d }) => (
              <path
                key={stroke.id}
                d={d}
                fill={stroke.color}
                opacity={stroke.tool === "highlighter" ? 0.3 : 1}
                style={stroke.tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
              />
            ))}
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
          <button onClick={deletePage} disabled={readOnly || doc.pages.length <= 1} aria-label="删除当前页"><Trash2 size={16} /></button>
        </div>
        <div className="ink-backgrounds">
          {BACKGROUNDS.map((item) => (
            <button key={item.value} className={page.background === item.value ? "is-active" : ""} onClick={() => setBackground(item.value)} disabled={readOnly}>{item.label}</button>
          ))}
        </div>
      </div>
      {readOnly && <div className="ink-readonly-hint">只读</div>}
    </div>
  );
}

export default InkPad;
