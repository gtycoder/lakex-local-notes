/**
 * 标签槽位 → 真实标签顺序的纯函数（261012）。
 *
 * 为什么要它：标签栏的**拖拽排序**一直是"直接拿 DOM 里的 `.tab-item[data-note-id]` 顺序当模型"，
 * 而分屏时**合并标签只占一个槽位**（两页只渲染一个按钮）⇒ 直接拿槽位顺序回写会把组内另一页挤出顺序。
 * 所以拆成两步：先在**槽位**上算移动（用户看到的就是槽位），再把槽位展开成真实标签顺序 —— 组内两页
 * 作为一个**块**落回同一槽位、保持它们原有的相对次序。抽成纯函数是为了能被单测卡住（顺序丢页/组被打散
 * 这类回归在源码字符串护栏里是看不见的）。
 */

/** 把 `movedId` 从 `from` 移到 `to`；索引越界/相等时原样返回（不改引用）。 */
export function moveSlot(slots: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= slots.length) return slots;
  const clampedTo = Math.max(0, Math.min(slots.length - 1, to));
  const next = [...slots];
  const [moved] = next.splice(from, 1);
  next.splice(clampedTo, 0, moved);
  return next;
}

/**
 * 槽位顺序 → 真实标签顺序：`groupAnchor` 这个槽位代表整个分屏组，
 * 展开时把 `groupMembers`（当前模型里的先后次序）整块放回该槽位。
 * 其余槽位原样；不在槽位里也没有组关系的 id 不会出现在结果里（调用方保证槽位覆盖其余标签）。
 */
export function expandTabSlots(slots: string[], groupAnchor: string | null, groupMembers: string[]): string[] {
  if (!groupAnchor || groupMembers.length === 0) return [...slots];
  const members = new Set(groupMembers);
  const out: string[] = [];
  for (const id of slots) {
    if (id === groupAnchor) out.push(...groupMembers);
    // 组内的**非锚点**成员不该以独立槽位出现（它由合并标签代表）；真出现也只算一次，绝不重复。
    else if (!members.has(id)) out.push(id);
  }
  return out;
}
