import { useEffect, useRef } from "react";

export interface WindowShortcutHandlers {
  onOpenSearch: () => void;
  onToggleFocus: () => void;
  /** ⌘]（Feishu 口径）：收起/固定目录栏。可省略——移动端/无目录栏场景不传。 */
  onToggleSidebarDock?: () => void;
  onEscape: () => void;
}

/** One capture-phase listener for app-level shortcuts; editor handlers cannot swallow ⌘K. */
export function useWindowShortcuts(handlers: WindowShortcutHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        latest.current.onToggleFocus();
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        latest.current.onOpenSearch();
        return;
      }
      // ⌘]（Feishu 口径）：收起/固定目录栏。capture 阶段 + preventDefault，
      // 免得焦点在编辑器时被内核/浏览器先吃掉（260923 隔离实例实测：内核未占用该组合键）。
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "]") {
        event.preventDefault();
        latest.current.onToggleSidebarDock?.();
        return;
      }
      if (event.key === "Escape") latest.current.onEscape();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
