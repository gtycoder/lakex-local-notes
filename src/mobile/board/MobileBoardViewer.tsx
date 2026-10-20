/**
 * 移动端画板查看/编辑器（kind=board）。
 *
 * 与桌面 `src/features/board/BoardEditor.tsx` 同一套引擎（vendor `loadDrawnixBoardCore()` 懒加载器）与同一套
 * 图片资产口径（`features/board/boardImageAssets.ts` 的纯函数）：
 * - 阅读态：`readOnly`，画布可平移/缩放但改不了内容，也不写库。
 * - 编辑态：`readOnly=false`，Drawnix 工具栏可见；内容变化 800ms 防抖写回正文，完成/关标签时由
 *   父级调用 `onCapture` 同步取最新 body（与 usheet 同一条 capture 管线）。
 * - 正文 JSON（`core/boardDoc.ts`）绝不喂给 Lake 编辑器。
 * - **只挂载一次**：首次可见才建实例（隐藏态量到 0 尺寸画不出来），之后 keep-alive。
 * - **视口（缩放/平移）是本机 UI 状态**（261020 P1）：记在 `features/board/boardViewStore`（localStorage，L3），
 *   **不进正文、不标脏、不进 S3**；没有记忆时才 `fitOnInit` 自适应内容。平移 = 滚动画布容器，缩放走内核
 *   `onViewportPersist`（与桌面同一套判据，见 boardViewStore 头注释）。
 * - **画板内图片走资产管线**（261020 P1）：打开时资产 URL → data URL（内存口径，导出/预览不受 CORS 影响）、
 *   保存前 data URL → `note-assets/{noteId}/` 资产文件（磁盘口径）。映射由 boardImageAssets 纯函数产出，
 *   移动端只注入「读回」与「上传」两个能力（桌面同一口径，不另写一套）。
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { loadDrawnixBoardCore } from "@dlient/lakex-doc-react";
import type { DrawnixBoardCoreProps } from "@dlient/lakex-doc-react";
import { boardToBody, parseBoardBody, type BoardDoc, type BoardPreset, type BoardViewport } from "../../core/boardDoc.js";
import { readBoardView, writeBoardView } from "../../features/board/boardViewStore";
import {
  boardAssetHydrationMapping,
  boardInlinePromotionMapping,
  collectInlineImageUrls,
  replaceInlineImageUrls,
} from "../../features/board/boardImageAssets";
import { native } from "../../lib/native";
import { bridge } from "../bridge";

const DrawnixBoardCore = lazy(() => loadDrawnixBoardCore().then((m) => ({ default: m.default })));

/** 画布每次操作都会回调，必须合并（与桌面 BoardEditor / usheet 同口径）。 */
const AUTOSAVE_DEBOUNCE_MS = 800;

/** Drawnix 卡片值形态（独立画板只保留场景 + 模板标记；previewImage/cardHeight 一律丢弃）。 */
interface BoardCardValue {
  version: 2;
  engine: "drawnix";
  preset: BoardPreset;
  presetInitialized?: boolean;
  plaitValue: unknown[];
  plaitViewport?: BoardViewport;
}

function initialCardValue(doc: BoardDoc, viewport: BoardViewport | null): BoardCardValue {
  return {
    version: 2,
    engine: "drawnix",
    preset: doc.preset,
    ...(doc.presetInitialized ? { presetInitialized: true } : {}),
    plaitValue: doc.elements,
    ...(viewport ? { plaitViewport: viewport } : {}),
  };
}

export interface MobileBoardViewerProps {
  /** 文档 id：视口本机记忆 / 资产管线都按它索引。 */
  noteId: string;
  content: string;
  /** 该 tab 是否为当前活动 tab（未活动过就不建实例）。 */
  active: boolean;
  /** 阅读 / 编辑；缺省只读。 */
  editing?: boolean;
  /** 编辑命令防抖后的正文变化。 */
  onChange?: (content: string) => void;
  /** “完成”/关标签前同步取最新正文；null 表示该实例已卸载。 */
  onCapture?: (capture: (() => string | null) | null) => void;
}

