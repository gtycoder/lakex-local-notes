/** 小记「类型」筛选（桌面小记页 / 与语雀 dashboard/notes 的筛选菜单对齐）。
 *
 * 类型只由**资源清单**判定，不解析正文：
 *   · all（菜单名「小记」）＝ 全部有效小记；
 *   · image（「图片」）＝ 至少有一张图片资源（mime 为 image/* 白名单）；
 *   · attachment（「附件」）＝ 至少有一个非图片资源（pdf/zip/音视频/其他文件）。
 * 一条小记可以同时命中 image 与 attachment；标签筛选与类型筛选是 AND 关系（调用方组合）。
 * 纯函数、无平台依赖 ⇒ 两端可共用（移动端本轮不接 UI，只保留能力）。
 */

import { isQuickNoteImageMime } from "./quickNoteModel.js";

export type QuickNoteTypeFilter = "all" | "image" | "attachment";

export interface QuickNoteTypeOption {
  id: QuickNoteTypeFilter;
  label: string;
}

/** 菜单顺序 = 语雀 dashboard/notes 的「小记 / 图片 / 附件」；书签/微信/插件/分享/归档本产品没有对应数据，不放入死选项。 */
export const QUICK_NOTE_TYPE_OPTIONS: readonly QuickNoteTypeOption[] = [
  { id: "all", label: "小记" },
  { id: "image", label: "图片" },
  { id: "attachment", label: "附件" },
];

interface QuickNoteAssetLike {
  mimeType: string;
}

type AssetsOf<T> = (note: T) => readonly QuickNoteAssetLike[];

const defaultAssetsOf = <T,>(note: T): readonly QuickNoteAssetLike[] => {
  const images = (note as { content?: { images?: QuickNoteAssetLike[] } }).content?.images;
  return Array.isArray(images) ? images : [];
};

export function quickNoteMatchesType<T>(note: T, filter: QuickNoteTypeFilter, assetsOf: AssetsOf<T> = defaultAssetsOf): boolean {
  if (filter === "all") return true;
  const assets = assetsOf(note);
  return filter === "image"
    ? assets.some((asset) => isQuickNoteImageMime(asset.mimeType))
    : assets.some((asset) => !isQuickNoteImageMime(asset.mimeType));
}

export function filterQuickNotesByType<T>(
  notes: readonly T[],
  filter: QuickNoteTypeFilter,
  assetsOf: AssetsOf<T> = defaultAssetsOf,
): T[] {
  return notes.filter((note) => quickNoteMatchesType(note, filter, assetsOf));
}

/** 菜单/筛选栏用的计数：image / attachment 可以重叠；all = 全部小记数。 */
export function countQuickNotesByType<T>(notes: readonly T[], assetsOf: AssetsOf<T> = defaultAssetsOf): Record<QuickNoteTypeFilter, number> {
  let image = 0;
  let attachment = 0;
  for (const note of notes) {
    const assets = assetsOf(note);
    if (assets.some((asset) => isQuickNoteImageMime(asset.mimeType))) image += 1;
    if (assets.some((asset) => !isQuickNoteImageMime(asset.mimeType))) attachment += 1;
  }
  return { all: notes.length, image, attachment };
}
