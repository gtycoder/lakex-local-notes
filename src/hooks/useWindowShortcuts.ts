import { useEffect, useRef } from "react";

export interface WindowShortcutHandlers {
  onOpenSearch: () => void;
  onToggleFocus: () => void;
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
      if (event.key === "Escape") latest.current.onEscape();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
