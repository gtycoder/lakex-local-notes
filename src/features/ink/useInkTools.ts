/**
 * 手写板笔 / 工具域（261125 D-06 拆分：从 InkPad.tsx 原样搬出，纯搬移零行为变化）。
 *
 * 职责：工具态（画笔 / 高亮笔 / 整笔橡皮 / 颜色 / 笔宽）+ 画布指针输入管线（落笔 / 擦除 / 中断收口），
 * 以及画布命中选中态（贴图 / 文字块的选中与拖动临时态——拖动与落笔共用同一套 pointer 捕获与批次渲染纪律）。
 * 边界（改这里先读 docs/INK-PAD.md、inkPadModel.ts 头注释）：
 *  1. **热路径不序列化**：一批合并点 / 一次擦除只 setState 一次（261103 九批）；落笔数据始终在 ref 里。
 *  2. **中断必收口（261103 十批）**：pointercancel / lostpointercapture / 丢 up 时，≥2 点的笔迹按已完成部分提交，
 *     橡皮回滚到本笔开始前——绝不静默丢笔（用户现场：快速滑行偶发「笔迹消失」）。
 *  3. 选中态是**命中测试的结果**（坐标命中，不能只看 event.target：笔迹永远盖在贴图上层）；
 *     页内对象的增删改在 useInkPageItems.ts，页级补丁与提交在 history.ts / useInkHistory.ts。
 */
import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import type { InkDoc, InkPage, InkPoint, InkStroke } from "../../core/inkDoc.js";
import { INK_DEFAULT_COLOR } from "./inkPalette.js";
import type { InkPadMode } from "./InkPad";
import { hitTestStroke, strokeToSvgPath } from "./inkGeometry.js";
import { hitTestPageImage, movePageImage } from "./inkPageImages.js";
import { hitTestPageText, movePageText } from "./inkPageTexts.js";
import { inkPagePatch, replacePage, type InkPatch } from "./history.js";
import { newInkId } from "./ids.js";
import { createStrokePathCache, renderedStrokesForPage, type RenderedStrokePath } from "./inkRenderCache.js";

// 色板单一来源 = inkPalette.ts（261103 三批：6 → 14 色，手机/平板/桌面同一份）
/** 笔宽档位（逻辑 px）。两种工具**不能共用一组**：高亮是宽面马克笔，套 1.5~6 就是一条细线。 */
const PEN_WIDTHS = [1.5, 2.5, 4, 6] as const;
const HIGHLIGHTER_WIDTHS = [10, 18, 26, 34] as const;

export function widthPresets(mode: InkPadMode): readonly number[] {
  return mode === "highlighter" ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS;
}

/**
 * 笔宽档位里的视觉点直径（44 盒内）。两种工具的量纲差一个数量级，缩放系数也不同：
 * 笔 ×2（1.5→3 … 6→12），高亮 ×0.8 且封顶 26（10→8 … 34→26）；
 * 两边都夹在 4~26 内，保证不撑破 44 盒。
 */
export function widthDotSize(width: number, mode: InkPadMode = "pen"): number {
  const scale = mode === "highlighter" ? 0.8 : 2;
  return Math.min(mode === "highlighter" ? 26 : 20, Math.max(4, Math.round(width * scale)));
}

export function pointFromClient(clientX: number, clientY: number, pointerType: string, pressure: number, rect: DOMRect, page: InkPage): InkPoint {
  const x = rect.width > 0 ? ((clientX - rect.left) / rect.width) * page.width : 0;
  const y = rect.height > 0 ? ((clientY - rect.top) / rect.height) * page.height : 0;
  const rawPressure = pointerType === "pen" ? pressure : 0.5;
  return {
    x: Math.min(page.width, Math.max(0, x)),
    y: Math.min(page.height, Math.max(0, y)),
    pressure: Number.isFinite(rawPressure) && rawPressure > 0 ? Math.min(1, rawPressure) : 0.5,
  };
}

export interface InkToolsDeps {
  docRef: MutableRefObject<InkDoc | null>;
  setDoc: Dispatch<SetStateAction<InkDoc | null>>;
  page: InkPage | null;
  readOnly: boolean;
  /** 唯一正文提交入口（useInkHistory）：patch=null = 本次改动不进撤销栈。 */
  commit: (next: InkDoc, patch: InkPatch | null) => void;
}

