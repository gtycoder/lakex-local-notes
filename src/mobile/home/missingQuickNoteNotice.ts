/**
 * 「打开缺正文小记」的可见提示（261104 B-lite）。
 *
 * 为什么需要：小记卡片还能点、列表里也还在（元数据来自 SQLite），但正文文件没了 ⇒
 * 旧实现 HomePage.openEdit 里 `if (!full) return;` 是**完全静默**的点了没反应，
 * 用户既不知道正文丢了、也不知道去哪救。这里补一条与「缺正文文档」同源的提示，
 * 并且**每篇每会话只提示一次**（连点同一张卡片不刷屏，模块级 Set = 整个 App 会话）。
 *
 * 文案单一来源 = data/missingBodyMessages（同一句话不要在两处写两份）。
 */
import { claimMissingBodyNotice, MISSING_QUICK_NOTE_OPEN_HINT } from "../data/missingBodyMessages";

/** 本次会话已经提示过的小记 id。 */
const notifiedThisSession = new Set<string>();

/**
 * 提示「这条小记正文文件缺失」。返回 true = 本次确实弹了提示（可测）。
 * showToast 由调用方注入（HomePage 用 ui/toastBus；单测注入 spy，避免依赖 DOM/定时器）。
 */
export function notifyMissingQuickNoteOnce(
  id: string,
  showToast: (text: string, opts: { type: "error" }) => void,
): boolean {
  if (!claimMissingBodyNotice(notifiedThisSession, id)) return false;
  showToast(MISSING_QUICK_NOTE_OPEN_HINT, { type: "error" });
  return true;
}

/** 测试用：清空"本会话已提示"记录（产品代码不要调用）。 */
export function resetMissingQuickNoteNoticesForTest(): void {
  notifiedThisSession.clear();
}
