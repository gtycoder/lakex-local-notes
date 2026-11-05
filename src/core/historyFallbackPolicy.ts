/**
 * 定时兜底历史快照**纯逻辑**（Batch4-C，261105）。
 *
 * 背景：历史快照此前只由「冲突/覆盖/恢复前留档」触发（19 处 createHistorySnapshot 调用点），
 * 纯手滑/误删且没被覆盖时没有历史可回。已有 U1 定时器只快照「本周期内经 saveNote 保存过」的
 * **内存**脏集合 ⇒ 重启即丢；本族改为**持久账本 + 正文 mtime** 判据：只要. body 文件在上次
 * 兜底之后变过，就留一份（24h 同 hash 去重、引用保护、保留期清理全部沿用既有实现）。
 *
 * 本文件只做**选择**（纯函数，零 IO）：哪些文档该在本次兜底里生成快照。
 * 判据与边界：
 * - 账本缺失 / mtime 比账本新 ⇒ 选中（严格大于；相等 = 上次已处理）；
 * - mtime 非法（≤0/NaN）⇒ 跳过（缺正文走另一条通道，不在这里制造空快照）；
 * - 按 mtime **从新到旧**排序后截断（maxNotes），保证「刚改过的先留档」，单轮成本有上界；
 * - 时钟回拨不会把 mtime 变旧，写账本时按 min(mtime, now) 收敛（由调用方做）。
 */

/** 兜底间隔默认值（分钟）：低频兜底，设置页可改，0 = 关闭。 */
export const HISTORY_FALLBACK_DEFAULT_MINUTES = 10;

/** 单轮最多处理的文档数（2 万文档量级下把一轮 stat+快照压在有界范围；其余下一轮）。 */
export const HISTORY_FALLBACK_MAX_NOTES = 200;

export interface HistoryFallbackNote {
  id: string;
  /** 正文文件 mtime（毫秒）。 */
  bodyMtimeMs: number;
}

export interface SelectHistoryFallbackInput {
  notes: readonly HistoryFallbackNote[];
  /** note_id → 上次兜底时看到的正文 mtime（毫秒）。 */
  ledger: ReadonlyMap<string, number>;
  /** 单轮上限（默认 HISTORY_FALLBACK_MAX_NOTES）。 */
  maxNotes?: number;
  /** 便于测试；不参与选择（mtime 比较是绝对的）。 */
  nowMs?: number;
}

/** 选中「自上次兜底后有正文变化」的文档，按 mtime 从新到旧、最多 maxNotes 个。 */
export function selectHistoryFallbackNotes(input: SelectHistoryFallbackInput): HistoryFallbackNote[] {
  const maxNotes = Number.isFinite(input.maxNotes) && (input.maxNotes as number) > 0
    ? Math.floor(input.maxNotes as number)
    : HISTORY_FALLBACK_MAX_NOTES;
  const seen = new Set<string>();
  const changed: HistoryFallbackNote[] = [];
  for (const note of input.notes) {
    if (!note || typeof note.id !== "string" || note.id.length === 0 || seen.has(note.id)) continue;
    seen.add(note.id);
    if (!Number.isFinite(note.bodyMtimeMs) || note.bodyMtimeMs <= 0) continue;
    // mtime 是浮点（含亚毫秒），账本存整数毫秒 ⇒ 两边都取整再比，否则每轮都会把同一篇判成"变了"。
    const mtimeMs = Math.floor(note.bodyMtimeMs);
    const previous = input.ledger.get(note.id);
    if (previous !== undefined && mtimeMs <= Math.floor(previous)) continue;
    changed.push({ id: note.id, bodyMtimeMs: mtimeMs });
  }
  changed.sort((a, b) => (b.bodyMtimeMs - a.bodyMtimeMs) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return changed.slice(0, maxNotes);
}

/** 设置值归一：非法/负数 ⇒ 默认 10；小数向下取整。0 是合法值（关闭）。 */
export function historyFallbackMinutes(raw: unknown, fallback: number = HISTORY_FALLBACK_DEFAULT_MINUTES): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return fallback;
  return Math.floor(raw);
}

/** 0 = 关闭兜底（设置页「0 = 不自动快照」的唯一判据）。 */
export function shouldRunHistoryFallback(minutes: number): boolean {
  return Number.isFinite(minutes) && minutes > 0;
}
