import { useEffect, useMemo, useState } from "react";
import {
  QUICK_NOTE_SORT_OPTIONS,
  sortQuickNotes,
  type QuickNoteSort,
} from "../../core/quickNoteSort";
import { buildQuickNoteTagIndex, filterQuickNotesByTag, type QuickNoteTagFilter, type QuickNoteTag } from "../../core/quickNoteTags";
import { readQuickNoteSort, writeQuickNoteSort } from "../../lib/quickNoteSortPref";
import type { QuickNoteDetail } from "./useQuickNoteDetailCache";

export interface QuickNoteListSource {
  id: string;
  previewText: string;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
  firstImage: string | null;
  body?: string;
  images?: import("../../core/quickNoteModel.js").StoredQuickNoteImage[];
  tags: string[];
  tagIds: string[];
}

/** 小记列表展示模型：详情合并、标签索引、筛选、排序与本机排序偏好。 */
export function useQuickNoteListModel<T extends QuickNoteListSource>(
  quickNotes: readonly T[],
  details: ReadonlyMap<string, QuickNoteDetail>,
  tagDirectory: readonly QuickNoteTag[],
) {
  const [quickTagFilter, setQuickTagFilter] = useState<QuickNoteTagFilter>({ kind: "all" });
  const [quickSort, setQuickSortState] = useState<QuickNoteSort>(() => readQuickNoteSort());

  const displayedQuickNotes = useMemo(() => quickNotes.map((note) => {
    const detail = details.get(note.id);
    return detail
      ? { ...note, body: detail.body, images: detail.images, tags: detail.tags, tagIds: detail.tagIds, firstImage: detail.firstImage ?? note.firstImage }
      : note;
  }), [quickNotes, details]);

  const quickTagIndex = useMemo(
    () => buildQuickNoteTagIndex(displayedQuickNotes, tagDirectory, (note) => note.tagIds),
    [displayedQuickNotes, tagDirectory],
  );

  useEffect(() => {
    if (quickTagFilter.kind === "tag" && !quickTagIndex.tags.some((tag) => tag.id === quickTagFilter.id)) {
      setQuickTagFilter({ kind: "all" });
    }
  }, [quickTagFilter, quickTagIndex.tags]);

  const sortedQuickNotes = useMemo(() => {
    const filtered = filterQuickNotesByTag(displayedQuickNotes, quickTagFilter, (note) => note.tagIds);
    return sortQuickNotes(filtered, quickSort);
  }, [displayedQuickNotes, quickSort, quickTagFilter]);

  const setQuickSort = (next: QuickNoteSort) => {
    setQuickSortState(next);
    writeQuickNoteSort(next);
  };

  return {
    displayedQuickNotes,
    quickTagIndex,
    quickTagFilter,
    setQuickTagFilter,
    quickSort,
    setQuickSort,
    quickSortOptions: QUICK_NOTE_SORT_OPTIONS,
    sortedQuickNotes,
  };
}
