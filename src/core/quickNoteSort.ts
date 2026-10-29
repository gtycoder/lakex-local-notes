/**
 * 小记列表的排序口径 —— **两端共用的单一来源**（261015 用户点单：「桌面端也要和移动端统一」）。
 *
 * 分层（依据 docs/STORAGE-LAYERS.md §5「L3 纯本机/派生层」）：
 * **纯展示偏好，只存本机 localStorage，不进 S3、不进 manifest** —— 小记的先后顺序不构成跨端冲突，
 * 每端各按自己的偏好展示；同一台设备上桌面与移动物理不同机，不会互相覆盖。
 *
 * 四档（移动端 261015 由用户点单扩到四档，桌面端同步）：
 *   最近更新 / 最早更新 / 最新创建 / 最早创建
 *
 * 旧值兼容：桌面 260915 起存的是两值 `"updated" | "created"`（都按降序），
 * 这里读到时直接映射到 `"recent" | "createdNew"` —— **用户既有偏好不丢**（AGENTS §3#7 说的是"不为旧数据写兼容"，
 * 那指文档/库表这类可重建的数据；一条 UI 偏好的键值映射成本极低、丢了反而让用户莫名其妙回到默认）。
 */
export type QuickNoteSort = "recent" | "oldest" | "createdNew" | "createdOld";

/** 菜单项（两端共用同一份文案与顺序）：桌面与移动的排序菜单都从这里渲染。 */
export const QUICK_NOTE_SORT_OPTIONS: ReadonlyArray<{ id: QuickNoteSort; label: string }> = [
  { id: "recent", label: "最近更新" },
  { id: "oldest", label: "最早更新" },
  { id: "createdNew", label: "最新创建" },
  { id: "createdOld", label: "最早创建" },
];

/** 存储键（桌面与移动共用；**本机**偏好，见 STORAGE-LAYERS §5）。 */
export const QUICK_NOTE_SORT_KEY = "lakex-local-notes-v3.quick-notes-sort";
export const QUICK_NOTE_SORT_DEFAULT: QuickNoteSort = "recent";

const isSort = (v: unknown): v is QuickNoteSort =>
  v === "recent" || v === "oldest" || v === "createdNew" || v === "createdOld";

/**
 * 把存储里的原始值归一成合法档位（**纯函数** —— `src/core` 不许碰 DOM/localStorage）：
 * 旧两值（updated / created，都曾按降序）映射到新四值；非法/缺失回默认。
 */
export function normalizeQuickNoteSort(raw: string | null | undefined): QuickNoteSort {
  if (isSort(raw)) return raw;
  if (raw === "updated") return "recent";      // 旧桌面值：按更新时间、降序
  if (raw === "created") return "createdNew";  // 旧桌面值：按创建时间、降序
  return QUICK_NOTE_SORT_DEFAULT;
}

/** 当前排序是否按创建时间（卡片/行上的"无标签时间"要跟着排序口径显示，否则看起来像没排序）。 */
export const isCreatedSort = (sort: QuickNoteSort): boolean => sort === "createdNew" || sort === "createdOld";
/** 当前排序是否降序（新 → 旧）。 */
export const isDescSort = (sort: QuickNoteSort): boolean => sort === "recent" || sort === "createdNew";

/** 该条在当前排序口径下用于展示的时间（ISO 字符串）。 */
export function quickNoteSortTime(item: { createdAt: string; updatedAt: string }, sort: QuickNoteSort): string {
  return isCreatedSort(sort) ? item.createdAt : item.updatedAt;
}

/**
 * 排序（不改入参）。**只影响展示顺序**：不写库、不进 manifest（桌面端原本的口径不变）。
 * 非法时间按 0 处理（缺字段的旧数据不参与"最前"）。
 */
export function sortQuickNotes<T extends { createdAt: string; updatedAt: string }>(
  items: readonly T[],
  sort: QuickNoteSort,
): T[] {
  const at = (v: string) => {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const useCreated = isCreatedSort(sort);
  const desc = isDescSort(sort);
  return [...items].sort((a, b) => {
    const d = at(useCreated ? a.createdAt : a.updatedAt) - at(useCreated ? b.createdAt : b.updatedAt);
    return desc ? -d : d;
  });
}
