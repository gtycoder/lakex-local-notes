import { useEffect, useState } from "react";
import { FORM_FACTOR_BREAKPOINTS, formFactorOf, type FormFactor } from "./formFactor";

/**
 * React 侧读形态档：首帧同步读窗口宽（不闪），之后跟随 600 / 800 两个断点与 resize。
 * 与 installFormFactor 共用同一组断点（formFactorOf / FORM_FACTOR_BREAKPOINTS），不重复定义数值。
 * jsdom / 老 WebView 没有 matchMedia 时只靠 resize（不要因此崩掉组件树）。
 */
export function useFormFactor(): FormFactor {
  const [formFactor, setFormFactor] = useState<FormFactor>(() => formFactorOf(window.innerWidth));

  useEffect(() => {
    const update = (): void => setFormFactor(formFactorOf(window.innerWidth));
    const media = (minWidth: number): MediaQueryList | null =>
      typeof window.matchMedia === "function" ? window.matchMedia(`(min-width: ${minWidth}px)`) : null;
    const wide = media(FORM_FACTOR_BREAKPOINTS.medium);
    const widest = media(FORM_FACTOR_BREAKPOINTS.expanded);
    wide?.addEventListener("change", update);
    widest?.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    update();
    return () => {
      wide?.removeEventListener("change", update);
      widest?.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return formFactor;
}
