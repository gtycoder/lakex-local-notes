import { useEffect, useRef, useState } from "react";
import { computeDocStats, type DocStats } from "../lib/docStats";

interface StatsTab {
  noteId: string;
  content: string;
  reloadKey?: number;
}

/** Debounced current-document statistics kept separate from the App shell state. */
export function useDocumentStats(tabs: StatsTab[], activeNoteId: string | null, mobileDocumentId: string | null, mobileContent: string): DocStats {
  const [stats, setStats] = useState<DocStats>({ wordCount: 0, imageCount: 0 });
  const timerRef = useRef<number | null>(null);
  const keyRef = useRef("");

  useEffect(() => {
    const tab = tabs.find((item) => item.noteId === activeNoteId);
    const content = tab?.content ?? mobileContent;
    const key = activeNoteId
      ? `tab:${activeNoteId}:${tab?.reloadKey ?? 0}`
      : `mobile:${mobileDocumentId ?? "none"}`;
    if (keyRef.current !== key) {
      keyRef.current = key;
      setStats(computeDocStats(content));
      return;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setStats(computeDocStats(content));
    }, 300);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [tabs, activeNoteId, mobileDocumentId, mobileContent]);

  return stats;
}
