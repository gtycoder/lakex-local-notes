import { useEffect, useRef, useState } from "react";
import { activeEditorMount } from "../features/editor/activeEditor";
import { editorInstanceAt } from "../features/editor/editorRegistry";
import { kernelWordCount, resolveDocStats, type DocStats } from "../core/docStats";

interface StatsTab {
  noteId: string;
  content: string;
  reloadKey?: number;
}

/**
 * 当前显示中的文档内核实例（活动性判据唯一来源 = 宿主 data-active，见 activeEditor.ts）。
 * 拿不到就返回 null —— 此时字数走正文兜底（锁定预览 / 未挂载 / 非 doc 宿主）。
 */
function currentDocEditor() {
  return editorInstanceAt(activeEditorMount());
}

/**
 * 读当前文档统计（261016，B1）：字数优先内核 queryCommandValue('wordCount')，
 * 正文只承担兜底与图片数（内核没有图片数查询）。
 */
function readStats(content: string): DocStats {
  return resolveDocStats(kernelWordCount(currentDocEditor()), content);
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
      setStats(readStats(content));
      return;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setStats(readStats(content));
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
