/**
 * 移动端路由转场（首页 ↔ 工作区）的**状态机 + 单一来源**（261019，对齐语雀 push）。
 *
 * 形态：新页自右滑入（100%→0），旧页左移 25% 做视差；返回反向。
 * CSS 实现在 `mobile.css` 的 `.mobile-route-stage / .mobile-route-layer`；时长 = `--lake-motion-slow`(240ms)。
 * 工作区层 = **按需挂载、播完出场才卸载**；首页层常驻（页栈语义）⇒ 返回时列表滚动位置与数据都在。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** 与 `--lake-motion-slow`（240ms）一致；护栏 `useRouteTransition.test.ts` 会钉住。 */
export const ROUTE_TRANSITION_MS = 240;

/** 返回首页的等待时长：reduced-motion 下不需要等待动画（直接切）。 */
export function routeTransitionMs(reduceMotion: boolean): number {
  return reduceMotion ? 0 : ROUTE_TRANSITION_MS;
}

/** 系统是否要求减少动效（移动端 a11y 口径；测试环境无 window 时按 false）。 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type RouteKind = "home" | "notebook";

export interface RouteTransition {
  /** 工作区层是否在 DOM 里（出场动画播完才变 false）。 */
  mounted: boolean;
  /** 是否处于"工作区已展开"位移状态（push 完 = true；pop 开始 = false）。 */
  open: boolean;
  /**
   * 入场位移**播完**（open 后再等一个转场时长）为 true；出场开始立刻变 false。
   * 消费方给工作区层挂 `is-settled` ⇒ **撤掉 transform / will-change**，让 position:fixed 的包含块
   * 从 layer 盒回到视口（否则编辑 dock 的面板会被钉在 `--mb-app-h` 下沿 = 键盘上方，261019 用户报）。
   */
  settled: boolean;
  /**
   * 转场位移是否**正在进行**（push/pop 都算，含 reduced-motion 的极短窗口）。
   * 只有它为 true 时才给层挂 `will-change:transform`（见 mobile.css 的 `.is-animating`）——
   * 常驻 will-change 本身就会把 position:fixed 的包含块改成 layer 盒，导致编辑面板错位（261020）。
   */
  animating: boolean;
  /** 返回首页：先播出场，结束（240ms / reduced-motion 0ms）后回调 `onClosed` 并卸载工作区。 */
  close: () => void;
  homeRef: RefObject<HTMLDivElement>;
  wsRef: RefObject<HTMLDivElement>;
}

export function useRouteTransition(routeKind: RouteKind, onClosed: () => void): RouteTransition {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [settled, setSettled] = useState(false);
  const [animating, setAnimating] = useState(false);
  const homeRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef(0);
  const closingRef = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  // 进入工作区先挂载（此时层在 translateX(100%)），下一帧再播放位移动画
  useEffect(() => {
    if (routeKind === "notebook") setMounted(true);
  }, [routeKind]);

  useEffect(() => {
    if (!mounted || routeKind !== "notebook" || closingRef.current) return;
    // 与 open 同一次 render 开 will-change：否则首帧已经位移、下一帧才提升层，白丢一帧。
    const raf = requestAnimationFrame(() => { setAnimating(true); setOpen(true); });
    return () => cancelAnimationFrame(raf);
  }, [mounted, routeKind]);

  // 入场位移播完 ⇒ settled（出场开始立刻失效）。转场期间 transform 让 fixed 以 layer 为包含块；
  // settled 后撤掉它，fixed 才回到**视口** —— 否则编辑 dock 的面板会被钉在 --mb-app-h 下沿（键盘上方），
  // 下方留一片空白（261019 用户报「工具栏展开跑到键盘上边」）。多等 50ms 覆盖 transition 的收尾帧。
  useEffect(() => {
    if (!open) { setSettled(false); return; }
    const t = window.setTimeout(() => { setSettled(true); setAnimating(false); }, routeTransitionMs(prefersReducedMotion()) + 50);
    return () => window.clearTimeout(t);
  }, [open]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setOpen(false);
    setAnimating(true);                       // 出场也要位移 ⇒ 转场期间才挂 will-change
    closeTimerRef.current = window.setTimeout(() => {
      onClosedRef.current();
      setMounted(false);
      setAnimating(false);
      closingRef.current = false;
    }, routeTransitionMs(prefersReducedMotion()));
  }, []);

  // 卸载时清掉未完成的转场定时器
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  // 非活动层 inert + aria-hidden：首页挂载着但工作区在上面时，焦点/读屏不能摸到下层
  useEffect(() => {
    const homeActive = routeKind === "home";
    if (homeRef.current) {
      homeRef.current.toggleAttribute("inert", !homeActive);
      homeRef.current.setAttribute("aria-hidden", String(!homeActive));
    }
    if (wsRef.current) wsRef.current.toggleAttribute("inert", homeActive);
  }, [routeKind, mounted]);

  return { mounted, open, settled, animating, close, homeRef, wsRef };
}
