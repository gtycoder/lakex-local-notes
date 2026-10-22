/**
 * 「移动端编辑面」的唯一 owner（261014 P2/P3 收口）。它拥有四件事，全部只在这里实现一次：
 *
 *   ① **外壳高度**：写 --mb-app-h = 稳定外壳高 − 底部占用（键盘态与面板态算出同一个值 ⇒ 内容视口恒定）；
 *   ② **面板状态机**：panelMode / 收起过渡 closing / 面板占位 panelHeight / 退场期继续渲染 renderedPanel，
 *      以及「等输入法真的回来再清占位」的时序；
 *   ③ **输入法抑制**：面板占键盘区期间「收键盘但留住焦点与光标」（inputmode="none" + blur/focus，带重入保护）；
 *   ④ **焦点守卫**：用户手指点正文 → 收面板并放回输入法；内核命令后抢焦点 → 只把 inputmode 按住（不 blur）。
 *
 * 几何算术见 editSurfaceModel.ts（纯函数 + CI 单测）；稳定外壳高见 viewportShell.ts；
 * 口径与实测见 docs/LAKEX-CONTRACT.md §5.36–§5.38；不变量由 scripts/mobile-audit/edit-surface-invariants.mjs 卡住。
 * 消费者：EditorDock（渲染 + 命令）。新增编辑面时复用本 hook，不要再各自实现这几件事。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useKeyboard } from "../hooks/useKeyboard";
import { bottomOccupation, capturePanelHeight, dockKbOffset, shellSurfaceHeight } from "./editSurfaceModel";

export type PanelMode = "insert" | "font" | "more" | "emoji" | null;

/** 正文里的可编辑宿主（只取当前可见的，避免动到 keep-alive 隐藏视图）。 */
function visibleEditables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]')).filter((el) => el.getBoundingClientRect().width > 0);
}

/**
 * 收/放输入法但**保留焦点与光标**（用户 261014：「点了 ＋ 之后编辑区的光标会消失」）。
 * 实测：加 inputmode="none" 再 blur() → focus() ⇒ 键盘收起（842）但 activeElement、选区、光标矩形逐项不变；
 * 移除该属性再 blur/focus ⇒ 键盘回来（530）。⚠️ 不要退回「blur() 了事」——焦点与光标会一起没。
 */
function applyImeSuppression(on: boolean): void {
  for (const el of visibleEditables()) {
    if (on) el.setAttribute("inputmode", "none");
    else el.removeAttribute("inputmode");
    try { el.blur(); el.focus(); } catch { /* 忽略 */ }
  }
}

export interface EditSurfaceApi {
  // 面板状态机
  panelMode: PanelMode;
  renderedPanel: Exclude<PanelMode, null>;
  closing: boolean;
  panelHeight: number;
  /** 打开或切换到某个面板（从关到开时捕获键盘区高度；面板间切换沿用原高度 ⇒ 工具栏不抖）。 */
  openPanel: (mode: Exclude<PanelMode, null>) => void;
  /** 收起面板的**唯一出口**：restore = 放回输入法（× / 用户点正文）；hide = 只收键盘但留住光标（⌨ 按钮）。 */
  closePanel: (mode?: "restore" | "hide") => void;
  /**
   * 收起过渡期是否**保持面板内容原样**（不播滑出/淡出）。
   * 261019(八)：restore 档必须为 true —— 键盘是**从面板上方滑上来的**，面板内容保持可见直到被键盘盖住；
   * 提前淡出 = 键盘还在上升、面板先变成一块空白（用户报「闪烁、不丝滑」）。
   */
  closingHold: boolean;
  /** `.med-panel-inner` 的退场 transition 结束：非 hold 档可立即释放占位。 */
  onPanelTransitionEnd: () => void;
  // 几何 / 输入法
  occupation: number;
  kbOffset: number;
  keyboardOpen: boolean;
  keyboardHeight: number;
  suppressIme: () => void;
  restoreIme: () => void;
}

