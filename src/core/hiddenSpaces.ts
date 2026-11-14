/**
 * 一级空间「关闭（隐藏入口）」的**纯判据**（261114 用户点单：仅日记 / AI 写作可关闭）。
 *
 * 语义：关闭 = **隐藏一级入口**（桌面空间菜单 + ⌘ 快捷键 / 移动 Dock + 默认空间选项）；
 * 关闭 ≠ 删除数据：日记正文、AI 会话、默认空间落点都保留，重新开启即恢复。
 * 知识库 / 小记 / 标签是固定空间，永远可见（不提供关闭开关）。
 *
 * 判据单一来源：两端各有一份 `spaceVisibility`（空间 id 不同）+ 共享本文件的三条纯函数；
 * 存储走 `lib/hiddenSpacesStore`（设备本地，不进 S3）。
 */

/** 从任意存档值里得到「合法 + 去重」的隐藏空间列表（非法值/未知 id 一律丢弃）。 */
export function sanitizeHiddenSpaces<T extends string>(raw: unknown, hideable: readonly T[]): T[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(hideable);
  const out: T[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !allowed.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value as T);
  }
  return out;
}

/** 按空间顺序过滤掉隐藏项（顺序 = 定义顺序，两端 UI 都按它渲染）。 */
export function visibleSpaces<T extends string>(order: readonly T[], hidden: readonly T[]): T[] {
  const hiddenSet = new Set<string>(hidden);
  return order.filter((id) => !hiddenSet.has(id));
}

export function isSpaceVisible<T extends string>(id: T, hidden: readonly T[]): boolean {
  return !hidden.includes(id);
}

/** 想要的落点被关闭 ⇒ 回落到第一个可见空间（默认空间 / 当前空间都走它）。 */
export function resolveVisibleSpace<T extends string>(
  preferred: T,
  order: readonly T[],
  hidden: readonly T[],
): T {
  if (isSpaceVisible(preferred, hidden)) return preferred;
  return visibleSpaces(order, hidden)[0] ?? order[0];
}
