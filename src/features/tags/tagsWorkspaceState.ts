/**
 * 标签空间的「上次状态」（设备本地视图，261106 用户验收）：选中标签 / 聚合筛选 / 右栏预览选择 / 中栏滚动。
 *
 * 为什么单独一个纯函数模块：离开标签空间去文档、再点「标签」回来时要恢复原样；状态解析必须
 *  坏值兜底（解析失败 = 全默认无选中）、标签已删 = 清选中、预览条目已不在当前标签下 = 清预览。
 * localStorage 键沿用 `lakex-local-notes-v3.*` 前缀（与三栏宽度 `…tag-space-layout` 并列，**不重复存宽度**）。
 */
import type { TagAggregateKindFilter } from "./tagsModel";

export const TAG_STATE_STORAGE_KEY = "lakex-local-notes-v3.tags-state";

export interface TagPreviewRef {
  kind: "doc" | "quickNote";
  id: string;
}

export interface TagSpaceState {
  /** 选中的标签 id；null = 未选中。 */
  tagId: string | null;
  /** 聚合筛选（全部 / 仅文档 / 仅小记）。 */
  filter: TagAggregateKindFilter;
  /** 右栏当前预览的条目；null = 未选预览。 */
  preview: TagPreviewRef | null;
  /** 中栏滚动位置（像素；越界/坏值按 0）。 */
  scrollTop: number;
}

export const DEFAULT_TAG_SPACE_STATE: TagSpaceState = { tagId: null, filter: "all", preview: null, scrollTop: 0 };

const FILTERS: readonly TagAggregateKindFilter[] = ["all", "doc", "quickNote"];
const PREVIEW_KINDS: ReadonlyArray<TagPreviewRef["kind"]> = ["doc", "quickNote"];

export interface TagStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): TagStateStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function parsePreview(raw: unknown): TagPreviewRef | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { kind?: unknown; id?: unknown };
  if (typeof value.id !== "string" || !value.id) return null;
  if (!PREVIEW_KINDS.includes(value.kind as TagPreviewRef["kind"])) return null;
  return { kind: value.kind as TagPreviewRef["kind"], id: value.id };
}

/** 解析存储值：任何一项不合法 ⇒ 该项回落默认（不因一条坏字段丢掉整份状态的一致性）。 */
export function parseTagSpaceState(raw: unknown): TagSpaceState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_TAG_SPACE_STATE };
  const value = raw as { tagId?: unknown; filter?: unknown; preview?: unknown; scrollTop?: unknown };
  const tagId = typeof value.tagId === "string" && value.tagId ? value.tagId : null;
  const filter = FILTERS.includes(value.filter as TagAggregateKindFilter)
    ? (value.filter as TagAggregateKindFilter)
    : DEFAULT_TAG_SPACE_STATE.filter;
  const preview = tagId ? parsePreview(value.preview) : null;
  const scrollTop = typeof value.scrollTop === "number" && Number.isFinite(value.scrollTop) && value.scrollTop > 0
    ? Math.floor(value.scrollTop)
    : 0;
  return { tagId, filter, preview, scrollTop };
}

export function readTagSpaceState(storage: TagStateStorage | null = defaultStorage()): TagSpaceState {
  if (!storage) return { ...DEFAULT_TAG_SPACE_STATE };
  try {
    const raw = storage.getItem(TAG_STATE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TAG_SPACE_STATE };
    return parseTagSpaceState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TAG_SPACE_STATE };
  }
}

export function writeTagSpaceState(state: TagSpaceState, storage: TagStateStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TAG_STATE_STORAGE_KEY, JSON.stringify(parseTagSpaceState(state)));
    return true;
  } catch {
    return false;
  }
}

export function samePreviewRef(a: TagPreviewRef | null, b: TagPreviewRef | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

/**
 * 把「存储里的状态」对齐到「当前真实数据」：
 *  - 选中的标签已不存在（删除/合并/远端变化）⇒ 整份回落默认（无选中、无预览、滚动归零）；
 *  - 有选中标签时，预览条目不在该标签的当前聚合里 ⇒ 只清预览（保留标签与筛选）；
 *  - 没有选中标签 ⇒ 预览必然清掉。
 */
export function resolveTagSpaceState(
  state: TagSpaceState,
  data: { tagIds: readonly string[]; items: readonly TagPreviewRef[]; },
): TagSpaceState {
  if (!state.tagId) return { ...state, preview: null };
  if (!data.tagIds.includes(state.tagId)) return { ...DEFAULT_TAG_SPACE_STATE, scrollTop: 0 };
  if (state.preview && !data.items.some((item) => samePreviewRef(item, state.preview))) {
    return { ...state, preview: null };
  }
  return state;
}
