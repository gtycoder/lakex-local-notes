/**
 * 同步 warning 的**文案单一来源**（261112 UI 审计 17 / P1）：8 个 SyncWarningKind 的
 * 人话 label / 处理提示 / 是否可重试。
 *
 * 为什么在 core：判据字段由 core 直接产出（SyncWarning，见 sharedTypes），文案必须与判据同源；
 * 纯函数、无 UI/平台依赖（与 core/noteInfo 同姿势），移动端将来可直接复用。
 * 红线：retryable=false 的三类**不得**写「下次同步会重试」；界面文案不用中点「·」。
 */

import type { SyncWarning, SyncWarningKind } from "./sharedTypes.js";

export interface SyncWarningCopy {
  /** 人话一句话：发生了什么（列表行右侧显示）。 */
  label: string;
  /** 处理提示：能重试的写「下次同步会重试」，需人工处理的写清要做什么。 */
  hint: string;
  /** 下一轮同步是否可能自愈。false 的三类必须人工处理（改名 / 恢复正文 / 确认正文）。 */
  retryable: boolean;
}

export const SYNC_WARNING_COPY: Record<SyncWarningKind, SyncWarningCopy> = {
  remote_incomplete: {
    label: "远端内容不完整",
    hint: "已跳过这篇；本地内容未改动，下次同步会重试。",
    retryable: true,
  },
  asset_missing: {
    label: "附件在云端缺失",
    hint: "已跳过该文件；其它内容照常同步，下次同步会重试。",
    retryable: true,
  },
  local_body_missing: {
    label: "本机正文文件缺失",
    hint: "未上传空正文；请从历史版本或云端恢复后再编辑。",
    retryable: false,
  },
  body_suspicious_external_change: {
    label: "正文疑似被外部改坏",
    hint: "已停止上传并保留历史；确认正文无误后再继续编辑。",
    retryable: false,
  },
  local_body_restored: {
    label: "已从云端恢复正文",
    hint: "本机缺失的正文已拉回，可直接继续编辑。",
    retryable: true,
  },
  asset_kept_remote: {
    label: "本机附件读不出",
    hint: "已保留云端声明（避免误删云端附件），下次同步会重试。",
    retryable: true,
  },
  asset_invalid_name: {
    label: "文件名不合法",
    hint: "已跳过该文件；改名后下次同步会上传。",
    retryable: false,
  },
  // 261113（C4）：冲突按「先提交者胜」处理并保留本地历史——不能再说「远端内容不完整、下次重试」。
  conflict_kept_history: {
    label: "已保留本地历史版本",
    hint: "这篇两端都改过；已保留你的版本（历史快照），当前显示云端版本。",
    retryable: false,
  },
  // task-66：单篇 apply（远端落本地）失败被跳过—— truthful：不是"远端内容不全"，是"本地这篇本轮没落地"。
  apply_skipped: {
    label: "本篇本轮未应用",
    hint: "已跳过这篇（本地内容未改动），下次同步会重试；其它文档照常同步。",
    retryable: true,
  },
};

export function syncWarningCopy(kind: SyncWarningKind): SyncWarningCopy {
  return SYNC_WARNING_COPY[kind];
}

/** 列表行的标题：文档标题 > 文件名 > id 截断 > 未知条目（不猜测，宁短不长）。 */
export function syncWarningTitle(warning: SyncWarning): string {
  const title = warning.title?.trim();
  if (title) return title;
  const filename = warning.filename?.trim();
  if (filename) return filename;
  const noteId = warning.noteId ?? "";
  if (noteId) return "文档 " + noteId.slice(0, 8) + "…";
  return "未知条目";
}

export interface SyncWarningSummary {
  total: number;
  /** 需人工处理（retryable=false）的条数。 */
  needsAction: number;
  /** 可重试（retryable=true）的条数。 */
  retryable: number;
}

export function syncWarningSummary(warnings: readonly SyncWarning[]): SyncWarningSummary {
  let needsAction = 0;
  let retryable = 0;
  for (const warning of warnings) {
    if (syncWarningCopy(warning.kind).retryable) retryable += 1;
    else needsAction += 1;
  }
  return { total: warnings.length, needsAction, retryable };
}

/** 摘要行：需处理优先；不写绝对化的「都会重试」。 */
export function syncWarningSummaryText(summary: SyncWarningSummary): string {
  if (summary.total <= 0) return "";
  if (summary.needsAction > 0 && summary.retryable > 0) return `同步有 ${summary.total} 项被跳过（需处理 ${summary.needsAction}，可重试 ${summary.retryable}）`;
  if (summary.needsAction > 0) return `同步有 ${summary.total} 项被跳过（需处理 ${summary.needsAction}）`;
  return `同步有 ${summary.total} 项被跳过（可重试 ${summary.retryable}）`;
}

/** 列表顺序：需人工处理在前、可重试在后；组内保持原顺序（稳定，便于「另 N 条」计数）。 */
export function syncWarningRows(warnings: readonly SyncWarning[]): SyncWarning[] {
  const needsAction = warnings.filter((warning) => !syncWarningCopy(warning.kind).retryable);
  const retryable = warnings.filter((warning) => syncWarningCopy(warning.kind).retryable);
  return [...needsAction, ...retryable];
}
