import { useCallback, useEffect, useRef, useState } from "react";
import type { LakeEditorInstance } from "../lakeRuntime";
import { isImageCropping } from "./imageCardOps";
import { isMarkActive, toFontSize, unwrapValue, type Rect } from "./selectionToolbarModel";

export interface TextTarget { kind: "text"; rect: Rect; }
export interface ImageTarget { kind: "image"; rect: Rect; cardId: string; cardEl: HTMLElement; src: string; }
export type SelectionTarget = TextTarget | ImageTarget;

/** 浮框不出现的上下文：表格 / 代码块有自己的工具条与交互，v1 让位。 */
const EXCLUDED_SELECTOR = ".ne-codeblock, ne-card[data-card-name='codeblock'], ne-card[data-card-name='table'], .ne-table";
const IMAGE_CARD_SELECTOR = "ne-card[data-card-name='image']";

export interface ToolbarState {
  style: string;
  fontSize: number | null;
  alignment: string;
  color: string;
  bgColor: string;
  marks: Record<string, boolean>;
}

const EMPTY_STATE: ToolbarState = { style: "p", fontSize: null, alignment: "", color: "", bgColor: "", marks: {} };

function toRect(r: DOMRect | DOMRectReadOnly): Rect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

function firstRangeRect(range: Range): Rect | null {
  const rects = Array.from(range.getClientRects());
  const r = (rects.length > 0 ? rects[0] : range.getBoundingClientRect()) as DOMRect;
  if (!r || (r.width <= 0 && r.height <= 0)) return null;
  return toRect(r);
}

/**
 * 选区/图片浮框的显隐 + 定位数据源。
 * - 文字：document 非折叠选区且落在本编辑器容器内（排除表格/代码块）。
 * - 图片：点击本容器内的 image 卡片（卡片无原生「选中」态，故用最近一次点击记录）。
 * - 多 tab keep-alive：选区是全局唯一的，隐藏 tab 不可能有选区 ⇒ 天然只出现在当前可见编辑器。
 */
export function useSelectionToolbar(editor: LakeEditorInstance, container: HTMLElement) {
  const [target, setTarget] = useState<SelectionTarget | null>(null);
  const [state, setState] = useState<ToolbarState>(EMPTY_STATE);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<ImageTarget | null>(null);


  const readState = useCallback((): ToolbarState => {
    const q = (name: string): unknown => { try { return editor.queryCommandValue?.(name); } catch { return undefined; } };
    const str = (name: string, fallback = ""): string => {
      const v = unwrapValue(q(name));
      return typeof v === "string" ? v : fallback;
    };
    const marks: Record<string, boolean> = {};
    for (const name of ["bold", "italic", "underline", "strikethrough", "code"]) marks[name] = isMarkActive(q(name));
    return {
      style: str("style", "p") || "p",
      fontSize: toFontSize(unwrapValue(q("fontsize"))),
      alignment: str("alignment"),
      color: str("color"),
      bgColor: str("bgColor"),
      marks,
    };
  }, [editor]);

  const computeTarget = useCallback((): SelectionTarget | null => {
    if (!container.isConnected || container.getClientRects().length === 0) return null;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount > 0 && container.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      const startEl = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
      if (!startEl || !startEl.closest(EXCLUDED_SELECTOR)) {
        const rect = firstRangeRect(range);
        if (rect) return { kind: "text", rect };
      }
      return null;
    }
    const img = imageRef.current;
    if (img && img.cardEl.isConnected && container.contains(img.cardEl)) {
      if (isImageCropping(img.cardEl)) return null;   // 内核裁剪态：浮框让位给裁剪框
      const r = img.cardEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return { ...img, rect: toRect(r) };
    }
    return null;
  }, [container]);

  const refreshNow = useCallback(() => {
    const next = computeTarget();
    setTarget(next);
    if (next?.kind === "text") setState(readState());
  }, [computeTarget, readState]);

  // 同步刷新：早期版本用 rAF 合并，但 Electron 在窗口未绘制/被遮挡时会**暂停 rAF**，
  // 导致首次 refresh 永不执行、后续全部被 in-flight 守卫吞掉（260924 实测：浮框完全不出现）。
  // computeTarget/readState 只做轻量 DOM 读取，直接同步执行更稳。
  const refresh = useCallback(() => {
    try { refreshNow(); } catch { /* 内核/选区瞬时态不阻断 */ }
  }, [refreshNow]);

  /**
   * 执行内核命令并刷新 active 态。
   * 内核命令本身同步，但 queryCommandValue 的缓存晚一拍 ⇒ 下一帧 + 60ms 各刷一次
   * （实测：只刷下一帧时按钮高亮不亮，而 queryCommandValue 已是 "true"）。
   */
  const run = useCallback((name: string, ...args: unknown[]) => {
    try { editor.execCommand?.(name, ...args); } catch { /* 不静默改 UI：命令失败即保持原样 */ }
    refresh();
    // 直接调 refreshNow（不走 rAF 合并守卫）：命令后内核 queryCommandValue 缓存晚一拍，
    // 若这段时间已有 pending 帧，合并守卫会把这次补刷吞掉 ⇒ 按钮高亮不亮。
    window.setTimeout(() => { try { refreshNow(); } catch { /* 忽略 */ } }, 80);
  }, [editor, refresh, refreshNow]);

  useEffect(() => {
    const onSelectionChange = () => { if (!imageRef.current) refresh(); };
    const onPointerDown = (event: PointerEvent) => {
      const t = event.target as HTMLElement | null;
      if (toolbarRef.current && t && toolbarRef.current.contains(t)) return;
      const card = t?.closest?.(IMAGE_CARD_SELECTOR) as HTMLElement | null;
      if (card && container.contains(card)) {
        const img = card.querySelector("img");
        imageRef.current = { kind: "image", rect: toRect(card.getBoundingClientRect()), cardId: card.getAttribute("id") ?? "", cardEl: card, src: img?.getAttribute("src") ?? "" };
      } else {
        imageRef.current = null;
      }
      refresh();
      window.requestAnimationFrame(refresh);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      imageRef.current = null;
      setTarget(null);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", refresh);
    document.addEventListener("scroll", refresh, true);
    let disposeContent: (() => void) | undefined;
    try {
      const onChange = () => refresh();
      editor.on?.("contentchange", onChange);
      disposeContent = () => { try { editor.off?.("contentchange", onChange); } catch { /* 忽略 */ } };
    } catch { /* 非编辑器环境忽略 */ }
    refresh();
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", refresh);
      document.removeEventListener("scroll", refresh, true);
      disposeContent?.();
    };
  }, [container, editor, refresh]);

  return { target, state, run, refresh, toolbarRef };
}
