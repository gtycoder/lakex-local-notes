import { useEffect, useState } from "react";
import { formFactorOf, type FormFactor } from "./formFactor";

/**
 * React 侧读形态档：首帧同步读窗口宽（不闪），之后跟随 600 / 800 两个断点与 resize。
 * 与 installFormFactor 共用同一组断点（formFactorOf），不重复定义数值。
 */
export function useFormFactor(): FormFactor {
  const [formFactor, setFormFactor] = useState<FormFactor>(() => formFactorOf(window.innerWidth));

  useEffect(() => {
    const update = (): void => setFormFactor(formFactorOf(window.innerWidth));
    const wide = window.matchMedia(`(min-width: ${600}px)`);
    const widest = window.matchMedia(`(min-width: ${800}px)`);
    wide.addEventListener("change", update);
    widest.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    update();
    return () => {
      wide.removeEventListener("change", update);
      widest.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return formFactor;
}
