import { useEffect, useState } from "react";

/**
 * 表格编辑态的「键盘是否弹出」轻量判据（只返回布尔，避免 useKeyboard 那套 innerHeight 高频 state 抖动）。
 * 判据沿用 AGENTS：innerHeight 相对稳定外壳高收缩 > 200px = 键盘弹起。
 */
export function useSheetKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let base = window.innerHeight;
    const update = () => {
      const ih = window.innerHeight;
      if (ih > base) base = ih;
      const next = base - ih > 200;
      setOpen((prev) => (prev === next ? prev : next));
    };
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    update();
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return open;
}
