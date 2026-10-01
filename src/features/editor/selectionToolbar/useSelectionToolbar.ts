import { useCallback, useEffect, useRef, useState } from "react";
import type { LakeEditorInstance } from "../lakeRuntime";
import { isImageCropping } from "./imageCardOps";
import { isCommandExecuted, isCommandUnavailable, isMarkActive, toFontSize, unwrapValue, type Rect } from "./selectionToolbarModel";

export interface TextTarget { kind: "text"; rect: Rect; }
export interface ImageTarget { kind: "image"; rect: Rect; cardId: string; cardEl: HTMLElement; src: string; }
export type SelectionTarget = TextTarget | ImageTarget;

/** 浮框不出现的上下文：表格 / 代码块有自己的工具条与交互，v1 让位。 */
const EXCLUDED_SELECTOR = ".ne-codeblock, ne-card[data-card-name='codeblock'], ne-card[data-card-name='table'], .ne-table";
const IMAGE_CARD_SELECTOR = "ne-card[data-card-name='image']";

/** 块级命令（与内核固定栏状态按钮同判据）：checked = queryCommandState===1；disabled 见 readState。 */
const BLOCK_STATE_COMMANDS = ["orderedList", "unorderedList", "taskList", "quote"] as const;

export interface ToolbarState {
  style: string;
  fontSize: number | null;
  alignment: string;
  color: string;
  bgColor: string;
  marks: Record<string, boolean>;
  /** 块级命令生效态（内核 CommandState === 1）。 */
  blocks: Record<string, boolean>;
  /** 独立按钮禁用态（列表 = !queryCommandEnabled；引用/行内代码 = state === -1，按各自内核 descriptor）。 */
  itemDisabled: Record<string, boolean>;
}

