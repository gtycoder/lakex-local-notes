/**
 * 墓碑发布水线（Del-6）：**单调、永不接受未来值**。
 *
 * 背景（261105 容错批 P1-3）：待同步墓碑的判据是 `deleted_at > 水线`。系统时钟前跳会把水线写成未来时间，
 * 之后 `deleted_at > 水线` 恒 false ⇒ **删除永不传播**（各端永久保留），且不会自愈。
 *
 * 判据（单一来源，两端共用）：
 * - 读：非法/未来（> now + 5 分钟容差）⇒ 视为损坏，回退 `"0"`（全部墓碑重新待同步，保守但安全）；
 * - 写：只增不减（时钟回拨不得让水线倒退、避免重复发布），且**夹到 now**（永不写未来）。
 */
export const WATERLINE_FUTURE_SKEW_MS = 5 * 60_000;

function parseMs(raw: string | null | undefined): number | null {
  if (!raw || raw === "0") return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** 读取时归一：合法值原样返回；非法或超前于 now+容差 ⇒ "0"。 */
export function normalizeWaterline(raw: string | null | undefined, now = Date.now()): string {
  const ms = parseMs(raw);
  if (ms === null) return "0";
  if (ms > now + WATERLINE_FUTURE_SKEW_MS) return "0";
  return raw as string;
}

/** 推进水线：候选值非法/超前 ⇒ 用 now；最终取「当前值与候选的较大者」（只增不减）。 */
export function advanceWaterline(current: string | null | undefined, at: string | null | undefined, now = Date.now()): string {
  const nowIso = new Date(now).toISOString();
  const base = normalizeWaterline(current, now);
  const atMs = parseMs(at);
  const candidate = atMs === null || atMs > now + WATERLINE_FUTURE_SKEW_MS ? nowIso : (at as string);
  if (base === "0") return candidate;
  return candidate > base ? candidate : base;
}
