/**
 * 「返回键两次退出」的唯一判据（261106 用户要求：首页按一次返回不再直接退 App，避免误触）。
 *
 * 语义：调用 = 首页兜底那一次按键。
 *  · 第一次：提示「再按一次退出应用」并记下时间；
 *  · **2 秒内**再按：真正 exit；
 *  · 超过 2 秒：重新计时并再次提示（不退出）。
 * 只负责「首页最终兜底」这一处；浮层/小记/Sheet/Drawer/工作区 的优先级仍由 useBackHandler 原样给出。
 */
import { useCallback, useRef } from "react";
import { showToast } from "../ui/toastBus";

/** 两次返回的判定窗口（毫秒）。 */
export const DOUBLE_BACK_WINDOW_MS = 2000;
/** 第一次按下时的提示文案（用户点单原句）。 */
export const DOUBLE_BACK_HINT = "再按一次退出应用";

/** 纯判据：lastAt 之后 now 这次按键是否落在窗口内（含边界）。 */
export function isSecondBack(lastAt: number, now: number, windowMs = DOUBLE_BACK_WINDOW_MS): boolean {
  if (!(lastAt > 0) || !Number.isFinite(lastAt) || !Number.isFinite(now)) return false;
  const gap = now - lastAt;
  return gap >= 0 && gap <= windowMs;
}

export interface DoubleBackExitOptions {
  /** 第二次按下时真正退出（MobileApp 传 exitApp）。 */
  exit: () => void;
  /** 第一次按下的可见提示（默认 showToast）。 */
  hint?: (message: string) => void;
  windowMs?: number;
  /** 时间源（测试注入）。 */
  now?: () => number;
}

export function useDoubleBackExit({ exit, hint = showToast, windowMs = DOUBLE_BACK_WINDOW_MS, now = Date.now }: DoubleBackExitOptions): () => void {
  const armedAt = useRef(0);
  const exitRef = useRef(exit);
  exitRef.current = exit;
  const hintRef = useRef(hint);
  hintRef.current = hint;
  const nowRef = useRef(now);
  nowRef.current = now;
  return useCallback(() => {
    const at = nowRef.current();
    if (isSecondBack(armedAt.current, at, windowMs)) {
      armedAt.current = 0;
      exitRef.current();
      return;
    }
    armedAt.current = at;
    hintRef.current(DOUBLE_BACK_HINT);
  }, [windowMs]);
}
