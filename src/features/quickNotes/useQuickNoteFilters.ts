/**
 * 小记筛选 / 版式 / 展示偏好的域 hook（261112 R1 Q19-5）：从 QuickNotesWorkspace 抽出（**零行为变化**）。
 *
 * 单一来源不变：
 * - 排序档位/文案/比较器 = core/quickNoteSort；本机持久化 = lib/quickNoteSortPref（与移动端同一份）；
 * - 过滤链 = 时间(core/quickNoteFilters) → 标签(core/quickNoteTags) → 类型(core/quickNoteTypeFilter) → 排序 → 置顶；
 * - 版式/置顶是**纯展示偏好**，只存本机 localStorage，不进 S3。
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { writeLocalStorage } from "../../lib/localStorageSafe";
import { QUICK_NOTE_SORT_OPTIONS, sortQuickNotes, type QuickNoteSort } from "../../core/quickNoteSort";
import { readQuickNoteSort, writeQuickNoteSort } from "../../lib/quickNoteSortPref";
import { matchesQuickNoteTimeFilter, type QuickNoteTimeFilter } from "../../core/quickNoteFilters";
import {
  buildQuickNoteTagIndex,
  buildQuickNoteTagOptions,
  filterQuickNotesByTag,
  type QuickNoteTagFilter,
  type QuickNoteTagSummary,
} from "../../core/quickNoteTags";
import { filterQuickNotesByType, type QuickNoteTypeFilter } from "../../core/quickNoteTypeFilter";
import { filterQuickNotesByQuery } from "../../core/quickNoteSearch";
import type { QuickNoteListSummary, QuickNoteTag } from "../../lib/types";

// 小记版式口径（用户 260919 定，261015 与移动端统一）：**纯展示偏好**，只存本机 localStorage、不进 S3。

/**
 * 置顶（用户 260919 指明）：**纯本地**，不进 S3。
 * 依据（已核查）：小记的同步清单只带 `{id, createdAt, updatedAt, contentHash, isConflict, images}`，
 * 没有任何顺序/置顶字段；各端各按本机偏好排序（桌面存 localStorage，移动端按 updated_at）。
 */
const PIN_KEY = "lakex-local-notes-v3.quick-notes-pinned";
const readPins = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]") as string[]); } catch { return new Set(); }
};
const writePins = (value: Set<string>): void => {
  writeLocalStorage(PIN_KEY, JSON.stringify([...value]));
};

/**
 * 小记的两种版式（对齐语雀云端，用户 260919 定）：
 * - `note`：写作卡（小块，图片/待办 + 展开）+ 卡片流；
 * - `list`：索引列表（标题 + 时间，选中高亮）+ 右侧**全尺寸编辑器**（完整工具栏）。
 * 同 sortBy：**纯展示偏好**，只存本机 localStorage，不进 S3（各端各按自己的偏好展示）。
 */
export type QuickNotesView = "note" | "list";
const VIEW_KEY = "lakex-local-notes-v3.quick-notes-view";
const readViewPref = (): QuickNotesView => {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "note"; } catch { return "note"; }
};
const writeViewPref = (value: QuickNotesView): void => {
  writeLocalStorage(VIEW_KEY, value);
};

export interface QuickNoteFiltersApi {
  sortBy: QuickNoteSort;
  /** 排序（状态 + 本机持久化；菜单项直接调用，不需要再单独写 pref）。 */
  setSortBy(next: QuickNoteSort): void;
  sortLabel: string;
  viewMode: QuickNotesView;
  /** 版式（状态 + 本机持久化）。 */
  setViewMode(next: QuickNotesView): void;
  tagFilter: QuickNoteTagFilter;
  setTagFilter: Dispatch<SetStateAction<QuickNoteTagFilter>>;
  timeFilter: QuickNoteTimeFilter;
  setTimeFilter: Dispatch<SetStateAction<QuickNoteTimeFilter>>;
  typeFilter: QuickNoteTypeFilter;
  setTypeFilter: Dispatch<SetStateAction<QuickNoteTypeFilter>>;
  searchQuery: string;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  pinned: Set<string>;
  togglePin(id: string): void;
  tagIndex: ReturnType<typeof buildQuickNoteTagIndex>;
  tagOptions: QuickNoteTagSummary[];
  visibleItems: QuickNoteListSummary[];
  listItems: QuickNoteListSummary[];
}