export interface InkToolsState {
  mode: InkPadMode;
  setMode: Dispatch<SetStateAction<InkPadMode>>;
  color: string;
  setColor: Dispatch<SetStateAction<string>>;
  penWidth: number;
  setPenWidth: Dispatch<SetStateAction<number>>;
  highlighterWidth: number;
  setHighlighterWidth: Dispatch<SetStateAction<number>>;
  /** 画布命中选中态（v4 页内贴图 / 文字块）；增删改在 useInkPageItems。 */
  selectedImageId: string | null;
  setSelectedImageId: Dispatch<SetStateAction<string | null>>;
  selectedTextId: string | null;
  setSelectedTextId: Dispatch<SetStateAction<string | null>>;
  /** 在写笔（只在落笔期间有值；一批合并点只 setActiveStroke 一次）。 */
  activeStroke: InkStroke | null;
  activePath: string | null;
  renderedStrokes: RenderedStrokePath[];
  onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  finishPointer: (event: ReactPointerEvent<SVGSVGElement>) => void;
  cancelPointer: (event: ReactPointerEvent<SVGSVGElement>) => void;
}

export function useInkTools({ docRef, setDoc, page, readOnly, commit }: InkToolsDeps): InkToolsState {
  const [mode, setMode] = useState<InkPadMode>("pen");
  const [color, setColor] = useState(INK_DEFAULT_COLOR);
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS[1]);
  const [highlighterWidth, setHighlighterWidth] = useState<number>(18);
  /** v4 页内贴图：当前选中的图 + 拖动临时态（拖动只改内存，松手才 commit）。 */
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const imageDragRef = useRef<{ id: string; startX: number; startY: number; before: InkPage["images"] } | null>(null);
  /** v4 页内文字块：选中 / 编辑中（草稿）/ 拖动中。 */
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const textDragRef = useRef<{ id: string; startX: number; startY: number; before: InkPage["texts"] } | null>(null);
  const [activeStroke, setActiveStroke] = useState<InkStroke | null>(null);
  const activePointerRef = useRef<{ id: number; type: string } | null>(null);
  /** 中断收口函数的前向引用（onPointerDown 定义在其前面，避免声明顺序依赖）。 */
  const finalizeInterruptedRef = useRef<(reason: string) => void>(() => {});
  const penDownRef = useRef(false);
  const activeStrokeRef = useRef<InkStroke | null>(null);
  const eraseBeforeRef = useRef<InkPage | null>(null);
  const erasedIdsRef = useRef<Set<string>>(new Set());
  const lastPointRef = useRef<InkPoint | null>(null);

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

  /**
   * 擦到某点：只更新 docRef + erasedIdsRef，**不 setState**（261103 九批）。
   * 一次 pointermove 的多个 coalesced 点、以及快速擦除，都会在批末统一 setDoc 一次；
   * 中间结果用 erasedIdsRef 累积，来源页面仍是本批开始时的 page（已擦 id 都在 set 里，结果一致）。
   * @returns 是否真的擦掉了东西
   */
  const eraseAt = useCallback((point: InkPoint): boolean => {
    const current = docRef.current;
    if (!current || !page) return false;
    const hits = page.strokes.filter((stroke) => !erasedIdsRef.current.has(stroke.id) && hitTestStroke(stroke, point));
    if (hits.length === 0) return false;
    for (const stroke of hits) erasedIdsRef.current.add(stroke.id);
    const nextPage = { ...page, strokes: page.strokes.filter((stroke) => !erasedIdsRef.current.has(stroke.id)) };
    docRef.current = replacePage(current, nextPage);
    return true;
  }, [page]);

  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || !docRef.current || !page) return;
    if (event.button !== 0) return;
    if (event.pointerType === "pen") {
      penDownRef.current = true;
    } else if (penDownRef.current) {
      return; // 掌托/手指在笔落下期间不参与书写
    }
    // v4 页内贴图：命中图就是「选中 + 拖动」，不要再画线（笔与手指都支持）。
    // 命中判据用**坐标**（hitTestPageImage），不能只看 event.target：笔迹永远画在贴图上层的 <path> 里，
    // 「视觉层序」不等于「命中层序」—— 只看 target 会让被笔迹盖住的贴图永远选不中、删不掉（261104 用户现场）。
    const rect0 = event.currentTarget.getBoundingClientRect();
    const startPoint = pointFromClient(event.clientX, event.clientY, event.pointerType, event.pressure, rect0, page);
    const imageId = hitTestPageImage(page, startPoint)
      ?? (event.target as Element | null)?.closest?.("[data-page-image]")?.getAttribute("data-page-image")
      ?? null;
    if (imageId) {
      setSelectedImageId(imageId);
      imageDragRef.current = { id: imageId, startX: startPoint.x, startY: startPoint.y, before: page.images };
      activePointerRef.current = { id: event.pointerId, type: event.pointerType };
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* 合成事件/无活动指针：捕获失败不影响选中与拖动 */ }
      return;
    }
    // v4 页内文字块：点在文字上 = 选中 + 拖动（双击进入编辑，见 onDoubleClick）
    const textRect = event.currentTarget.getBoundingClientRect();
    const textPoint = pointFromClient(event.clientX, event.clientY, event.pointerType, event.pressure, textRect, page);
    const textHitId = hitTestPageText(page, textPoint);
    if (textHitId) {
      setSelectedImageId(null);
      setSelectedTextId(textHitId);
      textDragRef.current = { id: textHitId, startX: textPoint.x, startY: textPoint.y, before: page.texts };
      activePointerRef.current = { id: event.pointerId, type: event.pointerType };
      try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* 合成事件：忽略 */ }
      return;
    }
    // 画线前清掉选中（点空白 = 取消选中）
    if (selectedImageId) setSelectedImageId(null);
    if (selectedTextId) setSelectedTextId(null);
    // 上一次 pointerup 丢失（或丢了 pointercancel/lostcapture）时，activePointer 会残留 ⇒ 以前整块画布
    // 从此画不上（用户报的「偶发不生效」）。这里先把残留那笔收口（能提交就提交），再开始新的一笔。
    if (activePointerRef.current) finalizeInterruptedRef.current("missing-pointerup");
    activePointerRef.current = { id: event.pointerId, type: event.pointerType };
    try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* 合成事件/无活动指针：退化为不捕获 */ }
    const point = pointFromClient(event.clientX, event.clientY, event.pointerType, event.pressure, event.currentTarget.getBoundingClientRect(), page);
    lastPointRef.current = point;
    if (mode === "eraser") {
      eraseBeforeRef.current = page;
      erasedIdsRef.current = new Set();
      if (eraseAt(point) && docRef.current) setDoc(docRef.current);
      return;
    }
    const stroke: InkStroke = {
      id: newInkId("stroke"),
      tool: mode,
      color,
      width: mode === "highlighter" ? highlighterWidth : penWidth,
      points: [point],
    };
    activeStrokeRef.current = stroke;
    setActiveStroke(stroke);
  }, [color, eraseAt, highlighterWidth, mode, page, penWidth, readOnly, selectedImageId, selectedTextId]);

  /**
   * 往当前笔迹追加一个点。**只改 ref、不 setState**（261103 九批）：
   * 一次 pointermove 可能带多个 coalesced 事件，以前每个点都 setState ⇒ 每个事件 N 次重渲染，
   * 快速落笔时 React 渲染 / perfect-freehand 重算帧率被压垮（用户报「画快了不生效」）。
   * 现在由 onPointerMove 在**一批点追加完**后统一 setState 一次；落笔数据始终在 ref 里，不受渲染节流影响。
   * @returns 是否真的追加了点（调用方据此决定要不要重渲染）
   */
  const appendPoint = useCallback((point: InkPoint): boolean => {
    const current = activeStrokeRef.current;
    if (!current) return false;
    const previous = lastPointRef.current;
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.35) return false;
    lastPointRef.current = point;
    const next: InkStroke = { ...current, points: [...current.points, point] };
    activeStrokeRef.current = next;
    return true;
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const textDrag = textDragRef.current;
    if (textDrag && page && activePointerRef.current?.id === event.pointerId) {
      const rectText = event.currentTarget.getBoundingClientRect();
      const point = pointFromClient(event.clientX, event.clientY, event.pointerType, event.pressure, rectText, page);
      const current = docRef.current;
      const pageNow = current?.pages.find((item) => item.id === page.id);
      if (current && pageNow) {
        const texts = movePageText({ ...pageNow, texts: textDrag.before ?? pageNow.texts }, textDrag.id, point.x - textDrag.startX, point.y - textDrag.startY);
        if (texts) {
          const nextDoc = replacePage(current, { ...pageNow, texts });
          docRef.current = nextDoc;
          setDoc(nextDoc);
        }
      }
      return;
    }
    const drag = imageDragRef.current;
    if (drag && page && activePointerRef.current?.id === event.pointerId) {
      const rectDrag = event.currentTarget.getBoundingClientRect();
      const point = pointFromClient(event.clientX, event.clientY, event.pointerType, event.pressure, rectDrag, page);
      const current = docRef.current;
      const pageNow = current?.pages.find((item) => item.id === page.id);
      if (current && pageNow) {
        const images = movePageImage({ ...pageNow, images: drag.before ?? pageNow.images }, drag.id, point.x - drag.startX, point.y - drag.startY);
        if (images) {
          const nextPage = { ...pageNow, images };
          if (images.length === 0) delete (nextPage as { images?: unknown }).images;
          const nextDoc = replacePage(current, nextPage);
          docRef.current = nextDoc;
          setDoc(nextDoc);
        }
      }
      return;
    }
    if (!page || activePointerRef.current?.id !== event.pointerId) return;
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const source = events.length > 0 ? events : [event.nativeEvent];
    const rect = event.currentTarget.getBoundingClientRect();
    if (mode === "eraser") {
      let erased = false;
      for (const sourceEvent of source) {
        if (eraseAt(pointFromClient(sourceEvent.clientX, sourceEvent.clientY, event.pointerType, sourceEvent.pressure, rect, page))) erased = true;
      }
      // 一批擦除点只重渲染一次（快速擦除是主要热路径）。
      if (erased && docRef.current) setDoc(docRef.current);
      return;
    }
    let appended = false;
    for (const sourceEvent of source) {
      if (appendPoint(pointFromClient(sourceEvent.clientX, sourceEvent.clientY, event.pointerType, sourceEvent.pressure, rect, page))) appended = true;
    }
    // 一批合并点只重渲染一次（快速落笔时这里是主要热路径）。
    if (appended) setActiveStroke(activeStrokeRef.current);
  }, [appendPoint, eraseAt, mode, page]);

  /**
   * 261103 十批：落笔被**异常中断**（pointercancel / lostpointercapture / 丢失 up）时的收口。
   * 以前一律丢弃 ⇒ 已经画出来的笔迹会「偶发消失」（快速滑动时更容易撞上，用户 261103 实机报）。
   * 现在的口径：
   *   · 画笔/高亮笔：已经积累 ≥2 个点 ⇒ **按已完成部分提交**（宁可留一笔，不可静默丢）；
   *   · 橡皮：保留原有语义（回滚到本笔开始前 + 不进历史栈）。
   * 返回 true 表示已处理（调用方不要再重复 finalize）。
   */
  const finalizeInterrupted = useCallback((reason: string): void => {
    if (!activePointerRef.current) return;
    activePointerRef.current = null;
    if (mode === "eraser") {
      const eraseBase = eraseBeforeRef.current;
      const current = docRef.current;
      eraseBeforeRef.current = null;
      erasedIdsRef.current = new Set();
      if (eraseBase && current && current.pages.some((item) => item.id === eraseBase.id)) {
        const restored = replacePage(current, eraseBase);
        docRef.current = restored;
        setDoc(restored);
      }
      return;
    }
    const stroke = activeStrokeRef.current;
    if (stroke && stroke.points.length >= 2) {
      // 丢 up 的那一笔照样落盘（同时保留历史栈里的一次增量）。
      console.warn("[ink] 落笔被中断（" + reason + "），已按已完成部分提交", { points: stroke.points.length });
      finishStroke();
      return;
    }
    activeStrokeRef.current = null;
    setActiveStroke(null);
  }, [finishStroke, mode]);
  finalizeInterruptedRef.current = finalizeInterrupted;

  const finishPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const textDrag = textDragRef.current;
    if (textDrag && activePointerRef.current?.id === event.pointerId) {
      textDragRef.current = null;
      activePointerRef.current = null;
      if (event.pointerType === "pen") penDownRef.current = false;
      const current = docRef.current;
      const pageNow = current?.pages.find((item) => item.id === page?.id);
      if (current && pageNow) {
        const beforePage = { ...pageNow };
        if (textDrag.before) beforePage.texts = textDrag.before;
        else delete beforePage.texts;
        const moved = JSON.stringify(pageNow.texts ?? []) !== JSON.stringify(textDrag.before ?? []);
        if (moved) commit(replacePage(current, pageNow), inkPagePatch(beforePage, pageNow));
        else {
          const restored = replacePage(current, beforePage);
          docRef.current = restored;
          setDoc(restored);
        }
      }
      return;
    }
    const drag = imageDragRef.current;
    if (drag && activePointerRef.current?.id === event.pointerId) {
      imageDragRef.current = null;
      activePointerRef.current = null;
      if (event.pointerType === "pen") penDownRef.current = false;
      const current = docRef.current;
      const pageNow = current?.pages.find((item) => item.id === page?.id);
      if (current && pageNow) {
        const beforePage = { ...pageNow };
        if (drag.before) beforePage.images = drag.before;
        else delete beforePage.images;
        const moved = JSON.stringify(pageNow.images ?? []) !== JSON.stringify(drag.before ?? []);
        if (moved) {
          commit(replacePage(current, pageNow), inkPagePatch(beforePage, pageNow));
        } else {
          const restored = replacePage(current, beforePage);
          docRef.current = restored;
          setDoc(restored);
        }
      }
      return;
    }
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
  }, [commit, finishStroke, mode, page]);

  const cancelPointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const textDrag = textDragRef.current;
    if (textDrag && activePointerRef.current?.id === event.pointerId) {
      textDragRef.current = null;
      activePointerRef.current = null;
      const current = docRef.current;
      const pageNow = current?.pages.find((item) => item.id === page?.id);
      if (current && pageNow) {
        const nextPage = { ...pageNow };
        if (textDrag.before) nextPage.texts = textDrag.before;
        else delete nextPage.texts;
        const restored = replacePage(current, nextPage);
        docRef.current = restored;
        setDoc(restored);
      }
      if (event.pointerType === "pen") penDownRef.current = false;
      return;
    }
    const drag = imageDragRef.current;
    if (drag && activePointerRef.current?.id === event.pointerId) {
      imageDragRef.current = null;
      activePointerRef.current = null;
      const current = docRef.current;
      const pageNow = current?.pages.find((item) => item.id === page?.id);
      if (current && pageNow) {
        const nextPage = { ...pageNow };
        if (drag.before) nextPage.images = drag.before;
        else delete nextPage.images;
        const restored = replacePage(current, nextPage);
        docRef.current = restored;
        setDoc(restored);
      }
      if (event.pointerType === "pen") penDownRef.current = false;
      return;
    }
    if (activePointerRef.current?.id !== event.pointerId) return;
    if (event.pointerType === "pen") penDownRef.current = false;
    finalizeInterrupted(event.type === "pointercancel" ? "pointercancel" : "lostpointercapture");
  }, [finalizeInterrupted, page]);

  const activePath = useMemo(() => activeStroke ? strokeToSvgPath(activeStroke, false) : null, [activeStroke]);
  /** 笔迹 id → SVG 轮廓缓存（P5）：落一笔/擦一条只算新笔迹，不再整页重算 perfect-freehand。 */
  const strokePathCacheRef = useRef(createStrokePathCache());
  const renderedStrokes = useMemo<RenderedStrokePath[]>(() => {
    if (!page) return [];
    return renderedStrokesForPage(page, strokePathCacheRef.current);
  }, [page]);

  return {
    mode, setMode, color, setColor, penWidth, setPenWidth, highlighterWidth, setHighlighterWidth,
    selectedImageId, setSelectedImageId, selectedTextId, setSelectedTextId,
    activeStroke, activePath, renderedStrokes,
    onPointerDown, onPointerMove, finishPointer, cancelPointer,
  };
}
