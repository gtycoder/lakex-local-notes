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
 * 消费者：EditorDock（渲染 + 命令）、MobileUsheetViewer（表格编辑面，261028 MOB-07 接入）。
 * 新增编辑面时复用本 hook，不要再各自实现这几件事；与文档编辑面不同的口径（作用域 / 占位下限 / 默认面板 /
 * 是否接管外壳高 / 焦点守卫）走 EditSurfaceOptions 的显式参数，默认值 = 文档编辑面的既有行为。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useKeyboard } from "../hooks/useKeyboard";
import { bottomOccupation, capturePanelHeight, dockKbOffset, shellSurfaceHeight } from "./editSurfaceModel";

export type PanelMode = "insert" | "font" | "more" | "emoji" | null;

/** 编辑面的可编辑宿主（只取当前可见的，避免动到 keep-alive 隐藏视图）；scope = 只要容器内那份（表格）。 */
function visibleEditables(scope: HTMLElement | null): HTMLElement[] {
  const all = scope
    ? Array.from(scope.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
    : Array.from(document.querySelectorAll<HTMLElement>('[contenteditable="true"]'));
  return all.filter((el) => el.getBoundingClientRect().width > 0);
}

/**
 * 收/放输入法但**保留焦点与光标**（用户 261014：「点了 ＋ 之后编辑区的光标会消失」）。
 * 实测：加 inputmode="none" 再 blur() → focus() ⇒ 键盘收起（842）但 activeElement、选区、光标矩形逐项不变；
 * 移除该属性再 blur/focus ⇒ 键盘回来（530）。⚠️ 不要退回「blur() 了事」——焦点与光标会一起没。
 *
 * scope（表格宿主）：只处理容器内当前焦点元素、**不回焦**（表格的公式栏 onFocus 会把刚打开的面板反向关掉）；
 * 恢复时摘掉容器内所有 inputmode="none"（含内核自己写进去的）。
 */
function applyImeSuppression(on: boolean, scope: HTMLElement | null, refocus: boolean): void {
  if (scope) {
    if (on) {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !scope.contains(active)) return;
      active.setAttribute("inputmode", "none");
      // blur/focus 是尽力而为的 DOM 操作；失败时 inputmode 抑制已生效，不影响键盘收放。
      try { active.blur(); if (refocus) active.focus(); } catch { /* 元素已卸载/不可聚焦：无副作用 */ }
      return;
    }
    scope.querySelectorAll<HTMLElement>('[inputmode="none"]').forEach((el) => el.removeAttribute("inputmode"));
    return;
  }
  for (const el of visibleEditables(null)) {
    if (on) el.setAttribute("inputmode", "none");
    else el.removeAttribute("inputmode");
    try { el.blur(); if (refocus) el.focus(); } catch { /* 同上：inputmode 已写好，失焦失败不影响抑制 */ }
  }
}