export function useQuickNoteFilters({ items, tagDirectory }: {
  items: QuickNoteListSummary[];
  tagDirectory: QuickNoteTag[];
}): QuickNoteFiltersApi {
  /** 排序口径：四档（最近更新 / 最早更新 / 最新创建 / 最早创建）——纯展示偏好，本机 localStorage，不参与同步 */
  const [sortBy, setSortByState] = useState<QuickNoteSort>(() => readQuickNoteSort());
  /** 排序按钮的提示文案（档位文案与菜单同一份来源）。 */
  const sortLabel = QUICK_NOTE_SORT_OPTIONS.find((o) => o.id === sortBy)?.label ?? "";
  /** 版式：小记卡（note）/ 列表（list）（纯展示偏好，存 localStorage，不参与同步） */
  const [viewMode, setViewModeState] = useState<QuickNotesView>(() => readViewPref());
  /** 标签筛选（全部 / 单标签 / 无标签 / 高级包含排除）。 */
  const [tagFilter, setTagFilter] = useState<QuickNoteTagFilter>({ kind: "all" });
  /** 时间快捷筛选（按创建时间；与类型/标签筛选叠加）。 */
  const [timeFilter, setTimeFilter] = useState<QuickNoteTimeFilter>({ kind: "any" });
  /** 类型筛选：菜单默认「小记」= 全部（对齐语雀 dashboard/notes 的默认勾选）。 */
  const [typeFilter, setTypeFilter] = useState<QuickNoteTypeFilter>("all");
  /** 列表视图的本地搜索词（Enter/清空才改 query；卡片视图不参与）。 */
  const [searchQuery, setSearchQuery] = useState("");
  /** 置顶集合（纯本机偏好，不进 S3）。 */
  const [pinned, setPinned] = useState<Set<string>>(() => readPins());

  /** 排序 = 状态 + 本机持久化（调用点只写一次，避免两处各写一份 pref）。 */
  function setSortBy(next: QuickNoteSort): void {
    setSortByState(next);
    writeQuickNoteSort(next);
  }
  /** 版式 = 状态 + 本机持久化。 */
  function setViewMode(next: QuickNotesView): void {
    setViewModeState(next);
    writeViewPref(next);
  }

  /** 置顶/取消置顶（纯本地）。 */
  function togglePin(id: string) {
    setPinned((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      writePins(next);
      return next;
    });
  }

  const tagIndex = useMemo(
    () => buildQuickNoteTagIndex(items, tagDirectory, (item) => item.tagIds),
    [items, tagDirectory],
  );

  /**
   * 写作区/选择器/管理页用**完整目录**（含 0 条小记的新标签）；标签条只用 `tagIndex.tags`（有计数才展示）。
   * 曾经写作区直接拿 `tagIndex.tags` 查名称 ⇒ 刚加进草稿、尚未保存的标签查不到，回退显示了标签 ID（用户 261024 报）。
   */
  const tagOptions = useMemo<QuickNoteTagSummary[]>(
    () => buildQuickNoteTagOptions(tagDirectory, tagIndex.tags),
    [tagDirectory, tagIndex.tags],
  );

  useEffect(() => {
    if (tagFilter.kind === "tag" && !tagIndex.tags.some((tag) => tag.id === tagFilter.id)) {
      setTagFilter({ kind: "all" });
    }
  }, [tagFilter, tagIndex.tags]);

  // 高级筛选里的标签可能被删除：把已不存在的 ID 从包含/排除里剔掉，避免形成看不见的隐藏 AND。
  useEffect(() => {
    if (tagFilter.kind !== "selection") return;
    const active = new Set(tagOptions.map((tag) => tag.id));
    const include = tagFilter.include.filter((id) => active.has(id));
    const exclude = tagFilter.exclude.filter((id) => active.has(id));
    if (include.length === tagFilter.include.length && exclude.length === tagFilter.exclude.length) return;
    setTagFilter(include.length === 0 && exclude.length === 0 ? { kind: "all" } : { kind: "selection", include, exclude });
  }, [tagFilter, tagOptions]);

  /** 排序只影响本端展示顺序（不写库、不进 manifest）；四档比较器在 core/quickNoteSort（与移动端同一份）。 */
  const visibleItems = useMemo(() => {
    const timed = items.filter((item) => matchesQuickNoteTimeFilter(item.createdAt, timeFilter));
    const filtered = filterQuickNotesByTag(timed, tagFilter, (item) => item.tagIds);
    // 类型筛选是标签筛选之后的 AND 过滤（小记 / 图片 / 附件）；分类只认资源清单，见 core/quickNoteTypeFilter。
    // DT-05：列表投影只带 mime 清单（不读正文），这里包成该判据要的资源形状。
    const typed = filterQuickNotesByType(filtered, typeFilter, (item) => item.assetMimeTypes.map((mimeType) => ({ mimeType })));
    const ordered = sortQuickNotes(typed, sortBy);
    // 置顶优先（纯本机偏好），同组内保持所选排序（filter 保序 ⇒ 无需二次比较）
    return [...ordered.filter((it) => pinned.has(it.id)), ...ordered.filter((it) => !pinned.has(it.id))];
  }, [items, sortBy, pinned, tagFilter, typeFilter, timeFilter]);
  /** 列表视图的本地搜索（Enter/清空才改 query；卡片视图不参与）。 */
  const listItems = useMemo(() => filterQuickNotesByQuery(visibleItems, searchQuery), [visibleItems, searchQuery]);

  return {
    sortBy, setSortBy, sortLabel, viewMode, setViewMode,
    tagFilter, setTagFilter, timeFilter, setTimeFilter, typeFilter, setTypeFilter,
    searchQuery, setSearchQuery, pinned, togglePin,
    tagIndex, tagOptions, visibleItems, listItems,
  };
}