const EMPTY_STATE: ToolbarState = { style: "p", fontSize: null, alignment: "", color: "", bgColor: "", marks: {}, blocks: {}, itemDisabled: {} };

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
export function useSelectionToolbar(editor: LakeEditorInstance, container: HTMLElement, holdRef?: { current: boolean }) {
  const [target, setTarget] = useState<SelectionTarget | null>(null);
  const [state, setState] = useState<ToolbarState>(EMPTY_STATE);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<ImageTarget | null>(null);
  /** 指针按住中（拖选进行中）：此时不弹浮框，等完全松开再弹（否则从下往上选会被挡住）。 */
  const pressingRef = useRef(false);
  /**
   * 块句柄交互中（点手柄 / 开块菜单 / 拖块）：抑制文字浮栏 —— 与图片浮栏同机制（点句柄即隐、且不因
   * 文字选区仍在而被 pointerup 重推导回来）。`.lake-block-handle-host` 是**我们自己的**宿主编排
   *（见 blockHandleMount.ts），块手柄与内联的 `.ne-block-context-menu` 都在其内（均非 portal）。
   */
  const handleSuppressRef = useRef(false);
  /** 内核选区/命令态「晚一拍」：延迟补读用的定时器（同一时刻只留最后一次）。 */
  const settleTimerRef = useRef<number | null>(null);


  const readState = useCallback((): ToolbarState => {
    const q = (name: string, ...args: unknown[]): unknown => { try { return editor.queryCommandValue?.(name, ...args); } catch { return undefined; } };
    const str = (name: string, fallback = ""): string => {
      const v = unwrapValue(q(name));
      return typeof v === "string" ? v : fallback;
    };
    const marks: Record<string, boolean> = {};
    for (const name of ["bold", "italic", "underline", "strikethrough", "code"]) marks[name] = isMarkActive(q(name));
    // 块级命令（列表/待办/引用）：与内核固定栏状态按钮同判据。queryCommandState 返回内核
    // CommandState 数值（-1/0/1/2），不是布尔 ⇒ 用 isCommandExecuted/isCommandUnavailable 解。
    const st = (name: string): unknown => { try { return editor.queryCommandState?.(name); } catch { return undefined; } };
    const enabled = (name: string): boolean => { try { return editor.queryCommandEnabled?.(name) === true; } catch { return false; } };
    const blocks: Record<string, boolean> = {};
    const itemDisabled: Record<string, boolean> = {};
    for (const name of BLOCK_STATE_COMMANDS) {
      const v = st(name);
      blocks[name] = isCommandExecuted(v);
      // 内核 descriptor 判据：list 用 !queryCommandEnabled；quote 用 state === -1（Unavailable）。
      itemDisabled[name] = name === "quote" ? isCommandUnavailable(v) : !enabled(name);
    }
    // 行内代码是 mark：checked 走 marks（queryCommandValue）；disabled 按内核 moremark descriptor = state === -1。
    itemDisabled.code = isCommandUnavailable(st("code"));
    return {
      style: str("style", "p") || "p",
      // 内核 fontsize 控件用 queryCommandValue('fontsize', false) 取「生效字号」（含默认），
      // 不带第二参时正文返回 null ⇒ 折叠态无从显示、菜单也无项可标选中。与固定栏同源。
      fontSize: toFontSize(unwrapValue(q("fontsize", false))),
      alignment: str("alignment"),
      color: str("color"),
      bgColor: str("bgColor"),
      marks,
      blocks,
      itemDisabled,
    };
  }, [editor]);

  const computeTarget = useCallback((): SelectionTarget | null => {
    if (pressingRef.current) return null;   // 拖选过程中不弹，等 pointerup
    // 块句柄交互期间不许文字浮栏出现：点句柄不会清掉文字选区，selectionchange/内核事件会从这里
    // 把浮栏推导回来（用户 260924 报「点块句柄浮栏不消失」）。
    if (handleSuppressRef.current) return null;
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
    // 弹层开着（如链接编辑框获得焦点）：冻结浮栏 —— 焦点转到输入框会让编辑器选区丢失，
    // 若照常刷新就会把浮栏连同弹窗一起关掉（用户 260924 报「输入即关闭」）。点外部仍会经
    // pointerdown 直接 setTarget(null) 关闭，不受此影响。
    if (holdRef?.current) return;
    const next = computeTarget();
    setTarget(next);
    if (next?.kind === "text") setState(readState());
  }, [computeTarget, readState, holdRef]);

  // 同步刷新：早期版本用 rAF 合并，但 Electron 在窗口未绘制/被遮挡时会**暂停 rAF**，
  // 导致首次 refresh 永不执行、后续全部被 in-flight 守卫吞掉（260924 实测：浮框完全不出现）。
  // computeTarget/readState 只做轻量 DOM 读取，直接同步执行更稳。
  const refresh = useCallback(() => {
    try { refreshNow(); } catch { /* 内核/选区瞬时态不阻断 */ }
  }, [refreshNow]);

  /**
   * 选区/命令态变化后的刷新：立刻刷一次（保证浮框及时出现/定位），再延迟补读一次。
   * 内核的 queryCommandValue 在选区刚变化时会晚一拍才更新（HANDOFF §4 记录过同一现象），
   * 只读一次会拿到「上一次选区的样式/字号」⇒ 浮栏显示与固定栏不一致（用户 260924 报）。
   * 延迟补读让浮栏与固定栏在同一时刻收敛到同一状态。
   */
  const refreshSettled = useCallback(() => {
    refresh();
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      try { refreshNow(); } catch { /* 忽略瞬时态 */ }
    }, 90);
  }, [refresh, refreshNow]);

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
    const onSelectionChange = () => { if (!imageRef.current) refreshSettled(); };
    const onPointerDown = (event: PointerEvent) => {
      const t = event.target as HTMLElement | null;
      if (toolbarRef.current && t && toolbarRef.current.contains(t)) return;
      // 独立浮层（AI 对话框等）不是挂在浮栏上的菜单：点它**不该**把浮栏整条隐掉。
      // 否则「点生成 → 浮栏消失 → 松手后再出现」就是用户看到的闪烁（260930 报）。
      if (t?.closest?.(".ln-dialog, .ln-scrim")) return;
      // 块句柄交互（点手柄 / 点块菜单 / 拖块）：与图片浮栏同机制 —— 立即隐，且**不进入**「松开后重开」
      // 流程，否则 pointerup 会从仍存活的文字选区把浮栏推导回来。下一次非句柄 pointerdown 自动解除。
      const inBlockHandle = !!t?.closest?.(".lake-block-handle-host");
      handleSuppressRef.current = inBlockHandle;
      if (inBlockHandle) { imageRef.current = null; setTarget(null); return; }
      const card = t?.closest?.(IMAGE_CARD_SELECTOR) as HTMLElement | null;
      if (card && container.contains(card)) {
        const img = card.querySelector("img");
        imageRef.current = { kind: "image", rect: toRect(card.getBoundingClientRect()), cardId: card.getAttribute("id") ?? "", cardEl: card, src: img?.getAttribute("src") ?? "" };
      } else {
        imageRef.current = null;
      }
      pressingRef.current = true;
      setTarget(null);   // 按住即隐：拖选/点图过程中都不显示
    };
    const endPress = () => {
      if (!pressingRef.current) return;
      pressingRef.current = false;
      // 立刻刷 + 延迟补读：pointerup 瞬间内核可能还没更新命令态，只读一次会停在旧样式。
      refreshSettled();
      window.requestAnimationFrame(refresh);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      imageRef.current = null;
      setTarget(null);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", endPress, true);
    document.addEventListener("pointercancel", endPress, true);
    document.addEventListener("mouseup", endPress, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", refresh);
    document.addEventListener("scroll", refresh, true);
    let disposeContent: (() => void) | undefined;
    try {
      const onChange = () => refresh();
      editor.on?.("contentchange", onChange);
      disposeContent = () => { try { editor.off?.("contentchange", onChange); } catch { /* 忽略 */ } };
    } catch { /* 非编辑器环境忽略 */ }
    let disposeKernelSelection: (() => void) | undefined;
    try {
      // 内核自己的选区事件：与固定工具栏刷新同源 —— 在此刷新读到的就是内核更新后的命令态。
      const onKernelSelection = () => refreshSettled();
      editor.on?.("selectionchange", onKernelSelection);
      disposeKernelSelection = () => { try { editor.off?.("selectionchange", onKernelSelection); } catch { /* 忽略 */ } };
    } catch { /* 非编辑器环境忽略 */ }
    handleSuppressRef.current = false;   // 新实例/重挂载从干净态开始
    refresh();
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", endPress, true);
      document.removeEventListener("pointercancel", endPress, true);
      document.removeEventListener("mouseup", endPress, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", refresh);
      document.removeEventListener("scroll", refresh, true);
      disposeContent?.();
      disposeKernelSelection?.();
      if (settleTimerRef.current !== null) { window.clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
    };
  }, [container, editor, refresh, refreshSettled]);

  return { target, state, run, refresh, toolbarRef };
}
