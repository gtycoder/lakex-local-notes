/**
 * 移动端「同步气泡」单例（261127 用户报障收口：同步成功后必须自己消失，且同屏只允许一条同步气泡）。
 *
 * 事故现场（用户截图）：手动点云后同屏两条气泡 —— 粘性「正在同步…」（timeout 0，永远不关，只能手点 ✕）
 * + 另一条「v3 同步完成：↑0 ↓2」/「同步成功：…」。原因是同步收尾有两套出口、各写各的：
 *   ① 首页 runSync 先弹粘性气泡，bridge 返回后**另起一条**结果 toast（新 id）；
 *   ② 进度 effect 在进度清空时又往 sync-bubble 写结果；
 *   ③ 零进度轮（无变更）根本不会触发 ②，① 又不关粘性气泡 ⇒ 气泡常驻。
 *
 * 收口判据：
 *   ① **一个 id 管一轮同步**：进行中 / 收尾都写 `SYNC_BUBBLE_ID`（同 id 覆盖 = 原地更新，不叠气泡）；
 *   ② 进行中 = 粘性（timeout 0，用户可手动关）；收尾**必然自动关**：成功 6s / 失败 10s（261205 A 方案）；
 *   ③ 收尾文案单一来源 = `syncStatusStore`（「同步成功：…」/「同步失败：…」+ 跳过项摘要 + 上传下载明细），
 *      没跑引擎的早退（离线 / 便携包导入中 / 未配置）用 bridge 返回的短句；
 *   ④ 只有**本轮**写下的状态才算本轮结果（begin 记录起点；离线时不能拿上一轮的成功状态冒充）。
 *
 * 调用点：首页 HomePage（点云 + 进度 effect）、工作区 useWorkspaceSync（点云）；桌面不同源（各自 UI）。
 */
import { showToast, hideToast } from "../ui/toastBus";
import { syncWarningSummary, syncWarningSummaryText } from "../../core/syncWarningText";
import { describeSyncProgress, type SyncProgressSnapshot } from "./syncProgressStore";
import { describeSyncBreakdown, describeSyncResultSummary, readSyncStatus, type MobileSyncStatus } from "./syncStatusStore";

/** 一轮同步在屏幕上唯一的气泡 id（进行中与收尾共用）。 */
export const SYNC_BUBBLE_ID = "sync-bubble";
/** 收尾自动关（261205 A 方案）：成功 6s / 失败 10s；进行中 = 0（粘性，可手动关）。 */
const RESULT_TIMEOUT_OK_MS = 6_000;
const RESULT_TIMEOUT_ERROR_MS = 10_000;
/** 本轮同步的起点（0 = 没在气泡里登记过本轮）。 */
let roundStartedAt = 0;

/** 点同步后立刻给反馈（零进度轮也能看到「正在同步…」，否则用户以为没触发）。 */
export function beginSyncBubble(): void {
  roundStartedAt = Date.now();
  showToast("正在同步…", { id: SYNC_BUBBLE_ID, timeout: 0 });
}

/** 进度刷新：同 id 覆盖（节流后的进度快照 → 一行式文案）。 */
export function updateSyncBubbleProgress(progress: SyncProgressSnapshot | null): void {
  if (roundStartedAt === 0) roundStartedAt = Date.now();
  showToast("正在同步：" + describeSyncProgress(progress), { id: SYNC_BUBBLE_ID, timeout: 0 });
}

/**
 * 收尾：同 id 写成结果气泡，并**自动关**（成功 6s / 失败 10s）。
 * - 本轮真的跑过引擎 ⇒ 用同步状态（含明细/跳过项摘要）；
 * - 没跑（离线 / 导入中 / 未配置）⇒ 用调用方给的短句；
 * - 两者都没有 ⇒ 直接收掉气泡（不留下永不消失的「正在同步」）。
 * @returns 是否写入了结果气泡（false = 已收掉）。
 */
export function settleSyncBubble(fallbackText?: string): boolean {
  const startedAt = roundStartedAt;
  roundStartedAt = 0;
  const status = readSyncStatus();
  const statusAt = status ? new Date(status.at).getTime() : Number.NaN;
  const belongsToRound = startedAt === 0
    // 自动同步（进度 effect 驱动）没有 begin：退回「刚出炉」判据，避免拿陈旧状态冒充本轮结果。
    ? status !== null && Date.now() - statusAt < 30_000
    // 本轮 writeSyncStatus 必然发生在 begin 之后 ⇒ 早于起点的状态是上一轮，不能冒充。
    : Number.isFinite(statusAt) && statusAt >= startedAt;
  if (status && belongsToRound) {
    showToast(resultText(status), {
      id: SYNC_BUBBLE_ID,
      type: status.ok ? "info" : "error",
      timeout: status.ok ? RESULT_TIMEOUT_OK_MS : RESULT_TIMEOUT_ERROR_MS,
      ...(status.ok ? { detail: describeSyncBreakdown(status) ?? undefined } : {}),
    });
    return true;
  }
  if (fallbackText) {
    showToast(fallbackText, { id: SYNC_BUBBLE_ID, timeout: RESULT_TIMEOUT_OK_MS });
    return true;
  }
  hideToast(SYNC_BUBBLE_ID);
  return false;
}

/** 收尾文案：结果摘要 + （成功时）跳过项摘要；同 id 覆盖时明细行由 detail 承担。 */
function resultText(status: MobileSyncStatus): string {
  const base = describeSyncResultSummary(status);
  if (!status.ok) return base;
  const summary = status.warningSummary ?? (status.warnings && status.warnings.length > 0 ? syncWarningSummary(status.warnings) : null);
  const warnings = summary ? syncWarningSummaryText(summary) : "";
  return warnings ? base + "，" + warnings : base;
}
