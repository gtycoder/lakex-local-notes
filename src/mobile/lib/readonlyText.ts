/**
 * 移动端只读文案（task-67）：原因/判据/标题取自 `core/capabilities/readonlyReason`（**单一来源**），
 * 本端只把「解除动作」换成移动端可执行的措辞 —— 移动端不提供解锁入口
 * （`core/repositoryCapabilities`：setNoteEditLocked 仅桌面），锁只能在桌面端解除。
 * 回收站/云端已删除的解除动作（恢复）本端有入口 ⇒ 直接沿用 core 的 releaseHint。
 */
import {
  readonlyReasonOf,
  type ReadonlyReason,
  type ReadonlyReasonInput,
  type ReadonlyReasonKind,
} from "../../core/capabilities/readonlyReason";

/** 只有「解除动作在本端不可执行」的原因才覆盖 releaseHint（其余逐字沿用 core）。 */
const MOBILE_RELEASE_HINTS: Partial<Record<ReadonlyReasonKind, string>> = {
  locked: "可阅读、不能编辑或保存；请先在桌面端解锁，回到这里即可继续编辑。",
};

/** 只读原因（标题/解除动作按本端能力校准）。null = 不是只读态。 */
export function mobileReadonlyReason(input: ReadonlyReasonInput): ReadonlyReason | null {
  const reason = readonlyReasonOf(input);
  if (!reason) return null;
  const hint = MOBILE_RELEASE_HINTS[reason.reason];
  return hint ? { ...reason, releaseHint: hint } : reason;
}

/** 一句话文案（只读横幅 / toast 共用）：为什么只读 + 一句怎么解除。 */
export function mobileReadonlyText(input: ReadonlyReasonInput): string | null {
  const reason = mobileReadonlyReason(input);
  return reason ? `${reason.title}。${reason.releaseHint}` : null;
}
