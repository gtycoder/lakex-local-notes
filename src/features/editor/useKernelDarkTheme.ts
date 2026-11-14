import { useEffect, useState } from "react";

/**
 * 跟随应用主题（`<html data-theme>`，见 App.tsx / main.tsx）的 dark 判据。
 * 内核 wrapper 组件（BookmarkToolbar 等）需要一个 dark 布尔值做配色；
 * 运行时切主题要跟着变，所以用 MutationObserver 而不是渲染时读一次。
 */
export function useKernelDarkTheme(): boolean {
  const read = () => document.documentElement.getAttribute("data-theme") === "dark";
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    setDark(read());
    return () => observer.disconnect();
  }, []);
  return dark;
}
