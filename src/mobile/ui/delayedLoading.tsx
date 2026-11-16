/**
 * 延迟加载（261116 移动端加载动效 A）：把「等待」与「加载态」解耦。
 *
 * 背景：移动端多处懒加载/Suspense 兜底是**立刻**闪一句「正在加载…」——本机 SQLite 与分包加载
 * 通常 <300ms，用户看到的是「闪一下」。行业口径（用户模板 1200ms 阈值）搬到本仓如下：
 *   · 超过 300ms 才承认在等（LOADING_DELAY_MS）：<300ms 的快操作直接出结果，不显示加载态；
 *   · 一旦显示，至少停留 500ms（LOADING_MIN_VISIBLE_MS）：避免「刚显示就消失」的第二次闪。
 * 这两个数是**行为阈值**不是动画时长，故不占 --lake-motion-* 令牌位（动画仍统一 250ms ease-out）。
 *
 * 用法：
 *   const showLoading = useDelayedLoading(loading);            // 状态驱动（可延住 500ms）
 *   <Suspense fallback={<DelayedLoading><X/></DelayedLoading>}>  // 分包兜底（只延迟出现；组件卸载即消失，无法延住）
 *
 * 红线：只控制「显示与否」，不新增动画、不碰 rAF/相位门控；入场动画仍走 --mobile-duration-panel + ease-out。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

/** 超过该时长才显示加载态（低于它视作「瞬时」，直接出结果）。 */
export const LOADING_DELAY_MS = 300;
/** 加载态一旦显示，最短可见时长（防止闪一下）。 */
export const LOADING_MIN_VISIBLE_MS = 500;

export interface DelayedLoadingOptions {
  /** 覆盖延迟阈值（测试/长任务专用；默认 LOADING_DELAY_MS）。 */
  delayMs?: number;
  /** 覆盖最短可见时长（默认 LOADING_MIN_VISIBLE_MS）。 */
  minVisibleMs?: number;
}

/**
 * 状态驱动的延迟加载：loading=true 后 delayMs 才返回 true；loading 结束若未满 minVisibleMs 则延住。
 * 快操作（loading 在 delayMs 内结束）全程返回 false ⇒ 调用方直接渲染最终内容，不闪加载态。
 */
export function useDelayedLoading(loading: boolean, options: DelayedLoadingOptions = {}): boolean {
  const delayMs = options.delayMs ?? LOADING_DELAY_MS;
  const minVisibleMs = options.minVisibleMs ?? LOADING_MIN_VISIBLE_MS;
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
    clear();
    if (loading) {
      if (visible) return clear;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        shownAtRef.current = Date.now();
        setVisible(true);
      }, delayMs);
      return clear;
    }
    if (!visible) return clear;
    const remaining = minVisibleMs - (Date.now() - shownAtRef.current);
    if (remaining > 0) {
      timerRef.current = setTimeout(() => { timerRef.current = null; setVisible(false); }, remaining);
      return clear;
    }
    setVisible(false);
    return clear;
  }, [loading, visible, delayMs, minVisibleMs]);

  return visible;
}

/**
 * Suspense 兜底专用：挂载后 delayMs 才渲染 children（快分包不闪文字/骨架）。
 * ⚠️ 组件被父级卸载即消失，所以**不能**保证最短可见时长；需要延住时用 useDelayedLoading。
 */
export function DelayedLoading({ children, delayMs = LOADING_DELAY_MS }: { children: ReactNode; delayMs?: number }) {
  const [shown, setShown] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) return;
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return shown ? <>{children}</> : null;
}
