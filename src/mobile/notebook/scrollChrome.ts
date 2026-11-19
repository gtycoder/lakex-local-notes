/**
 * 阅读时「底部悬浮胶囊」滚动显隐的判据（261019 顶/底栏自动收起的底栏分支；
 * 261119 用户点单：**滚动不再收起顶栏**，工作区顶栏常驻（阅读态也不收）⇒ 本判据只驱动悬浮胶囊）。
 *
 * 口径（纯函数，DOM 交互在 useWorkspaceChrome）：
 * - 在**顶部附近**（scrollTop ≤ CHROME_TOP_PX）胶囊一律展开；
 * - 向下滚累计 ≥ CHROME_HIDE_DELTA 才收起（避免一点抖动就藏）；
 * - 收起后继续向下滚保持收起；
 * - 向上滚累计 ≥ CHROME_SHOW_DELTA 才展开（比收起更灵敏，回翻要马上能看到导航）；
 * - 反向滚动立刻把累计清零（避免来回抖）。
 *
 * 只用于**阅读态**（kind=doc 且非编辑）；编辑态有 dock 与键盘，不参与。
 */
export const CHROME_TOP_PX = 24;
export const CHROME_HIDE_DELTA = 24;
export const CHROME_SHOW_DELTA = 12;

export interface ChromeScrollState {
  /** 胶囊是否收起（**只**驱动悬浮胶囊；顶栏 261119 起常驻，不消费本状态）。 */
  hidden: boolean;
  /** 同方向累计位移（px）；切换方向清零。 */
  acc: number;
}

export function chromeAfterScroll(state: ChromeScrollState, scrollTop: number, dy: number): ChromeScrollState {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(dy)) return state;
  if (scrollTop <= CHROME_TOP_PX) return { hidden: false, acc: 0 };
  if (dy > 0) {
    if (state.hidden) return { hidden: true, acc: 0 };
    const acc = state.acc + dy;
    return acc >= CHROME_HIDE_DELTA ? { hidden: true, acc: 0 } : { hidden: false, acc };
  }
  if (dy < 0) {
    if (!state.hidden) return { hidden: false, acc: 0 };
    const acc = state.acc - dy;
    return acc >= CHROME_SHOW_DELTA ? { hidden: false, acc: 0 } : { hidden: true, acc };
  }
  return state;
}