export function useEditSurface(opts: {
  editing: boolean;
  /** dock 根元素：隐藏视图（display:none ⇒ rect 宽 0）不写变量，避免把可见实例的值覆盖掉。 */
  dockRef: RefObject<HTMLElement | null>;
  /** 放回输入法之后把焦点交还正文（DOM + 内核 focus 命令；由 dock 提供）。 */
  restoreFocus: () => void;
}): EditSurfaceApi {
  const { editing, dockRef, restoreFocus } = opts;
  const { base, innerHeight, offset, height, keyboardOpen } = useKeyboard();
  const keyboardHeight = height;
  /** 每个编辑面自己的 blur/focus 重入标记，不再用全应用共享布尔量。 */
  const imeMutationRef = useRef(false);

  // ── 面板状态机 ─────────────────────────────────────────────────────────────
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [closing, setClosing] = useState(false);            // 收起过渡：面板已关但占位还没让出（键盘接管前兜着）
  const [closingHold, setClosingHold] = useState(false);    // 收起过渡期面板内容保持可见（键盘从它上面滑过去；见接口注释）
  const [renderedPanel, setRenderedPanel] = useState<Exclude<PanelMode, null>>("insert");
  /** ⚠️ 面板态必须**同步**写进 ref（守卫/收起在同一 tick 读它）；所有写入统一走 setPanel。 */
  const panelModeRef = useRef<PanelMode>(null);
  const setPanel = useCallback((mode: PanelMode) => { panelModeRef.current = mode; setPanelMode(mode); }, []);
  panelModeRef.current = panelMode;
  const closeTimerRef = useRef<number | null>(null);
  const finishPanelClose = useCallback(() => {
    if (closeTimerRef.current !== null) { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setClosing(false);
    setPanelHeight(0);
    setClosingHold(false);
  }, []);
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;

  useEffect(() => { if (panelMode) setRenderedPanel(panelMode); }, [panelMode]);      // 退场期继续用上一次的模式渲染
  useEffect(() => { if (!editing) setPanel(null); }, [editing, setPanel]);           // 退出编辑态复位
  // 输入法又冒出来 ⇒ 面板占位抬到实测键盘高（打开瞬间的快照在带候选条的真机上会偏小）。
  useEffect(() => {
    if (!panelMode || !keyboardOpen) return;
    setPanelHeight((h) => Math.max(h, keyboardHeight));
  }, [panelMode, keyboardOpen, keyboardHeight]);
  // **等输入法真的回来**再清占位：固定延时会在键盘还没上来时先让出区域 ⇒ 工具栏掉到屏幕底部再弹回来。
  useEffect(() => {
    if (!closing || !keyboardOpen) return;
    const raf = window.requestAnimationFrame(finishPanelClose);
    return () => window.cancelAnimationFrame(raf);
  }, [closing, keyboardOpen, finishPanelClose]);
  // restore 档：面板内容**保持到被键盘盖住**（261019(八)）。若输入法迟迟不来（硬件键盘 / 焦点失败），
  // 1800ms 后放行滑出 —— 实测输入法真正显示/视口收缩可能要 1s+（模拟器负载高时），
  // 太短会让面板在键盘还在上升时先滑走（= 用户报的那次闪烁）；2.5s 兜底仍负责最终卸载。
  useEffect(() => {
    if (!closing || !closingHold || keyboardOpen) return;
    const t = window.setTimeout(() => setClosingHold(false), 1800);
    return () => window.clearTimeout(t);
  }, [closing, closingHold, keyboardOpen]);
  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current); }, []);

  const setImeSuppressed = useCallback((on: boolean) => {
    if (imeMutationRef.current) return;
    imeMutationRef.current = true;
    try { applyImeSuppression(on); }
    finally { imeMutationRef.current = false; }
  }, []);
  const suppressIme = useCallback(() => setImeSuppressed(true), [setImeSuppressed]);
  const restoreIme = useCallback(() => setImeSuppressed(false), [setImeSuppressed]);

  const openPanel = useCallback((mode: Exclude<PanelMode, null>) => {
    setClosing(false);
    if (!panelModeRef.current) setPanelHeight(capturePanelHeight(keyboardHeight));   // 只在"从关到开"时捕获
    setPanel(mode);
    // 同一帧挂面板、下一帧才收输入法：键盘是在已经铺满该区域的面板背后滑走的（不与面板对撞）。
    requestAnimationFrame(() => suppressIme());
  }, [setPanel, keyboardHeight, suppressIme]);

  const closePanel = useCallback((mode: "restore" | "hide" = "restore") => {
    setPanel(null);                                   // 先同步置空 ref（守卫读它）
    setClosing(true);
    setClosingHold(mode === "restore");               // restore = 键盘从面板上方滑上来 ⇒ 内容保持到被盖住
    if (mode === "restore") { restoreIme(); restoreFocusRef.current(); }   // ×/点正文：把键盘放回来
    else suppressIme();                                                    // ⌨：只收键盘、光标留住
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(finishPanelClose, 2500);     // 兜底：键盘没回来也不能永远占着
  }, [setPanel, restoreIme, suppressIme, finishPanelClose]);

  const onPanelTransitionEnd = useCallback(() => {
    if (closing && !closingHold) finishPanelClose();
  }, [closing, closingHold, finishPanelClose]);

  // ── 几何 ───────────────────────────────────────────────────────────────────
  const occupation = bottomOccupation({ panelOpen: !!panelMode, closing, panelHeight, keyboardOpen, keyboardHeight });
  const kbOffset = dockKbOffset({ panelOpen: !!panelMode, closing, innerHeight, shellHeight: base, panelHeight, edgeToEdgeOffset: offset });

  // 外壳高度 = 稳定外壳高 − 底部占用（写到 :root，消费方是各编辑面的滚动容器）。
  //  ⚠️ 必须 useLayoutEffect（绘制前落地）：否则 vh 系的内核规则会先按旧视口算一次、被内容撑住，之后缩不回去。
  useLayoutEffect(() => {
    if (!editing || !base) return;                     // base=0 = 还没量到视口 ⇒ 不写（否则外壳会变 0px）
    const dock = dockRef.current;
    if (!dock || !dock.getBoundingClientRect().width) return;
    const root = document.documentElement;
    const value = `${shellSurfaceHeight(base, occupation)}px`;
    root.style.setProperty("--mb-app-h", value);
    return () => { if (root.style.getPropertyValue("--mb-app-h") === value) root.style.removeProperty("--mb-app-h"); };
  }, [editing, base, occupation, dockRef]);

  // ── 焦点守卫 ───────────────────────────────────────────────────────────────
  const closePanelRef = useRef(closePanel);
  closePanelRef.current = closePanel;
  useEffect(() => {
    const surfaceVisible = () => !!dockRef.current?.getBoundingClientRect().width;
    const isEditor = (node: EventTarget | null) => {
      const t = node as HTMLElement | null;
      return !!t && typeof t.closest === "function" && !!t.closest('[contenteditable="true"]');
    };
    // 用户**手指点正文**（面板开着）= 要打字 ⇒ 收面板 + 放回输入法。
    //  ⚠️ 判据必须放 pointerdown、不能放 focusin：面板期正文一直保持焦点（这是「光标不消失」的前提），
    //  点它不会再触发 focusin；也不能用「上次点过」的布尔量（会被上一次点击留下 true，再被我们自己抑制
    //  输入法时的 blur/focus 触发 ⇒ 误判 ⇒ 面板开了 ~0.6s 自己关掉，261014 实测）。
    const onPointerDown = (e: PointerEvent) => {
      if (!surfaceVisible() || !panelModeRef.current || !isEditor(e.target)) return;
      closePanelRef.current();
    };
    // 内核命令后把焦点抢回正文：**只写 inputmode、绝不 blur**（blur 会把光标一起收掉），也不再调抑制函数（会递归）。
    const onFocusIn = (e: FocusEvent) => {
      if (imeMutationRef.current || !surfaceVisible() || !panelModeRef.current || !isEditor(e.target)) return;
      try { (e.target as HTMLElement).setAttribute("inputmode", "none"); } catch { /* 忽略 */ }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [dockRef]);

  return { panelMode, renderedPanel, closing, closingHold, panelHeight, openPanel, closePanel, onPanelTransitionEnd, occupation, kbOffset, keyboardOpen, keyboardHeight, suppressIme, restoreIme };
}
