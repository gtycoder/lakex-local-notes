/**
 * 首页底部「＋」的按压判定（261014 用户点单：照语雀 App 的手感）——**纯函数**，供 HomePage 的指针事件使用。
 *
 * 语雀口径（设备实测 + 用户给的录屏）：
 *   · **短按**（整条胶囊上任意处）= 什么都不做 —— 交给被按到的条目自己的 onClick（搜索 / ＋ 开面板 / AI 提示）；
 *   · **按住整条胶囊任意处** ≈260ms → 整块变成「小记」（语雀那种整块效果）；
 *   · 保持按住并**向上滑**越过触发线后松手 = 直接进小记写作卡（速记）；
 *   · 浮出后**没上滑就松手** = 取消（不创建）—— 用户明确：长按不该误触建东西。
 *
 * 只做判定、不碰 DOM：时长/位移由调用方从 PointerEvent 量，这样边界能直接单测。
 */
/** 长按浮出气泡的时长（语雀 ~260ms；短于它都算"点"）。 */
export const CREATE_LONG_PRESS_MS = 260;
/** 上滑触发速记的距离（从按下点算，向上为正）。 */
export const CREATE_SLIDE_PX = 36;

/** 整块触发的松手结论。 */
export type BlockPressRelease = "pass" | "quick-note" | "cancel";

/** 长按是否已到点（该浮出气泡了）。 */
export function createPressRevealed(elapsedMs: number): boolean {
  return elapsedMs >= CREATE_LONG_PRESS_MS;
}

/** 上滑是否已越过触发线。dy = 当前 clientY - 按下时 clientY（向上为负）。 */
export function createPressArmed(dy: number): boolean {
  return -dy >= CREATE_SLIDE_PX;
}

/**
 * 松手结论（**整块触发**：手势挂在整条胶囊上，条目自己的 onClick 照常跑）：
 *   · 没长按到点 → **pass**：什么都不做，让被按到的那个条目走自己的语义（搜索 / ＋ 开面板 / AI 提示）；
 *   · 长按到点 + 上滑过线 → **速记**一条小记；
 *   · 长按到点但没上滑 → **取消**（用户明确"长按容易误触"，所以不做"长按即建"）。
 */
export function blockPressRelease(input: { revealed: boolean; dy: number }): BlockPressRelease {
  if (!input.revealed) return "pass";
  return createPressArmed(input.dy) ? "quick-note" : "cancel";
}
