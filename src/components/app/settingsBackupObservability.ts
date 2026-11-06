/**
 * 备份可观测（261105 task-68）：「设置 → 备份与恢复」的状态行文案**单一来源**。
 *
 * 为什么单独一层：状态行要讲的三件事（份数/占用、上次结果、失败引导）都是"数据 → 文案"的纯映射，
 * 塞在 SettingsPanel 的巨大 JSX 里只能靠渲染测试守；抽成纯函数后 ok/partial/failed、空目录、
 * 目录未创建、残留半份组这些分支可以直接单测（UI 只负责摆放）。
 *
 * 口径（与主进程 autoBackup 一致，不要另立判据）：
 * · 份数 = 备份组数（`metadata-<stamp>` + `quicknotes-<stamp>` 同一时间戳为一组）；
 * · 占用 = 这两类备份文件大小之和（目录里其它文件不计入 —— 轮转也不管它们）；
 * · 结果 = 主进程 `AutoBackupState.result`（ok / partial / failed）+ message（partial 原因如小记库不可用/校验失败）。
 */
import { formatDateTime } from "../../core/dateFormat";
import { formatBytes } from "../../lib/formatBytes";
import type { BackupStateShape, BackupUsageShape } from "../../lib/types";

export type BackupTone = "ok" | "warn" | "error";

/** 上次备份结果的展示模型（状态行主文案 + 原因 + 失败引导）。 */
export interface BackupResultView {
  tone: BackupTone;
  /** 「成功 / 部分成功 / 失败」 */
  label: string;
  /** `上次备份：2026-11-06 14:08（部分成功）` */
  headline: string;
  /** 主进程 message（失败/partial 时是可读原因；ok 时通常是「已备份主库：…」）。 */
  message: string;
  /** 非 ok 时的引导文案；ok = null。 */
  guidance: string | null;
  /** 是否给「立即备份」重试入口（非 ok）。 */
  retry: boolean;
}

const RESULT_LABEL: Record<BackupStateShape["result"], string> = { ok: "成功", partial: "部分成功", failed: "失败" };
const RESULT_TONE: Record<BackupStateShape["result"], BackupTone> = { ok: "ok", partial: "warn", failed: "error" };

/**
 * 未备份过（state = null）⇒ null（UI 显示「还没有备份记录」）。
 * 时间解析失败不影响结果展示（退化成不带时间的 headline）。
 */
export function backupResultView(state: BackupStateShape | null): BackupResultView | null {
  if (!state) return null;
  const parsed = Date.parse(state.lastBackupAt);
  const when = Number.isFinite(parsed) ? formatDateTime(new Date(parsed)) : null;
  const label = RESULT_LABEL[state.result] ?? "失败";
  const tone = RESULT_TONE[state.result] ?? "error";
  const message = (state.message ?? "").trim();
  const guidance = state.result === "ok"
    ? null
    : state.result === "partial"
      // partial = 主库可用、附属件不完整（小记库不可用 / 校验失败 / 降级拷贝）⇒ 数据仍在，别吓用户。
      ? "本次备份不完整（主库可用，原因见上）。建议点「立即备份」再试一次；下次成功即恢复完整兜底。"
      : "这次没有生成可用备份，本地数据不受影响，但少了这一份兜底。请点「立即备份」重试；若持续失败，请查看日志或改用更早的备份恢复。";
  return {
    tone,
    label,
    headline: when ? "上次备份：" + when + "（" + label + "）" : "上次备份：" + label,
    message,
    guidance,
    retry: state.result !== "ok",
  };
}

/** 备份目录占用的展示模型（统计中 / 目录未创建 / 有备份）。 */
export interface BackupUsageView {
  tone: BackupTone;
  /** 「共 3 份」或「还没有备份」。 */
  countText: string;
  /** 「123.4 MB」；没有备份时为空串。 */
  sizeText: string;
  /** 「上限 300.0 MB」（来自自动备份设置；null = 不显示）。 */
  limitText: string | null;
  /** 「最新 2026-11-06 14:08」。 */
  newestText: string | null;
  /** 副行说明（目录未创建 / 统计失败 / 半份组）；没有 = null。 */
  note: string | null;
}

const MAX_NOTE_WARNINGS = 2;

export function backupUsageView(
  usage: BackupUsageShape | null,
  opts: { maxTotalBytes?: number } = {},
): BackupUsageView {
  if (!usage) return { tone: "ok", countText: "统计中…", sizeText: "", limitText: null, newestText: null, note: null };
  const limitText = typeof opts.maxTotalBytes === "number" ? "上限 " + formatBytes(opts.maxTotalBytes) : null;
  const note = usage.warnings.length > 0
    ? usage.warnings.slice(0, MAX_NOTE_WARNINGS).join("；") + (usage.warnings.length > MAX_NOTE_WARNINGS ? "（还有 " + (usage.warnings.length - MAX_NOTE_WARNINGS) + " 条）" : "")
    : null;
  if (!usage.exists) {
    // 目录不存在 = 还没跑过自动备份/手动备份 ⇒ 提示"还没有备份"而不是报错（首次启动的常态）。
    return { tone: "ok", countText: "还没有备份", sizeText: "", limitText, newestText: null, note: "备份目录尚未创建（第一次备份后自动创建）。" };
  }
  if (usage.groups === 0) {
    return { tone: "ok", countText: "还没有备份", sizeText: "", limitText, newestText: null, note: note ?? "目录已就绪，还没有生成过备份文件。" };
  }
  const newestMs = usage.newestAt ? Date.parse(usage.newestAt) : NaN;
  const newestText = Number.isFinite(newestMs) ? "最新 " + formatDateTime(new Date(newestMs)) : null;
  // 轮转保证总量 ≤ 上限（超小上限时至少留最新一份 ⇒ 允许单份超限，此时给 warn 而不是假装正常）。
  const over = typeof opts.maxTotalBytes === "number" && usage.totalBytes > opts.maxTotalBytes;
  return {
    tone: over ? "warn" : "ok",
    countText: "共 " + usage.groups + " 份",
    sizeText: formatBytes(usage.totalBytes),
    limitText,
    newestText,
    note: over ? "已超过总大小上限（轮转只保留最新一份，无法再删）" + (note ? "；" + note : "") : note,
  };
}
