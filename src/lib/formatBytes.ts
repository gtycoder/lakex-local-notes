/** 人类可读体积（设置页读数口径：B / KB / MB，一位小数）。 */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * 人类可读体积（**同步读数口径**：可到 GB，且大值取整）。
 *
 * 与上面 `formatBytes` **不是同一个口径**，别合并（B1，261016）：
 *  · 设置页读数要"精确、稳定"⇒ 只到 MB、恒一位小数；
 *  · 同步读数要"一眼看出量级"⇒ 到 GB，且 ≥100 时取整（`200 MB` 而不是 `200.0 MB`）。
 * 两者都保留，但**各自只有一份实现**；原先同步浮窗里那份私有副本已收编到此处。
 * 格式由 `src/lib/formatBytes.test.ts` 用字面量钉死。
 */
export function formatBytesCompact(value: number | undefined): string {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${unit === 0 || size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}
