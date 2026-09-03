/**
 * S3 GC 保留窗口判定（lake-core 纯函数，零平台依赖）。
 *
 * 桌面对账/深度清理/小记清理共用同一组窗口语义（2026-09-03 排查：
 * 「界面显示 23 待回收、对账/深度清理都是 0」主要因三处各自判定、UI 口径不清）。
 * 本模块只负责「时间是否已过保留窗口」的判定，保证执行器与诊断一致：
 *   · gcRetentionDays<=0（未配置/关闭保护）→ 边界就是现在（全部到期）；
 *   · 时间戳缺失/非法 → 一律视为「未过窗口」（保守：判不出就不删，永不误删）。
 */

export const GC_DAY_MS = 24 * 60 * 60 * 1000;

/** 窗口边界（毫秒）：`markedAtMs <= cutoff` 即视为已过保留窗口。 */
export function gcCutoffMs(nowMs: number, retentionDays: number): number {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 0;
  return nowMs - days * GC_DAY_MS;
}

/** ISO 时间戳 → 毫秒；缺失/非法返回 null（保守）。 */
export function parseIsoMs(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** 是否已过保留窗口；时间戳缺失/非法 → false（保守不删）。 */
export function isPastWindow(iso: string | null | undefined, cutoffMs: number): boolean {
  const ms = parseIsoMs(iso);
  return ms !== null && ms <= cutoffMs;
}

/** D2/A4：待回收键的人类可读原因（多端共享纯函数）。按 key 前缀分类；未知前缀 → "未知类型"。 */
export function pendingKeyReason(key: string): string {
  if (key.startsWith("objects/")) return "旧正文（清单不再引用）";
  if (key.startsWith("assets/")) return "旧资源（清单不再引用）";
  if (key.startsWith("manifests/")) return "旧清单（链外滞后裁剪）";
  if (key.startsWith("quick-notes/")) return "小记冗余";
  return "未知类型";
}
