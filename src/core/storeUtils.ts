/** Pure storage helpers shared by Store and its tests. */

// 资产命名/引用提取的单一事实源在 src/core/assetNaming.ts（图片 + 附件统一），
// 此处 re-export 保持既有 import 面（electron/store.ts、assetRepository.ts 等）不变。
export { ASSET_NAME_RE, extractAssetRefs, isAssetFilename, isAssetExtension, isImageExtension, isSafeShellOpenFilename, buildAssetFilename } from "./assetNaming.js";

/** ISO week-year key with Monday as the first day of the week. */
export function isoWeekKey(timestamp: number): string {
  const date = new Date(timestamp);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface HistoryRetentionConfig {
  maxSnapshots: number;
  retentionDays: number;
}

/**
 * Decide which history snapshots to remove without touching the database/filesystem.
 * Recent snapshots are kept densely, older snapshots are sampled by day/week,
 * and the final cap prevents an invalid config from retaining an unbounded set.
 *
 * `nowMs` 可注入（CORE-10 纯函数化）：不传 = 当前时间；测试传固定值即可得到可复现结果，
 * 不用再造「相对现在」的时间戳。
 */
export function selectHistoryDrops(createdAtList: string[], config: HistoryRetentionConfig, nowMs: number = Date.now()): Set<string> {
  const now = nowMs;
  const recentWindow = 24 * 3600 * 1000;
  const dailyWindow = 7 * 24 * 3600 * 1000;
  const weeklyWindow = 30 * 24 * 3600 * 1000;
  const cutoff = now - config.retentionDays * 24 * 3600 * 1000;
  const sortedTimestamps = [...createdAtList].sort();
  const keep = new Set<string>();
  const latestByDay = new Map<string, string>();
  const latestByWeek = new Map<string, string>();

  for (const timestamp of sortedTimestamps) {
    const parsed = Date.parse(timestamp);
    if (parsed >= now - recentWindow) {
      keep.add(timestamp);
      continue;
    }
    if (parsed >= now - dailyWindow) {
      keepLatest(latestByDay, keep, new Date(parsed).toISOString().slice(0, 10), timestamp);
      continue;
    }
    if (parsed >= now - weeklyWindow) {
      keepLatest(latestByWeek, keep, isoWeekKey(parsed), timestamp);
    }
  }

  const cap = Math.max(1, config.maxSnapshots);
  const finalKeep = new Set([...keep].sort().slice(-cap));
  return new Set(sortedTimestamps.filter((timestamp) => !finalKeep.has(timestamp) || Date.parse(timestamp) < cutoff));
}

function keepLatest(index: Map<string, string>, keep: Set<string>, key: string, timestamp: string): void {
  const previous = index.get(key);
  if (previous === undefined || timestamp > previous) {
    if (previous !== undefined) keep.delete(previous);
    index.set(key, timestamp);
    keep.add(timestamp);
  }
}

/** Remove filesystem-invalid filename characters and provide a stable fallback. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "未命名";
}

/**
 * 校验单个路径段（调用方仍需自己约束允许的根目录）。
 *
 * **路径段的单一判据**（CORE-09）：远端小记内容校验（quickNoteModel）、S3 v3 key 段校验
 * （s3v3Keys.assertSafeSegment，再叠加自己的字符集白名单）都走这里 —— 加固一处、全仓生效。
 *
 * 拒绝：空段、`.` / `..`、路径分隔符 `/` 与 `\`（顺带挡住绝对路径与 Windows 形态）、
 * 控制字符（NUL/换行等：Node 路径 API 会截断或抛错，必须在入口挡掉）。
 */
export function isSafePathSegment(segment: string): boolean {
  return segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !segment.includes("/")
    && !segment.includes("\\")
    && !/[\u0000-\u001f\u007f]/.test(segment);
}
