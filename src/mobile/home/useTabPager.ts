/**
 * 首页横向分页的 **DOM 适配层**（261028 MOB-03）。
 *
 * 职责只有三件：① 把原生事件翻译成 reducePager 的事件；② 执行转场给出的唯一动作（scrollTo）；
 * ③ 把"滚动过半"得到的 tab 回写给父级。判据与状态机全在 tabPager.ts（纯函数 + 单测），这里不判断页码。
 *
 * 定时器只有一处，且**只在没有 scrollend 的旧 WebView 上**才挂（Android WebView < 114 的 Chromium 没有 scrollend）：
 * 程序化滚动开始时挂一个**单次**兜底，到点按当前 scrollLeft 派发 settled。理由：老的 600ms 常驻定时器是
 * "每次 align 都压住回写 600ms"，它既是四份 ref 镜像之一，又会让点 tab 后的手势被静默吞掉；
 * 现在有 scrollend 就完全不用定时器（settled 由原生事件派发），没有才补一次。
 */
import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { initialPagerState, reducePager, type HomeTab, type PagerEvent, type PagerState } from "./tabPager";

/** 没有 scrollend 时的兜底：要长于一次平滑吸附（实测约 300–500ms），又不能把程序化态拖太久。 */
const SETTLE_FALLBACK_MS = 600;

function supportsScrollend(): boolean {
  return typeof window !== "undefined" && "onscrollend" in window;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface TabPagerOptions {
  /** 父级/路由当前的 tab（点击顶部 tab 也会走到这里）。 */
  tab: HomeTab;
  /** 滚动过半时回写 tab 的唯一出口。 */
  onTabChange: (tab: HomeTab) => void;
}

export interface TabPagerApi {
  /** 横向滚动容器（.mobile-tab-stage）。 */
  stageRef: RefObject<HTMLDivElement>;
}

export function useTabPager({ tab, onTabChange }: TabPagerOptions): TabPagerApi {
  const stageRef = useRef<HTMLDivElement>(null);
  /** 状态只有这一份（不再有 interacting/commitByScroll/programmatic 三份镜像 ref）。 */
  const stateRef = useRef<PagerState>(initialPagerState(tab));
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  const fallbackTimerRef = useRef(0);
  const dispatchRef = useRef<(event: PagerEvent) => void>(() => {});

  const dispatch = useCallback((event: PagerEvent) => {
    const transition = reducePager(stateRef.current, event);
    stateRef.current = transition.state;
    const el = stageRef.current;
    const effect = transition.effect;
    if (effect && el) {
      // DOM 唯一动作。动效按 prefers-reduced-motion 降级（判据留在 DOM 侧，状态机不关心无障碍）。
      el.scrollTo({ left: effect.scrollLeft, behavior: prefersReducedMotion() ? "auto" : effect.behavior });
      // 回告状态机：这次滚动是程序化发起的（随后的 scroll 事件不得回写 tab）。
      dispatchRef.current({ type: "programmatic-start" });
      if (!supportsScrollend()) {
        window.clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = window.setTimeout(() => {
          dispatchRef.current({ type: "settled", scrollLeft: el.scrollLeft });
        }, SETTLE_FALLBACK_MS);
      }
    }
    if (transition.commitTab) onTabChangeRef.current(transition.commitTab);
  }, []);
  dispatchRef.current = dispatch;

  // tab → 滚动位置：点顶部 tab / 父级改路由 / 离开后回来都在这里对齐（同 tab 时只销账）。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    dispatch({ type: "tab-click", tab, scrollLeft: el.scrollLeft, width: el.clientWidth });
  }, [tab, dispatch]);

  // 原生事件接线：只挂一次（监听里用 ref 读最新状态）。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onScroll = (): void => dispatch({ type: "scroll", scrollLeft: el.scrollLeft });
    const onScrollEnd = (): void => dispatch({ type: "settled", scrollLeft: el.scrollLeft });
    const onTouchStart = (): void => dispatch({ type: "user-scroll-start" });
    const onTouchEnd = (): void => dispatch({ type: "user-scroll-end" });
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", onScrollEnd);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    // ResizeObserver 单独挂一次（若跟着 tab 变化重建，初始回调会在 smooth 之后再来一次 auto，把动画当场取消）。
    const ro = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => dispatch({ type: "resize", scrollLeft: el.scrollLeft, width: el.clientWidth }));
    ro?.observe(el);
    return () => {
      window.clearTimeout(fallbackTimerRef.current);
      ro?.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", onScrollEnd);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [dispatch]);

  return { stageRef };
}
