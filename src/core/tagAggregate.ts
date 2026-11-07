/**
 * 标签聚合的跨端单一判据（261107）：计数口径、更新时间排序、空标题兜底。
 * 桌面「标签空间」与移动「标签页」都必须走这里，避免同一标签两端显示不同数字/顺序/文案。
 */
export interface TagLinkSource {
  readonly [noteId: string]: readonly string[];
}

/** 每个标签被多少条目标引用（同一条重复标签只算一次）；给了 liveIds 时只统计仍存在的内容。 */
export function countTagRefs(links: TagLinkSource | null | undefined, liveIds?: ReadonlySet<string>): Map<string, number> {
  const counts = new Map<string, number>();
  if (!links) return counts;
  for (const [id, tagIds] of Object.entries(links)) {
    if (liveIds && !liveIds.has(id)) continue;
    for (const tagId of new Set(tagIds)) counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
  }
  return counts;
}

function timeOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 0 : at;
}

/** 更新时间倒序；同时间按 kind/id 稳定排序（两端结果必须一致）。 */
export function compareTagUpdatedAtDesc(
  a: { updatedAt: string; kind?: string; id: string },
  b: { updatedAt: string; kind?: string; id: string },
): number {
  return timeOf(b.updatedAt) - timeOf(a.updatedAt)
    || (a.kind ?? "").localeCompare(b.kind ?? "")
    || a.id.localeCompare(b.id);
}

/** 空标题兜底：文档 / 小记同一套文案（两端口径统一）。 */
export function tagFallbackTitle(kind: "doc" | "quickNote" | "quick"): string {
  return kind === "doc" ? "无标题" : "空小记";
}