export function MobileBoardViewer({ noteId, content, active, editing = false, onChange, onCapture }: MobileBoardViewerProps) {
  /** 打开时的视图：本机记下的优先（上次拖/缩到的位置），其次正文里的历史字段。 */
  const [initial] = useState(() => {
    const doc = parseBoardBody(content);
    const view = readBoardView(noteId);
    return { doc, view, viewport: view?.viewport ?? doc.viewport ?? null };
  });
  const [doc] = useState(() => initial.doc);
  const [cardValue, setCardValue] = useState<BoardCardValue>(() => initialCardValue(initial.doc, initial.viewport));
  const valueRef = useRef(cardValue);
  const hostRef = useRef<HTMLDivElement | null>(null);
  /** 资产管线：data URL → 磁盘资产 URL（保存时按它换写盘口径）。 */
  const promotedRef = useRef<Map<string, string>>(new Map());
  /** 提升进行中的计数：未落地前不保存（否则会把 data:image 写进正文）。 */
  const promoteInflightRef = useRef(0);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const captureCallbackRef = useRef(onCapture);
  captureCallbackRef.current = onCapture;
  /** 已通知给父级的正文；避免切 tab/卸载时把未变化的内容重复标脏。 */
  const lastBodyRef = useRef(boardToBody({ ...doc, viewport: null }));
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const [everActive, setEverActive] = useState(active);
  /** hydrate 完成才挂引擎：否则引擎先拿到资产 URL、之后才换 data URL，导出/预览会退化。 */
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  );

  useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  /** 保存口径：内存里是 data URL，磁盘上是资产 URL（映射里没有的内联图原样保留 ⇒ 不丢图）。 */
  const serialize = useCallback((): string => {
    const value = valueRef.current;
    const elements = replaceInlineImageUrls(value.plaitValue, promotedRef.current) as unknown[];
    const next: BoardDoc = {
      kind: "board",
      version: 1,
      engine: "drawnix",
      preset: value.preset,
      elements,
      viewport: null,
    };
    if (value.presetInitialized) next.presetInitialized = true;
    return boardToBody(next);
  }, []);

  const emit = useCallback(() => {
    if (!dirtyRef.current) return;
    const body = serialize();
    if (body === lastBodyRef.current) return;
    lastBodyRef.current = body;
    changeRef.current?.(body);
  }, [serialize]);

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // 提升未落地前不保存：否则会把 data:image 版本写进 boards/*.board.json（正文膨胀 + 不走资产管线）。
    // 提升完成会再排一次保存，那时正文里已是 canonical 资产 URL。
    if (promoteInflightRef.current > 0) return;
    emit();
  }, [emit]);

  const scheduleSave = useCallback(() => {
    if (!editingRef.current) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flush();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flush]);

  /** 同步取最新正文；提升在途时返回 null（避免把内联 data URL 落盘，提升完成会再落一次）。 */
  const capture = useCallback((): string | null => {
    if (!dirtyRef.current) return null;
    if (promoteInflightRef.current > 0) return null;
    const body = serialize();
    if (body !== lastBodyRef.current) {
      lastBodyRef.current = body;
      changeRef.current?.(body);
    }
    return body;
  }, [serialize]);

  /** 内联图片 → 资产文件（单张失败保持内联，不丢图）；完成后立刻排保存。 */
  const promoteInlineImages = useCallback(async (elements: unknown[]): Promise<void> => {
    const known = promotedRef.current;
    const candidates = [...collectInlineImageUrls(elements)].filter((dataUrl) => !known.has(dataUrl));
    if (candidates.length === 0) return;
    promoteInflightRef.current += 1;
    try {
      const mapping = await boardInlinePromotionMapping(
        elements,
        noteId,
        (input) => bridge.uploadResource(input, noteId),
        known,
      );
      for (const [dataUrl, assetUrl] of mapping) known.set(dataUrl, assetUrl);
      if (mapping.size > 0) dirtyRef.current = true;
    } catch (error) {
      console.warn("[mobile-board] 内联图片提升失败（保持内联形态）", error);
    } finally {
      promoteInflightRef.current -= 1;
      // 提升落地后立刻落一次（此刻写盘口径已是资产 URL）
      if (promoteInflightRef.current === 0) {
        dirtyRef.current = true;
        flush();
      }
    }
  }, [noteId, flush]);

  const handleCoreChange = useCallback<NonNullable<DrawnixBoardCoreProps["onChange"]>>((partial) => {
    if (!editingRef.current) return;
    setCardValue((prev) => {
      const next: BoardCardValue = {
        ...prev,
        version: 2,
        engine: "drawnix",
        ...(partial.preset ? { preset: partial.preset } : {}),
        ...(partial.presetInitialized ? { presetInitialized: true } : {}),
        ...(Array.isArray(partial.plaitValue) ? { plaitValue: partial.plaitValue } : {}),
      };
      valueRef.current = next;
      return next;
    });
    if (Array.isArray(partial.plaitValue) || partial.presetInitialized) {
      dirtyRef.current = true;
      scheduleSave();
    }
    // 有内联图片就立刻提升（不等 800ms 防抖，尽量在第一次保存前完成）
    if (Array.isArray(partial.plaitValue)) void promoteInlineImages(partial.plaitValue);
  }, [promoteInlineImages, scheduleSave]);

  // 从编辑切回阅读：立即落一次，避免 800ms 窗口内点“完成”吃不到最后一步。
  useEffect(() => {
    if (!editing) flush();
  }, [editing, flush]);

  // 把同步 capture 交给父级；卸载前再 flush 一次（父级 closeTab 也会主动 capture）。
  useEffect(() => {
    captureCallbackRef.current?.(capture);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      capture();
      captureCallbackRef.current?.(null);
    };
  }, [capture]);

  // 打开画板：先把资产 URL 换回 data URL（内存口径），并反向登记映射，再挂引擎。
  useEffect(() => {
    if (!everActive || ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const mapping = await boardAssetHydrationMapping(
          valueRef.current.plaitValue,
          noteId,
          (id, filename) => native.readAssetPreview(id, filename),
        );
        if (!cancelled && mapping.size > 0) {
          for (const [assetUrl, dataUrl] of mapping) promotedRef.current.set(dataUrl, assetUrl);
          const next: BoardCardValue = {
            ...valueRef.current,
            plaitValue: replaceInlineImageUrls(valueRef.current.plaitValue, mapping) as unknown[],
          };
          valueRef.current = next;
          setCardValue(next);
        }
      } catch (error) {
        console.warn("[mobile-board] 资产图片读回失败（按资产 URL 渲染）", error);
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [everActive, ready, noteId]);

  // 编辑态（含老正文里遗留的内联图片）：把 data URL 提升成资产文件（与桌面同一路径）。
  useEffect(() => {
    if (!ready || !editing) return;
    void promoteInlineImages(valueRef.current.plaitValue);
  }, [ready, editing, promoteInlineImages]);

  /**
   * 视口记忆（261020 P1）：缩放走内核被动回调；**平移在这是"滚动画布容器"**（实测口径同桌面），
   * 所以直接盯 `.viewport-container`。写 localStorage 不触发保存（视口不进正文）。
   * 恢复采用**尽力而为的重复贴位**（内核初始化会把它摆回默认值）：不遮画板的简化版；
   * 桌面那套"收敛后再显示"没有搬过来（移动端打开即见内容更重要）。
   */
  useEffect(() => {
    if (!everActive || !active || !ready) return;
    const host = hostRef.current;
    if (!host) return;
    let container: HTMLElement | null = null;
    let writeTimer = 0;
    let tries = 0;
    const timers: number[] = [];
    const persist = () => {
      if (!container) return;
      writeBoardView(noteId, { scroll: { left: container.scrollLeft, top: container.scrollTop } });
    };
    const onScroll = () => {
      // 拖动中不逐帧写：合并到停手后一次（松手另有立即落盘）
      if (writeTimer) window.clearTimeout(writeTimer);
      writeTimer = window.setTimeout(() => { writeTimer = 0; persist(); }, 200);
    };
    /** 只在画板内收尾的手势上立即落盘（应用里其它地方的点击不该改画板记忆）。 */
    const onPointerUp = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !host.contains(target)) return;
      persist();
    };
    const attach = () => {
      container = host.querySelector<HTMLElement>(".viewport-container");
      if (!container) {
        if (tries++ < 20) timers.push(window.setTimeout(attach, 50));
        return;
      }
      container.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("pointerup", onPointerUp);
      const remembered = readBoardView(noteId)?.scroll ?? null;
      if (!remembered) return;
      let attempts = 0;
      let stableSince = 0;
      const startedAt = Date.now();
      const restore = () => {
        if (!container) return;
        const atTarget = Math.abs(container.scrollLeft - remembered.left) <= 1
          && Math.abs(container.scrollTop - remembered.top) <= 1;
        if (!atTarget) {
          container.scrollLeft = remembered.left;
          container.scrollTop = remembered.top;
          stableSince = 0;
        } else if (stableSince === 0) {
          stableSince = Date.now();
        }
        const stableFor = stableSince === 0 ? 0 : Date.now() - stableSince;
        if (stableFor >= 250 || Date.now() - startedAt > 1200 || attempts++ >= 40) return;
        timers.push(window.setTimeout(restore, 24));
      };
      restore();
    };
    attach();
    return () => {
      if (writeTimer) window.clearTimeout(writeTimer);
      for (const id of timers) window.clearTimeout(id);
      container?.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [everActive, active, ready, noteId]);

  const className = "mobile-board-viewer" + (editing ? " is-editing" : "");
  const fitOnInit = !initial.viewport && !initial.view?.scroll;
  if (!everActive) return <div ref={hostRef} className={className} data-prevent-swipe />;
  return (
    <div ref={hostRef} className={className} data-prevent-swipe>
      <Suspense fallback={<div className="mobile-board-loading" />}>
        {ready ? (
          <DrawnixBoardCore
            value={cardValue}
            locale="zh-CN"
            theme={theme}
            readOnly={!editing}
            fitOnInit={fitOnInit}
            onChange={handleCoreChange}
            onViewportPersist={(next) => {
              // 本机记住（不写正文、不触发保存）：缩放走内核被动回调，平移看容器滚动
              writeBoardView(noteId, { viewport: { x: next.x, y: next.y, zoom: next.zoom } });
            }}
          />
        ) : (
          <div className="mobile-board-loading" />
        )}
      </Suspense>
    </div>
  );
}

export default MobileBoardViewer;