export interface EditSurfaceApi<M extends string = Exclude<PanelMode, null>> {
  // 面板状态机
  panelMode: M | null;
  /** 退场期继续按上一次的面板渲染；从未打开过 = null（表格侧无默认面板）。 */
  renderedPanel: M | null;
  closing: boolean;
  panelHeight: number;
  /** 打开或切换到某个面板（从关到开时捕获键盘区高度；面板间切换沿用原高度 ⇒ 工具栏不抖）。 */
  openPanel: (mode: M) => void;
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

/**
 * 编辑面复用的**口径参数**（261028 MOB-07：表格编辑面接同一 owner）。
 * 全部默认 = 文档编辑面（EditorDock）的既有行为；不传任何一项时行为与本轮改动前逐项一致。
 */
export interface EditSurfaceOptions<M extends string> {
  editing: boolean;
  /** dock 根元素：隐藏视图（display:none ⇒ rect 宽 0）不写变量，避免把可见实例的值覆盖掉。 */
  dockRef: RefObject<HTMLElement | null>;
  /** 放回输入法之后把焦点交还正文（DOM + 内核 focus 命令；由 dock 提供）。 */
  restoreFocus: () => void;
  /** 首个 renderedPanel（默认 "insert" = 文档编辑面常驻插入面板）。表格侧没有默认面板 ⇒ null。 */
  panelDefault?: M | null;
  /** 面板占位下限（默认 280 = 文档编辑面实测口径；表格「更多」7 行 / T 面板要 300）。 */
  minPanelHeight?: number;
  /** 捕获占位高时用的键盘高（默认 = 当前实测值；表格传历史最大键盘高，兜住"打开面板时键盘已收起"）。 */
  keyboardHeightHint?: number;
  /** 输入法抑制的作用域（默认 = 整篇 document 的可见可编辑元素；表格传自己的宿主容器）。 */
  scopeRef?: RefObject<HTMLElement | null>;
  /** 抑制输入法时 blur 后是否回焦（默认 true = 文档「留住光标」口径）。 */
  refocusOnSuppress?: boolean;
  /** 是否安装「用户点正文 → 收面板 + 放回输入法」的焦点守卫（默认 true）。 */
  focusGuard?: boolean;
  /** 是否写 --mb-app-h（默认 true = 文档外壳高；表格用自己的 --mb-usheet-kb-offset，不接管外壳）。 */
  writeAppHeight?: boolean;
}

export function useEditSurface<M extends string = Exclude<PanelMode, null>>(opts: EditSurfaceOptions<M>): EditSurfaceApi<M> {
  const {
    editing, dockRef, restoreFocus,
    panelDefault = "insert" as unknown as M,
    minPanelHeight = 280,
    keyboardHeightHint = 0,
    scopeRef,
    refocusOnSuppress = true,
    focusGuard = true,
    writeAppHeight = true,
  } = opts;
  const { base, innerHeight, offset, height, keyboardOpen } = useKeyboard();
  const keyboardHeight = height;
  /** 每个编辑面自己的 blur/focus 重入标记，不再用全应用共享布尔量。 */
  const imeMutationRef = useRef(false);

  // ── 面板状态机 ─────────────────────────────────────────────────────────────
  const [panelMode, setPanelMode] = useState<M | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const [closing, setClosing] = useState(false);            // 收起过渡：面板已关但占位还没让出（键盘接管前兜着）
  const [closingHold, setClosingHold] = useState(false);    // 收起过渡期面板内容保持可见（键盘从它上面滑过去；见接口注释）
  const [renderedPanel, setRenderedPanel] = useState<M | null>(panelDefault);
  /** ⚠️ 面板态必须**同步**写进 ref（守卫/收起在同一 tick 读它）；所有写入统一走 setPanel。 */
  const panelModeRef = useRef<M | null>(null);
  const setPanel = useCallback((mode: M | null) => { panelModeRef.current = mode; setPanelMode(mode); }, []);
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

  // 退场期继续用上一次的模式渲染。⚠️ 必须 layout 阶段：表格侧 panelDefault=null（没有常驻面板内容），
  // 若放到 useEffect 会在"面板已打开"的那一帧先画一个空壳，下一帧才出现内容（文档侧 default="insert" 掩盖了这一点）。
  useLayoutEffect(() => { if (panelMode) setRenderedPanel(panelMode); }, [panelMode]);
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
    try { applyImeSuppression(on, scopeRef?.current ?? null, refocusOnSuppress); }
    finally { imeMutationRef.current = false; }
  }, [scopeRef, refocusOnSuppress]);
  const suppressIme = useCallback(() => setImeSuppressed(true), [setImeSuppressed]);
  const restoreIme = useCallback(() => setImeSuppressed(false), [setImeSuppressed]);

  const openPanel = useCallback((mode: M) => {
    setClosing(false);
    // 只在"从关到开"时捕获；下限与键盘高口径按编辑面参数（文档 280 / 表格 300 + 历史最大键盘高）。
    if (!panelModeRef.current) setPanelHeight(capturePanelHeight(Math.max(keyboardHeight, keyboardHeightHint), minPanelHeight));
    setPanel(mode);
    // 同一帧挂面板、下一帧才收输入法：键盘是在已经铺满该区域的面板背后滑走的（不与面板对撞）。
    requestAnimationFrame(() => suppressIme());
  }, [setPanel, keyboardHeight, keyboardHeightHint, minPanelHeight, suppressIme]);

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
    if (!writeAppHeight || !editing || !base) return;  // 表格不接管外壳高；base=0 = 还没量到视口 ⇒ 不写（否则外壳会变 0px）
    const dock = dockRef.current;
    if (!dock || !dock.getBoundingClientRect().width) return;
    const root = document.documentElement;
    const value = `${shellSurfaceHeight(base, occupation)}px`;
    root.style.setProperty("--mb-app-h", value);
    return () => { if (root.style.getPropertyValue("--mb-app-h") === value) root.style.removeProperty("--mb-app-h"); };
  }, [writeAppHeight, editing, base, occupation, dockRef]);

  // ── 焦点守卫 ───────────────────────────────────────────────────────────────
  const closePanelRef = useRef(closePanel);
  closePanelRef.current = closePanel;
  useEffect(() => {
    if (!focusGuard) return;                           // 表格的输入面是 canvas/原生公式栏，面板只由 dock 按钮开合
    const surfaceVisible = () => !!dockRef.current?.getBoundingClientRect().width;
    const isEditor = (node: EventTarget | null) => {
      const t = node as HTMLElement | null;
      return !!t && typeof t.closest === "function" && !!t.closest('[contenteditable="true"]');
    };
    /** 有作用域时只认容器内的节点（多实例/表格与文档同屏时不互相抢）。 */
    const inScope = (node: EventTarget | null) => {
      const scope = scopeRef?.current;
      if (!scope) return true;
      const t = node as Node | null;
      return !!t && scope.contains(t);
    };
    // 用户**手指点正文**（面板开着）= 要打字 ⇒ 收面板 + 放回输入法。
    //  ⚠️ 判据必须放 pointerdown、不能放 focusin：面板期正文一直保持焦点（这是「光标不消失」的前提），
    //  点它不会再触发 focusin；也不能用「上次点过」的布尔量（会被上一次点击留下 true，再被我们自己抑制
    //  输入法时的 blur/focus 触发 ⇒ 误判 ⇒ 面板开了 ~0.6s 自己关掉，261014 实测）。
    const onPointerDown = (e: PointerEvent) => {
      if (!surfaceVisible() || !panelModeRef.current || !isEditor(e.target) || !inScope(e.target)) return;
      closePanelRef.current();
    };
    // 内核命令后把焦点抢回正文：**只写 inputmode、绝不 blur**（blur 会把光标一起收掉），也不再调抑制函数（会递归）。
    const onFocusIn = (e: FocusEvent) => {
      if (imeMutationRef.current || !surfaceVisible() || !panelModeRef.current || !isEditor(e.target) || !inScope(e.target)) return;
      try { (e.target as HTMLElement).setAttribute("inputmode", "none"); } catch { /* 目标在事件派发后已卸载：属性写失败无副作用 */ }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [dockRef, focusGuard, scopeRef]);

  return { panelMode, renderedPanel, closing, closingHold, panelHeight, openPanel, closePanel, onPanelTransitionEnd, occupation, kbOffset, keyboardOpen, keyboardHeight, suppressIme, restoreIme };
}
