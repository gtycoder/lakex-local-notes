/**
 * 「缺正文」相关文案与失败原因（移动端，261104 B-lite）。
 *
 * 为什么单独一个模块：同一个意思全仓只有一种说法（DESIGN Voice & Copy）。
 * 同一句提示会出现在三处 —— 打开文档被拦（notebook）、打开小记被拦（home）、资源管理列表（settings），
 * 都从这里取，别各写一遍。
 *
 * 文案口径：不用中点「·」；一句话说清「发生了什么 + 下一步去哪」；按钮不写「请」。
 */
import type { MissingBodyRecovery, MissingQuickNoteRecovery } from "../../core/missingBody.js";

/** 打开缺正文文档时的提示（打不开 ≠ 已删除：正文文件可能被手动删掉/写盘失败）。 */
export const MISSING_DOC_OPEN_HINT = "文档打不开：可能已被删除，或正文文件缺失。可在「设置 → 资源管理」恢复或彻底删除";

/** 打开缺正文小记时的提示（此前点是静默 no-op，用户完全不知道发生了什么）。 */
export const MISSING_QUICK_NOTE_OPEN_HINT = "小记打不开：正文文件缺失。可在「设置 → 资源管理」恢复或彻底删除";

const DOC_RECOVERY_LABEL: Record<MissingBodyRecovery, string> = {
  cloud: "可以从云端拉回",
  history: "只能恢复历史版本",
  none: "没有可用备份",
};

const QUICK_NOTE_RECOVERY_LABEL: Record<MissingQuickNoteRecovery, string> = {
  cloud: "可以从云端拉回",
  text: "可以用搜索缓存重建纯文本",
  none: "没有可用备份",
};

export function docRecoveryLabel(recovery: MissingBodyRecovery): string {
  return DOC_RECOVERY_LABEL[recovery];
}

export function quickNoteRecoveryLabel(recovery: MissingQuickNoteRecovery): string {
  return QUICK_NOTE_RECOVERY_LABEL[recovery];
}

/**
 * 恢复动作失败原因 → 给用户看的一句话（都写明「没有写入」这类后果，避免以为成功了）。
 * 未知原因兜底一句可操作的话，不把内部错误码抛给用户。
 */
const FAILURE_TEXT: Record<string, string> = {
  "cloud-off": "云同步已关闭，无法从云端拉回",
  "no-cloud-config": "未配置云同步，无法从云端拉回",
  "not-in-cloud": "云端没有这篇，可能已被删除",
  "object-missing": "云端正文缺失，没有写入",
  "hash-mismatch": "云端内容校验失败，没有写入",
  "invalid-content": "云端内容无法解析，没有写入",
  "not-found": "这篇已经不存在",
  "no-text": "没有可用的搜索缓存文本",
  invalid: "缓存文本无法重建",
};

export function missingRecoveryFailureText(reason: string): string {
  return FAILURE_TEXT[reason] ?? "恢复失败，请稍后重试";
}

/**
 * 每篇每会话只提示一次（纯函数：调用方持有 Set）。
 * 返回 true = 本次应提示；内部顺带把 id 记进 seen。
 */
export function claimMissingBodyNotice(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}
