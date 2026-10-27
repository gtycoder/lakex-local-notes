/**
 * 标签子系统纯逻辑（目录 + 多态关联）。
 * 真相只有两份数据：tags（目录，含墓碑）与 tag_links（note/quickNote 关联）；正文/搜索缓存不存标签真相。
 */

export interface Tag {
  id: string;
  name: string;
  color?: string | null;
  order: number;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** 非空 = 墓碑（删除/被同名新标签取代）。 */
  deletedAt?: string | null;
}

export type TagTargetKind = "note" | "quickNote";

export interface TagLink {
  targetKind: TagTargetKind;
  targetId: string;
  tagId: string;
  position: number;
  /** 关联集合的 LWW 版本；与目标正文 updatedAt 解耦。 */
  linksUpdatedAt: string;
}

export interface TagMergeResult {
  tags: Tag[];
  /** 同名活跃冲突：旧 tag 被墓碑，供调用方记日志/提示。 */
  tombstoned: Array<{ loserId: string; winnerId: string; name: string }>;
}

const newer = (a: string, b: string): boolean => a > b;

/** 目录 LWW + 同名活跃标签去重（同名保留 updatedAt 较新者，另一个写墓碑）。 */
export function mergeTagDirectory(local: readonly Tag[], remote: readonly Tag[]): TagMergeResult {
  const byId = new Map<string, Tag>();
  for (const t of local) byId.set(t.id, { ...t });
  const tombstoned: TagMergeResult["tombstoned"] = [];
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l) { byId.set(r.id, { ...r }); continue; }
    if (newer(r.updatedAt, l.updatedAt)) byId.set(r.id, { ...r });
  }
  // 同名活跃标签：保留更新者；旧者墓碑（墓碑时间取赢家 updatedAt，保证 LWW 可收敛）
  const groups = new Map<string, Tag[]>();
  for (const t of byId.values()) if (!t.deletedAt) {
    const arr = groups.get(t.name) ?? [];
    arr.push(t);
    groups.set(t.name, arr);
  }
  for (const arr of groups.values()) {
    if (arr.length <= 1) continue;
    arr.sort((a, b) => (newer(a.updatedAt, b.updatedAt) ? -1 : newer(b.updatedAt, a.updatedAt) ? 1 : (a.id < b.id ? -1 : 1)));
    const winner = arr[0];
    for (const loser of arr.slice(1)) {
      byId.set(loser.id, { ...loser, deletedAt: winner.updatedAt });
      tombstoned.push({ loserId: loser.id, winnerId: winner.id, name: winner.name });
    }
  }
  const tags = [...byId.values()].sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { tags, tombstoned };
}

/** 关联集合整体 LWW：较新的 linksUpdatedAt 胜出；应用时剔除墓碑/未知 tagId。 */
export function mergeTagLinks(
  local: readonly TagLink[],
  remote: readonly TagLink[],
  opts: { liveTagIds: ReadonlySet<string> },
): TagLink[] {
  const byTarget = new Map<string, TagLink[]>();
  const put = (link: TagLink) => {
    const key = link.targetKind + ":" + link.targetId;
    const arr = byTarget.get(key) ?? [];
    arr.push(link);
    byTarget.set(key, arr);
  };
  for (const l of local) put(l);
  for (const r of remote) {
    const key = r.targetKind + ":" + r.targetId;
    const cur = byTarget.get(key);
    const curVersion = cur?.[0]?.linksUpdatedAt ?? "";
    if (newer(r.linksUpdatedAt, curVersion)) byTarget.set(key, []);
    else if (curVersion && newer(curVersion, r.linksUpdatedAt)) continue;
    const arr = byTarget.get(key) ?? [];
    arr.push(r);
    byTarget.set(key, arr);
  }
  const out: TagLink[] = [];
  for (const arr of byTarget.values()) {
    const kept = arr.filter((l) => opts.liveTagIds.has(l.tagId));
    const seen = new Set<string>();
    for (const l of kept) {
      if (seen.has(l.tagId)) continue;
      seen.add(l.tagId);
      out.push({ ...l, position: seen.size - 1 });
    }
  }
  return out.sort((a, b) => (a.targetKind < b.targetKind ? -1 : a.targetKind > b.targetKind ? 1 : a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : a.position - b.position));
}

/** 某目标的标签 id（按 position）。 */
export function tagIdsFor(links: readonly TagLink[], targetKind: TagTargetKind, targetId: string): string[] {
  return links.filter((l) => l.targetKind === targetKind && l.targetId === targetId).sort((a, b) => a.position - b.position).map((l) => l.tagId);
}

/** 写入/更新某目标的关联集合（整体替换 + linksUpdatedAt 置为 now）。 */
export function replaceTargetLinks(
  links: readonly TagLink[],
  targetKind: TagTargetKind,
  targetId: string,
  tagIds: readonly string[],
  now: string,
  liveTagIds: ReadonlySet<string>,
): TagLink[] {
  const rest = links.filter((l) => !(l.targetKind === targetKind && l.targetId === targetId));
  const seen = new Set<string>();
  const next: TagLink[] = [];
  for (const id of tagIds) {
    if (!liveTagIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push({ targetKind, targetId, tagId: id, position: next.length, linksUpdatedAt: now });
  }
  return [...rest, ...next];
}
