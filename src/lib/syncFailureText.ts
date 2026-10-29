/**
 * 同步失败的用户可见文案（261028 P1，单一来源）：
 * 手动同步（useSyncController）与自动同步广播（useSyncProgress）必须说同一套话，
 * 否则「另一台设备在发布」在两条路径上会给出不同解释。
 *
 * 原则（产品规则）：错误原因必须真实可见；可重试的不当硬失败；需要人工处理的给出下一步入口。
 */

/** 可重试失败（典型：另一台设备持有发布锁）的第一次提示标题。 */
export const SYNC_RETRYABLE_TITLE = "同步暂时没成功";
/** 手动同步自动重试一次的等待（ms）。 */
export const SYNC_RETRY_DELAY_MS = 2500;
/** 自动重试成功后的收尾提示（替换掉「正在重试」的常驻 busy toast）。 */
export const SYNC_RETRY_SUCCEEDED_MESSAGE = "已自动重试成功，本地改动已同步。";

/** epoch 不一致（本机与云端不是同一套数据）必须人工处理时的标题与正文。 */
export const SYNC_EPOCH_MISMATCH_TITLE = "云端是另一套数据";
export const SYNC_EPOCH_MISMATCH_MESSAGE = "本机与云端不是同一个数据空间（epoch 不一致），同步无法继续。要以云端为准，请在 设置 → 同步 →「从云端恢复（换机/坏库）」重建本机；本机现有数据会先隔离备份。";
export const SYNC_EPOCH_MISMATCH_ACTION_LABEL = "打开同步设置";
/** 自动同步路径（状态栏 notice）用的短文案：状态栏只有一行，不复述整段操作步骤。 */
export const SYNC_EPOCH_MISMATCH_NOTICE = "云端是另一套数据（epoch 不一致），同步无法继续；要以云端为准请在 设置 → 同步 →「从云端恢复」重建本机。";

/** 发布锁相关错误码：这三个都表示「另一台设备正在发布」，不是本机故障。 */
export function isSyncLockBusyCode(code: string | undefined): boolean {
  return code === "lock-busy" || code === "publish-conflict" || code === "cloud-changed";
}

/**
 * 手动同步第一次可重试失败：说明「是谁在占用 + 正在自动重试 + 本地改动安全」。
 * 非锁类错误（网络等）保留真实原因，不硬套「另一台设备」。
 */
export function retryableRetryMessage(code: string | undefined, detail?: string): string {
  if (isSyncLockBusyCode(code)) return "另一台设备正在同步（发布锁被占用），正在自动重试；本地改动没丢。";
  const cause = detail?.trim();
  return cause ? `本次同步没有完成（${cause}），正在自动重试；本地改动没丢。` : "本次同步没有完成，正在自动重试；本地改动没丢。";
}

/** 状态栏软提示（不弹红）：自动同步/重试期间的一句话状态。 */
export function retryableStatusMessage(code: string | undefined): string {
  return isSyncLockBusyCode(code) ? "另一台设备正在同步，稍后自动重试…" : "同步暂时没有完成，稍后自动重试…";
}
