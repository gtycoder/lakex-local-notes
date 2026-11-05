/**
 * 小记独立库可用性（Batch3-A，261105）：`quick-notes/metadata.sqlite3` 打不开时**不得**拖垮整个应用。
 *
 * 判据与 UI 解耦：`decideQuickNotesAvailability({ openError })` 是纯函数，main 只在 QuickNotesStore
 * 构造失败时调用它；失败 ⇒ 降级为「无小记」模式（主库/文档/表格照常），并：
 * - 小记相关 IPC 返回**可读错误**（写/单条读）或安全空列表（列表/计数）；
 * - **暂停 v3 同步**：没有小记存储时 local 小记世界为空，plan 会把远端小记判成待下载、落盘又因
 *   quickNotes 未注入失败（更糟的情况是被误判成删除）⇒ 明确失败 + 给出口，优于半轮状态；
 * - 启动日志 + 设置「同步诊断」都留一条可读告警（诊断复用既有 S3v3DiagnosticReport 通道，
 *   渲染层零改动）；出口 = 备份数据目录后用设置里的「从云端恢复（换机/坏库）」（A2，隔离旧数据）。
 */
import type { S3v3DiagnosticReport } from "../src/core/s3v3Report.js";
import { describeError } from "./startupRecovery.js";

export type QuickNotesAvailability =
  | { mode: "ok" }
  | {
    mode: "degraded";
    /** 一句话原因（日志/诊断标题级）。 */
    reason: string;
    /** 技术细节（异常摘要）。 */
    detail: string;
    /** 判定时刻（诊断报告用）。 */
    at: string;
  };

/** 降级原因之一：QuickNotesStore 构造抛错。无 openError = 正常。 */
export function decideQuickNotesAvailability(
  input: { openError?: unknown; now?: () => string } = {},
): QuickNotesAvailability {
  if (input.openError === undefined || input.openError === null) return { mode: "ok" };
  return {
    mode: "degraded",
    reason: "小记库（quick-notes/metadata.sqlite3）无法打开",
    detail: describeError(input.openError),
    at: (input.now ?? (() => new Date().toISOString()))(),
  };
}

/** 可读告警（启动日志 / 小记 IPC 错误 / 同步诊断共用同一句，避免多处口径漂移）。 */
export function quickNotesDegradedMessage(availability: Extract<QuickNotesAvailability, { mode: "degraded" }>): string {
  return "小记库不可用：" + availability.reason + "（" + availability.detail + "）。"
    + "主界面与文档/表格等不受影响；小记相关操作会返回此错误。"
    + "可在 设置→同步诊断 查看原因；如需恢复：先备份数据目录，再用 设置→「从云端恢复（换机/坏库）」（会先隔离保留当前数据）。";
}

// ---- 进程内状态（main 启动时写入；IPC/同步/退出路径只读） ----
let current: QuickNotesAvailability = { mode: "ok" };

export function setQuickNotesAvailability(availability: QuickNotesAvailability): void {
  current = availability;
}

export function getQuickNotesAvailability(): QuickNotesAvailability {
  return current;
}

/**
 * 同步前置断言（desktopSync 两个入口调用）：小记库降级时抛**可读错误**并整轮不跑。
 * 只有 quick-notes 通道启用时才拦（显式 `LAKE_S3V3_QUICK_NOTES=0` 的调试/无小记场景不在此列）。
 */
export function assertQuickNotesSyncAvailable(quickNotesChannelEnabled: boolean): void {
  const availability = current;
  if (!quickNotesChannelEnabled || availability.mode !== "degraded") return;
  throw new Error(
    "小记库不可用，已暂停同步（避免把空的小记世界误判为云端删除）：" + availability.reason
    + "（" + availability.detail + "）。请先在 设置→同步诊断 查看原因；备份数据目录后可走 设置→「从云端恢复（换机/坏库）」。",
  );
}

/**
 * 设置「同步诊断」里的一条合并告警：复用既有 S3v3DiagnosticReport 通道（渲染层零改动）。
 * 不写库、不落盘——只在该次 get_sync_status 返回里排在最前，打开设置即可见。
 */
export function buildQuickNotesUnavailableReport(
  availability: Extract<QuickNotesAvailability, { mode: "degraded" }>,
): S3v3DiagnosticReport {
  const message = quickNotesDegradedMessage(availability);
  return {
    at: availability.at,
    ok: false,
    durationMs: 0,
    generation: null,
    published: false,
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    conflicts: 0,
    warningCount: 1,
    warnings: [message],
    phases: [],
    failed: [],
    error: { code: "quick-notes-unavailable", errorClass: "fatal", message },
  };
}
