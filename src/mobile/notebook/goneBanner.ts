/**
 * tab gone 只读横幅（P0-1，261117）：打开中的文档被删（本机回收站 / 他端回收站或 purge）后，
 * 旧内容仍显示但编辑已无效 —— 必须**看得见**（AGENTS §3#16：「只读 + 横幅 + 保存被拦要明说」）。
 *
 * 判据单一来源 = core/syncDecisions.isGoneNote（原料 noteGoneState / LocalNote.trashedAt+isPurged）；
 * 文案形态与 NotePaneHost 的 editLocked 横幅同族（.mobile-status-msg + role="status"）。
 * 文案按需求说明三件事：① 文档已被删除（云端/回收站）② 保存会被拦截 ③ 可从回收站恢复。
 * （core/capabilities/readonlyReason 的 trashed 文案只说「编辑不会保存」，没有明说「保存会被拦」与
 * 「云端已删除」两态，且 core 与 mobile/lib/readonlyText 不在本任务写入范围 ⇒ 三事实文案收口在这里。）
 */
export const GONE_BANNER_TEXT = "该文档已被删除（在回收站或云端已删除）：只读、保存会被拦截；可从回收站恢复后继续编辑。";
